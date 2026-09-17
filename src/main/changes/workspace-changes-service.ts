import { randomUUID } from 'node:crypto';

import { basename } from 'node:path';

import type {
  ChangedFileEntry,
  ChangesCount,
  ChangesFileRef,
  ChangesPlace,
  ChangesPlaceSuggestion,
  ChangesFileDiff,
  ChangesHistory,
  ChangesOpenAction,
  ChangesOpenOutcome,
  ChangesSource,
  ChangesSummary
} from '../../shared/changes';
import { ChangeSourceResolver } from './change-source-resolver';
import type { ChangeSegment, ChangesRepository } from './changes-repository';
import { ChangedFilesCache } from './changed-files-cache';
import { unavailableReasonFor } from './changes-summary';
import { openSafetyFor, resolveOpenTarget } from './safe-open';
import { SnapshotCache } from './snapshot-cache';
import { WorkspaceSnapshotEngine } from './workspace-snapshot-engine';

export type SnapshotEngineLike = Pick<
  WorkspaceSnapshotEngine,
  'snapshot' | 'changedFiles' | 'fileDiff' | 'headTree' | 'repositoryRoot'
  | 'composeReviewed' | 'removeWorkspace'
>;

/** The kind of work a recovered failure interrupted, for diagnostics. */
export type ChangesOperation = 'baseline' | 'refresh' | 'summary' | 'timer' | 'startup';

export interface WorkspaceChangesServiceOptions {
  repository: ChangesRepository;
  engine: SnapshotEngineLike;
  lookupWorkspace(workspaceId: string): { canonicalPath: string; available: boolean } | null;
  gitAvailable(): Promise<boolean>;
  onCount(count: ChangesCount): void;
  /** Electron's shell.openPath: an empty string on success. */
  openPath(path: string): Promise<string>;
  showItemInFolder(path: string): void;
  /** Hears about failures the service recovers from on its own. */
  reportError?(operation: ChangesOperation, error: unknown): void;
  clock?: () => Date;
  createId?: () => string;
  launchWaitMs?: number;
  snapshotCacheMs?: number;
  terminalRefreshMs?: number;
}

export interface BeginInput {
  ownerKind: 'terminal' | 'unified';
  ownerId: string;
  workspaceId: string;
  catalogSessionId: string | null;
}

const RETENTION_MS = 14 * 24 * 60 * 60 * 1_000;
/** Places a workspace can watch besides itself; each one costs a snapshot per refresh. */
const MAX_PLACES = 3;
/** The cap the counts IPC schema sets. */
const MAX_COUNTS = 256;
const MAX_HISTORY_ENTRIES = 500;

interface RefreshRun {
  again: boolean;
  done: Promise<void>;
}

/** Tracks what each session changed in its workspace, from a baseline taken as it starts. */
export class WorkspaceChangesService {
  private readonly repository: ChangesRepository;
  private readonly engine: SnapshotEngineLike;
  private readonly clock: () => Date;
  private readonly createId: () => string;
  private readonly launchWaitMs: number;
  private readonly terminalRefreshMs: number;
  private readonly snapshots: SnapshotCache;
  private readonly changedFiles: ChangedFilesCache;
  private readonly resolver: ChangeSourceResolver;
  private readonly refreshes = new Map<string, RefreshRun>();
  private readonly reviewQueues = new Map<string, Promise<void>>();
  private readonly lastCounts = new Map<string, number>();
  private terminalTimer: ReturnType<typeof setInterval> | null = null;
  /** Set at shutdown, once the database is about to close: late session calls then do nothing. */
  private disposed = false;
  /** Set as the app starts quitting: sessions still end, but nothing is recounted. */
  private shuttingDown = false;

  constructor(private readonly options: WorkspaceChangesServiceOptions) {
    this.repository = options.repository;
    this.engine = options.engine;
    this.clock = options.clock ?? (() => new Date());
    this.createId = options.createId ?? randomUUID;
    this.launchWaitMs = options.launchWaitMs ?? 3_000;
    this.terminalRefreshMs = options.terminalRefreshMs ?? 30_000;
    const cacheMs = options.snapshotCacheMs ?? 2_000;
    this.snapshots = new SnapshotCache(this.engine, this.clock, cacheMs);
    this.changedFiles = new ChangedFilesCache(
      (workspaceId, workspacePath, fromTree, toTree) =>
        this.engine.changedFiles(workspaceId, workspacePath, fromTree, toTree),
      this.clock,
      cacheMs
    );
    this.resolver = new ChangeSourceResolver({
      repository: this.repository,
      engine: {
        changedFiles: (workspaceId, workspacePath, fromTree, toTree) =>
          this.changedFiles.get(workspaceId, workspacePath, fromTree, toTree),
        headTree: (workspaceId, workspacePath) => this.engine.headTree(workspaceId, workspacePath)
      },
      snapshots: this.snapshots,
      lookupWorkspace: (workspaceId) => options.lookupWorkspace(workspaceId),
      isGitAvailable: () => this.isGitAvailable('summary'),
      now: () => this.now(),
      reportError: (error) => this.report('summary', error)
    });
  }

  async begin(input: BeginInput): Promise<void> {
    if (this.disposed) return;
    try {
      const segmentId = this.createId();
      this.repository.createSegment({ ...input, id: segmentId, createdAt: this.now() });
      const workspace = this.options.lookupWorkspace(input.workspaceId);
      if (workspace === null || !workspace.available) {
        this.repository.markUnavailable(segmentId, 'workspace-unavailable');
        return;
      }
      await this.waitForBaseline(segmentId, input, workspace.canonicalPath);
    } catch (error) {
      // Tracking changes must never keep a session from starting.
      this.report('baseline', error);
    }
  }

  end(ownerId: string): void {
    if (this.disposed) return;
    this.repository.endSegment(ownerId, this.now());
    if (!this.shuttingDown) void this.refresh(ownerId);
  }

  linkCatalogSession(ownerId: string, catalogSessionId: string): void {
    if (this.disposed) return;
    this.repository.linkCatalogSession(ownerId, catalogSessionId);
  }

  /** Recounts a session's changes; calls made while one runs are folded into one more run. */
  refresh(ownerId: string): Promise<void> {
    if (this.disposed || this.shuttingDown) return Promise.resolve();
    const running = this.refreshes.get(ownerId);
    if (running !== undefined) {
      running.again = true;
      return running.done;
    }
    const run: RefreshRun = { again: false, done: Promise.resolve() };
    run.done = (async () => {
      do {
        run.again = false;
        await this.refreshOnce(ownerId);
      } while (run.again && !this.disposed);
      this.refreshes.delete(ownerId);
    })();
    this.refreshes.set(ownerId, run);
    return run.done;
  }

  counts(): ChangesCount[] {
    // The list crosses IPC, which caps it; more open segments than that would fail the whole call.
    return this.repository.listOpenSegments().slice(0, MAX_COUNTS).map((segment) => ({
      ownerId: segment.ownerId,
      workspaceId: segment.workspaceId,
      state: segment.state,
      changedFileCount: this.lastCounts.get(segment.ownerId) ?? 0
    }));
  }

  async summary(source: ChangesSource): Promise<ChangesSummary> {
    return this.resolver.summarize(this.resolver.target(source), false);
  }

  async fileDiff(
    source: ChangesSource,
    placeId: string | null,
    path: string
  ): Promise<ChangesFileDiff> {
    const resolution = await this.resolver.resolveFile(this.resolver.target(source), placeId, false);
    if (resolution === null) {
      throw new Error('Changes are not available for this source.');
    }
    const { workspaceId, path: folder, from, to } = resolution;
    const entries = await this.changedFiles.get(workspaceId, folder, from, to);
    const entry = entries.find((candidate) => candidate.path === path);
    if (entry?.binary === true) {
      return { path, patch: '', binary: true, truncated: false };
    }
    const diff = await this.engine.fileDiff(workspaceId, folder, from, to, path, entry?.oldPath ?? null);
    return { path, patch: diff.patch, binary: false, truncated: diff.truncated };
  }

  /**
   * Marks exactly the listed files reviewed. Reviews for one session run one
   * at a time, so each starts from the baseline the one before left.
   */
  async markReviewed(ownerId: string, files: readonly ChangesFileRef[]): Promise<ChangesSummary> {
    if (files.length === 0) {
      throw new Error('Choose at least one file to mark reviewed.');
    }
    const previous = this.reviewQueues.get(ownerId) ?? Promise.resolve();
    const review = previous.then(() => this.reviewNow(ownerId, files));
    const settled = review.then(() => undefined, () => undefined);
    this.reviewQueues.set(ownerId, settled);
    void settled.then(() => {
      if (this.reviewQueues.get(ownerId) === settled) this.reviewQueues.delete(ownerId);
    });
    return review;
  }

  history(workspaceId: string): ChangesHistory {
    const segments = this.repository.listWorkspaceSegments(workspaceId, MAX_HISTORY_ENTRIES);
    return {
      segments: segments.map((segment) => ({
        ownerId: segment.ownerId,
        ownerKind: segment.ownerKind,
        catalogSessionId: segment.catalogSessionId,
        createdAt: segment.createdAt,
        endedAt: segment.endedAt,
        reviews: this.repository.listReviews(segment.id, MAX_HISTORY_ENTRIES).map((review) => ({
          reviewId: review.id,
          fileCount: review.fileCount,
          reviewedAt: review.reviewedAt
        }))
      }))
    };
  }

  /**
   * Where a changed file sits on this computer, spelled as the workspace does:
   * no link is followed, and a file that has been deleted still has a path.
   */
  async filePath(source: ChangesSource, placeId: string | null, path: string): Promise<string> {
    const { context: { workspaceId } } = this.resolver.target(source);
    const folder = this.resolver.placePath(workspaceId, placeId);
    if (folder === null) {
      throw new Error('The workspace is not available.');
    }
    const resolved = WorkspaceSnapshotEngine.resolveInside(folder, path);
    if (resolved === null) {
      throw new Error('The path is outside the watched folder.');
    }
    return resolved;
  }

  /**
   * Opens a changed file, shows it in its folder, or asks first. A script that
   * people also read opens only when the caller asks again with open-anyway; a
   * file the system would run or install is never opened.
   */
  async open(
    source: ChangesSource,
    placeId: string | null,
    path: string,
    action: ChangesOpenAction
  ): Promise<ChangesOpenOutcome> {
    const { context: { workspaceId } } = this.resolver.target(source);
    const folder = this.resolver.placePath(workspaceId, placeId);
    if (folder === null) {
      throw new Error('The workspace is not available.');
    }
    const target = await resolveOpenTarget(folder, path);
    if (!target.exists && action !== 'reveal') {
      throw new Error('The file no longer exists.');
    }
    const reveal = (): ChangesOpenOutcome => {
      this.options.showItemInFolder(target.path);
      return { outcome: 'revealed' };
    };
    if (action === 'reveal' || !target.exists) return reveal();
    const safety = await openSafetyFor(path, target.path);
    if (safety === 'reveal') return reveal();
    if (safety === 'confirm' && action !== 'open-anyway') return { outcome: 'confirm-required' };
    const failure = await this.options.openPath(target.path);
    if (failure !== '') {
      throw new Error('The file could not be opened.');
    }
    return { outcome: 'opened' };
  }

  startTerminalTimer(): void {
    if (this.terminalTimer !== null || this.shuttingDown || this.disposed) return;
    this.terminalTimer = setInterval(() => {
      try {
        for (const segment of this.repository.listOpenSegments()) {
          if (segment.ownerKind === 'terminal' && segment.state === 'ready') {
            void this.refresh(segment.ownerId);
          }
        }
      } catch (error) {
        this.report('timer', error);
      }
    }, this.terminalRefreshMs);
    this.terminalTimer.unref?.();
  }

  /**
   * Called as the app starts quitting, before its sessions are stopped: they
   * still end their segments, but no refresh starts that could outlive the database.
   */
  beginShutdown(): void {
    this.shuttingDown = true;
    this.stopTerminalTimer();
  }

  dispose(): void {
    this.disposed = true;
    this.stopTerminalTimer();
  }

  private stopTerminalTimer(): void {
    if (this.terminalTimer !== null) {
      clearInterval(this.terminalTimer);
      this.terminalTimer = null;
    }
  }

  /**
   * Ends segments left open by the last run and drops those that ended more
   * than 14 days ago. Must run before any session launches, or it would end
   * the new sessions' segments too.
   */
  async startup(): Promise<void> {
    const now = this.clock();
    this.repository.endOpenSegments(now.toISOString());
    const cutoff = new Date(now.getTime() - RETENTION_MS).toISOString();
    const pruned = this.repository.pruneEndedBefore(cutoff);
    for (const workspaceId of new Set(pruned.map((entry) => entry.workspaceId))) {
      if (this.repository.hasSegments(workspaceId)) continue;
      this.snapshots.delete(workspaceId);
      try {
        await this.engine.removeWorkspace(workspaceId);
      } catch (error) {
        this.report('startup', error);
      }
    }
  }

  private now(): string {
    return this.clock().toISOString();
  }

  private report(operation: ChangesOperation, error: unknown): void {
    // Work still running at shutdown fails on the closed database; that is expected.
    if (this.disposed) return;
    try {
      this.options.reportError?.(operation, error);
    } catch {
      // A failing reporter must not break change tracking.
    }
  }

  private async isGitAvailable(operation: ChangesOperation): Promise<boolean> {
    try {
      return await this.options.gitAvailable();
    } catch (error) {
      this.report(operation, error);
      return false;
    }
  }

  /**
   * Resolves when the baseline is recorded or the launch wait ends, whichever
   * comes first. Looking for git counts toward the wait.
   */
  private async waitForBaseline(segmentId: string, input: BeginInput, workspacePath: string): Promise<void> {
    let waited = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const wait = new Promise<void>((resolve) => {
      timer = setTimeout(() => {
        waited = true;
        resolve();
      }, this.launchWaitMs);
    });
    const capture = this.trackAfterGitCheck(segmentId, input, workspacePath, () => waited);
    try {
      await Promise.race([capture, wait]);
    } finally {
      clearTimeout(timer);
    }
  }

  private async trackAfterGitCheck(
    segmentId: string,
    input: BeginInput,
    workspacePath: string,
    late: () => boolean
  ): Promise<void> {
    if (await this.isGitAvailable('baseline')) {
      await Promise.all([
        this.captureBaseline(segmentId, input, workspacePath, late),
        this.capturePlaceBaselines(segmentId, input.workspaceId, late)
      ]);
      return;
    }
    try {
      this.repository.markUnavailable(segmentId, 'git-missing');
    } catch (error) {
      this.report('baseline', error);
    }
  }

  /** Every place the workspace watches starts the session with a baseline of its own. */
  private async capturePlaceBaselines(
    segmentId: string,
    workspaceId: string,
    late: () => boolean
  ): Promise<void> {
    const places = this.repository.listPlaces(workspaceId);
    await Promise.all(places.map(async (place) => {
      try {
        this.repository.createRoot(segmentId, place.id);
        const snapshot = await this.engine.snapshot(workspaceId, place.path);
        this.snapshots.set(workspaceId, place.path, snapshot);
        this.repository.recordRootBaseline(segmentId, place.id, {
          snapshotKind: snapshot.kind,
          tree: snapshot.tree,
          head: snapshot.head,
          late: late()
        });
      } catch (error) {
        // A place Lumora cannot read says so on its own row, and the session still runs.
        this.report('baseline', error);
        try {
          this.repository.markRootUnavailable(segmentId, place.id, unavailableReasonFor(error, 'snapshot'));
        } catch (failure) {
          this.report('baseline', failure);
        }
      }
    }));
  }

  /**
   * Starts watching a folder for this workspace, from now on. Every open
   * session takes its baseline at once, so what it changed there is listed from
   * this moment rather than pretended about.
   */
  async addPlace(workspaceId: string, path: string): Promise<ChangesPlace[]> {
    if (this.disposed) return this.places(workspaceId);
    const existing = this.repository.listPlaces(workspaceId);
    if (existing.length >= MAX_PLACES || existing.some((place) => place.path === path)) {
      return this.places(workspaceId);
    }
    const workspace = this.options.lookupWorkspace(workspaceId);
    if (workspace === null) return this.places(workspaceId);
    const id = this.createId();
    this.repository.addPlace({ id, workspaceId, path, createdAt: this.now() });
    for (const segment of this.repository.listOpenSegments()) {
      if (segment.workspaceId !== workspaceId) continue;
      try {
        this.repository.createRoot(segment.id, id);
        const snapshot = await this.engine.snapshot(workspaceId, path);
        this.snapshots.set(workspaceId, path, snapshot);
        // Joining mid-session is late by definition: the edits before now are not ours to show.
        this.repository.recordRootBaseline(segment.id, id, {
          snapshotKind: snapshot.kind,
          tree: snapshot.tree,
          head: snapshot.head,
          late: true
        });
      } catch (error) {
        this.report('baseline', error);
        this.repository.markRootUnavailable(segment.id, id, unavailableReasonFor(error, 'snapshot'));
      }
      void this.refresh(segment.ownerId);
    }
    return this.places(workspaceId);
  }

  removePlace(workspaceId: string, placeId: string): ChangesPlace[] {
    if (this.disposed) return [];
    const place = this.repository.getPlace(placeId);
    if (place !== null && place.workspaceId === workspaceId) {
      this.repository.removePlace(placeId);
      this.snapshots.delete(workspaceId);
      for (const segment of this.repository.listOpenSegments()) {
        if (segment.workspaceId === workspaceId) void this.refresh(segment.ownerId);
      }
    }
    return this.places(workspaceId);
  }

  places(workspaceId: string): ChangesPlace[] {
    if (this.disposed) return [];
    const workspace = this.options.lookupWorkspace(workspaceId);
    const places = this.repository.listPlaces(workspaceId).map<ChangesPlace>((place) => ({
      id: place.id,
      name: basename(place.path),
      path: place.path,
      baselineLate: false,
      unavailableReason: null
    }));
    if (workspace === null) return places;
    return [
      { id: null, name: basename(workspace.canonicalPath), path: workspace.canonicalPath, baselineLate: false, unavailableReason: null },
      ...places
    ];
  }

  /**
   * The repository a workspace sits inside, when it is not the repository
   * itself and is not watched already. Offered rather than added: reading a
   * folder is the person's decision, not the agent's.
   */
  async suggestPlace(workspaceId: string): Promise<ChangesPlaceSuggestion> {
    if (this.disposed) return null;
    const workspace = this.options.lookupWorkspace(workspaceId);
    if (workspace === null || !workspace.available) return null;
    if (this.repository.listPlaces(workspaceId).length >= MAX_PLACES) return null;
    try {
      const root = await this.engine.repositoryRoot(workspaceId, workspace.canonicalPath);
      if (root === null || root === workspace.canonicalPath) return null;
      if (this.repository.listPlaces(workspaceId).some((place) => place.path === root)) return null;
      return { path: root, name: basename(root) };
    } catch (error) {
      this.report('summary', error);
      return null;
    }
  }

  private async captureBaseline(
    segmentId: string,
    input: BeginInput,
    workspacePath: string,
    late: () => boolean
  ): Promise<void> {
    try {
      const snapshot = await this.engine.snapshot(input.workspaceId, workspacePath);
      this.snapshots.set(input.workspaceId, workspacePath, snapshot);
      this.repository.recordBaseline(segmentId, {
        snapshotKind: snapshot.kind,
        tree: snapshot.tree,
        head: snapshot.head,
        late: late()
      });
      // A late baseline may land after its session ended or its workspace went away.
      if (this.repository.getSegment(segmentId)?.endedAt === null) {
        this.emitCount({ ownerId: input.ownerId, workspaceId: input.workspaceId, state: 'ready', changedFileCount: 0 });
      }
    } catch (error) {
      this.report('baseline', error);
      try {
        this.repository.markUnavailable(segmentId, unavailableReasonFor(error, 'snapshot'));
      } catch (markError) {
        this.report('baseline', markError);
      }
    }
  }

  private async refreshOnce(ownerId: string): Promise<void> {
    try {
      const target = this.resolver.target({ kind: 'session', ownerId, view: 'session' });
      const summary = await this.resolver.summarize(target, true);
      if (summary.state !== 'ready' && target.segment?.state === 'ready') {
        // The segment is still tracked, so a failed look at the workspace keeps the last count.
        return;
      }
      const count = summary.files.length;
      if (target.segment?.endedAt === null) {
        this.lastCounts.set(ownerId, count);
      } else {
        this.lastCounts.delete(ownerId);
      }
      this.emitCount({ ownerId, workspaceId: summary.workspaceId, state: summary.state, changedFileCount: count });
    } catch (error) {
      this.report('refresh', error);
    }
  }

  private emitCount(count: ChangesCount): void {
    if (this.disposed) return;
    try {
      this.options.onCount(count);
    } catch (error) {
      this.report('refresh', error);
    }
  }

  private async reviewNow(
    ownerId: string,
    files: readonly ChangesFileRef[]
  ): Promise<ChangesSummary> {
    const source: ChangesSource = { kind: 'session', ownerId, view: 'session' };
    const { segment } = this.resolver.target(source);
    if (segment === null || segment.state !== 'ready') {
      return this.summary(source);
    }
    // Each place keeps its own baseline, so a batch is recorded against the place it covered.
    const byPlace = new Map<string | null, string[]>();
    for (const { placeId, path } of files) {
      const paths = byPlace.get(placeId) ?? [];
      paths.push(path);
      byPlace.set(placeId, paths);
    }
    for (const [placeId, paths] of byPlace) {
      await this.reviewPlace(segment, placeId, paths);
    }
    await this.refresh(ownerId);
    return this.summary(source);
  }

  private async reviewPlace(
    segment: ChangeSegment,
    placeId: string | null,
    paths: readonly string[]
  ): Promise<void> {
    const path = this.resolver.placePath(segment.workspaceId, placeId);
    const baselineTree = placeId === null
      ? segment.baselineTree
      : this.repository.listRoots(segment.id)
        .find((root) => root.placeId === placeId && root.state === 'ready')?.baselineTree ?? null;
    if (path === null || baselineTree === null) return;
    const { workspaceId } = segment;
    const current = await this.snapshots.get(workspaceId, path, true);
    const changed = await this.engine.changedFiles(workspaceId, path, baselineTree, current.tree);
    const reviewed = await this.reviewedTree(
      workspaceId, path, baselineTree, current.tree, changed, paths
    );
    if (reviewed === null) return;
    this.repository.recordReview({
      id: this.createId(),
      segmentId: segment.id,
      placeId,
      fromTree: baselineTree,
      toTree: reviewed.tree,
      fileCount: reviewed.fileCount,
      reviewedAt: this.now()
    });
  }

  /** The baseline with the listed files taken from the current tree, or null when none of them changed. */
  private async reviewedTree(
    workspaceId: string,
    workspacePath: string,
    baselineTree: string,
    currentTree: string,
    files: readonly ChangedFileEntry[],
    paths: readonly string[]
  ): Promise<{ tree: string; fileCount: number } | null> {
    const wanted = new Set(paths);
    const chosen = files.filter(({ path }) => wanted.has(path));
    if (chosen.length === 0) {
      return null;
    }
    const expanded = chosen.flatMap(({ path, oldPath }) => (oldPath === null ? [path] : [path, oldPath]));
    const tree = await this.engine.composeReviewed(
      workspaceId, workspacePath, baselineTree, currentTree, expanded
    );
    return { tree, fileCount: chosen.length };
  }
}
