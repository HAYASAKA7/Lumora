import { randomUUID } from 'node:crypto';

import type {
  ChangedFile,
  ChangesCount,
  ChangesFileDiff,
  ChangesHistory,
  ChangesSource,
  ChangesSummary
} from '../../shared/changes';
import { ChangeSourceResolver } from './change-source-resolver';
import type { ChangeSegment, ChangesRepository } from './changes-repository';
import { unavailableReasonFor } from './changes-summary';
import { resolveOpenTarget, shouldRevealInstead } from './safe-open';
import { SnapshotCache } from './snapshot-cache';
import type { WorkspaceSnapshotEngine } from './workspace-snapshot-engine';

export type SnapshotEngineLike = Pick<
  WorkspaceSnapshotEngine,
  'snapshot' | 'changedFiles' | 'fileDiff' | 'headTree' | 'composeReviewed' | 'removeWorkspace'
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
    this.snapshots = new SnapshotCache(this.engine, this.clock, options.snapshotCacheMs ?? 2_000);
    this.resolver = new ChangeSourceResolver({
      repository: this.repository,
      engine: this.engine,
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
    return this.repository.listOpenSegments().map((segment) => ({
      ownerId: segment.ownerId,
      workspaceId: segment.workspaceId,
      state: segment.state,
      changedFileCount: this.lastCounts.get(segment.ownerId) ?? 0
    }));
  }

  async summary(source: ChangesSource): Promise<ChangesSummary> {
    return this.resolver.summarize(this.resolver.target(source), false);
  }

  async fileDiff(source: ChangesSource, path: string): Promise<ChangesFileDiff> {
    const resolution = await this.resolver.resolve(this.resolver.target(source), false);
    if (!resolution.ready) {
      throw new Error('Changes are not available for this source.');
    }
    const { context: { workspaceId }, workspacePath, from, to } = resolution;
    const entries = await this.engine.changedFiles(workspaceId, workspacePath, from, to);
    const entry = entries.find((candidate) => candidate.path === path);
    if (entry?.binary === true) {
      return { path, patch: '', binary: true, truncated: false };
    }
    const diff = await this.engine.fileDiff(workspaceId, workspacePath, from, to, path, entry?.oldPath ?? null);
    return { path, patch: diff.patch, binary: false, truncated: diff.truncated };
  }

  /**
   * Marks exactly the listed files reviewed. Reviews for one session run one
   * at a time, so each starts from the baseline the one before left.
   */
  async markReviewed(ownerId: string, paths: readonly string[]): Promise<ChangesSummary> {
    if (paths.length === 0) {
      throw new Error('Choose at least one file to mark reviewed.');
    }
    const previous = this.reviewQueues.get(ownerId) ?? Promise.resolve();
    const review = previous.then(() => this.reviewNow(ownerId, paths));
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

  async open(source: ChangesSource, path: string, action: 'open' | 'reveal'): Promise<void> {
    const { context: { workspaceId } } = this.resolver.target(source);
    const workspace = this.options.lookupWorkspace(workspaceId);
    if (workspace === null || !workspace.available) {
      throw new Error('The workspace is not available.');
    }
    const target = await resolveOpenTarget(workspace.canonicalPath, path);
    if (!target.exists && action === 'open') {
      throw new Error('The file no longer exists.');
    }
    // A file that would run is shown in its folder rather than started.
    if (action === 'reveal' || !target.exists || await shouldRevealInstead(path, target.path)) {
      this.options.showItemInFolder(target.path);
      return;
    }
    const failure = await this.options.openPath(target.path);
    if (failure !== '') {
      throw new Error('The file could not be opened.');
    }
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
      await this.captureBaseline(segmentId, input, workspacePath, late);
      return;
    }
    try {
      this.repository.markUnavailable(segmentId, 'git-missing');
    } catch (error) {
      this.report('baseline', error);
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
      this.snapshots.set(input.workspaceId, snapshot);
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
        this.repository.markUnavailable(segmentId, unavailableReasonFor(error));
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

  private async reviewNow(ownerId: string, paths: readonly string[]): Promise<ChangesSummary> {
    const source: ChangesSource = { kind: 'session', ownerId, view: 'session' };
    const { segment } = this.resolver.target(source);
    const workspace = segment === null ? null : this.options.lookupWorkspace(segment.workspaceId);
    if (segment?.state !== 'ready' || segment.baselineTree === null || workspace === null || !workspace.available) {
      return this.summary(source);
    }
    const { workspaceId, baselineTree } = segment;
    const current = await this.snapshots.get(workspaceId, workspace.canonicalPath, true);
    const files = await this.engine.changedFiles(workspaceId, workspace.canonicalPath, baselineTree, current.tree);
    const reviewed = await this.reviewedTree(segment, workspace.canonicalPath, current.tree, files, paths);
    if (reviewed === null) {
      return this.summary(source);
    }
    this.repository.recordReview({
      id: this.createId(),
      segmentId: segment.id,
      fromTree: baselineTree,
      toTree: reviewed.tree,
      fileCount: reviewed.fileCount,
      reviewedAt: this.now()
    });
    await this.refresh(ownerId);
    return this.summary(source);
  }

  /** The baseline with the listed files taken from the current tree, or null when none of them changed. */
  private async reviewedTree(
    segment: ChangeSegment,
    workspacePath: string,
    currentTree: string,
    files: readonly ChangedFile[],
    paths: readonly string[]
  ): Promise<{ tree: string; fileCount: number } | null> {
    const wanted = new Set(paths);
    const chosen = files.filter(({ path }) => wanted.has(path));
    if (chosen.length === 0 || segment.baselineTree === null) {
      return null;
    }
    const expanded = chosen.flatMap(({ path, oldPath }) => (oldPath === null ? [path] : [path, oldPath]));
    const tree = await this.engine.composeReviewed(
      segment.workspaceId, workspacePath, segment.baselineTree, currentTree, expanded
    );
    return { tree, fileCount: chosen.length };
  }
}
