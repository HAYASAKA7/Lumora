import { basename } from 'node:path';

import type {
  ChangedFile,
  ChangedFileEntry,
  ChangesPlace,
  ChangesSource,
  ChangesSummary,
  ChangesUnavailableReason
} from '../../shared/changes';
import type { ChangeReview, ChangeSegment, ChangesRepository } from './changes-repository';
import {
  pendingSummary,
  readySummary,
  splitCommitted,
  unavailableReasonFor,
  type SummaryContext
} from './changes-summary';
import type { SnapshotCache } from './snapshot-cache';
import type { WorkspaceSnapshotEngine } from './workspace-snapshot-engine';

export interface ChangeTarget {
  context: SummaryContext;
  segment: ChangeSegment | null;
  review: ChangeReview | null;
}

export type ChangeResolution =
  | {
    ready: false;
    context: SummaryContext;
    state: 'capturing' | 'unavailable';
    reason: ChangesUnavailableReason | null;
  }
  | {
    ready: true;
    context: SummaryContext;
    workspacePath: string;
    from: string;
    to: string;
    /** HEAD moved since the baseline, so files now matching a commit are listed apart. */
    splitCommitted: boolean;
  };

/** One watched place of a session or workspace, and the two trees it compares. */
interface PlaceResolution {
  placeId: string;
  path: string;
  from: string;
  to: string;
  splitCommitted: boolean;
}

export interface ChangeSourceResolverOptions {
  repository: ChangesRepository;
  engine: Pick<WorkspaceSnapshotEngine, 'changedFiles' | 'headTree'>;
  snapshots: SnapshotCache;
  lookupWorkspace(workspaceId: string): { canonicalPath: string; available: boolean } | null;
  isGitAvailable(): Promise<boolean>;
  now(): string;
  /** Hears about failures a summary turns into an unavailable state. */
  reportError(error: unknown): void;
}

/** Turns a changes source into the trees it compares, place by place, and those into a summary. */
export class ChangeSourceResolver {
  constructor(private readonly options: ChangeSourceResolverOptions) {}

  /** Throws for a session or review that is not known. */
  target(source: ChangesSource): ChangeTarget {
    const { repository } = this.options;
    if (source.kind === 'workspace') {
      return {
        context: this.contextFor(source, source.workspaceId, false, false, null),
        segment: null,
        review: null
      };
    }
    if (source.kind === 'review') {
      const review = repository.getReview(source.reviewId);
      const segment = review === null ? null : repository.getSegment(review.segmentId);
      if (review === null || segment === null) {
        throw new Error('The review does not exist.');
      }
      return {
        // A batch covered one place, so it is the only one its files come from.
        context: this.contextFor(source, segment.workspaceId, false, false, segment, review.placeId),
        segment,
        review
      };
    }
    const segment = repository.getSegmentByOwner(source.ownerId);
    if (segment === null) {
      throw new Error('No changes are tracked for this session.');
    }
    const sharedWorkspace = repository.hasOtherOpenSegment(segment.workspaceId, segment.ownerId);
    return {
      context: this.contextFor(
        source, segment.workspaceId, segment.baselineLate, sharedWorkspace, segment
      ),
      segment,
      review: null
    };
  }

  /**
   * The places a summary covers: the workspace first, then what the workspace
   * watches besides it. A session reports each place's own baseline state, so a
   * place that failed says so without taking the others down with it.
   */
  private contextFor(
    source: ChangesSource,
    workspaceId: string,
    baselineLate: boolean,
    sharedWorkspace: boolean,
    segment: ChangeSegment | null,
    onlyPlaceId?: string | null
  ): SummaryContext {
    const workspace = this.options.lookupWorkspace(workspaceId);
    const workspacePlace: ChangesPlace = {
      id: null,
      name: workspace === null ? workspaceId : basename(workspace.canonicalPath),
      path: workspace?.canonicalPath ?? '',
      baselineLate,
      unavailableReason: null
    };
    if (onlyPlaceId === null) {
      return { source, workspaceId, baselineLate, sharedWorkspace, places: [workspacePlace] };
    }
    const roots = segment === null
      ? new Map<string, { baselineLate: boolean; reason: ChangesUnavailableReason | null }>()
      : new Map(this.options.repository.listRoots(segment.id).map((root) => [root.placeId, {
        baselineLate: root.baselineLate,
        reason: root.state === 'unavailable' ? root.unavailableReason ?? 'failed' : null
      }]));
    const places = this.options.repository.listPlaces(workspaceId)
      .filter((place) => onlyPlaceId === undefined || place.id === onlyPlaceId)
      .map<ChangesPlace>((place) => ({
        id: place.id,
        name: basename(place.path),
        path: place.path,
        baselineLate: roots.get(place.id)?.baselineLate ?? false,
        unavailableReason: roots.get(place.id)?.reason ?? null
      }));
    return {
      source,
      workspaceId,
      baselineLate,
      sharedWorkspace,
      places: onlyPlaceId === undefined ? [workspacePlace, ...places] : places
    };
  }

  /** Never throws: a failure becomes an unavailable summary. */
  async summarize(target: ChangeTarget, fresh: boolean): Promise<ChangesSummary> {
    const { now } = this.options;
    // Only the snapshot the resolution takes can say the workspace is too large.
    let operation: 'snapshot' | 'diff' = 'snapshot';
    try {
      const resolution = await this.resolve(target, fresh);
      operation = 'diff';
      if (!resolution.ready) {
        return pendingSummary(resolution.context, resolution.state, resolution.reason);
      }
      const { context, workspacePath } = resolution;
      const files: ChangedFile[] = [];
      const committed: ChangedFile[] = [];
      if (context.places.some((place) => place.id === null)) {
        const listed = await this.list(context.workspaceId, workspacePath, resolution, null);
        files.push(...listed.files);
        committed.push(...listed.committed);
      }
      for (const place of context.places) {
        if (place.id === null || place.unavailableReason !== null) continue;
        try {
          const resolved = await this.resolvePlace(target, place.id, place.path, fresh);
          if (resolved === null) continue;
          const listed = await this.list(context.workspaceId, place.path, resolved, place.id);
          files.push(...listed.files);
          committed.push(...listed.committed);
        } catch (error) {
          // One place failing leaves the rest of the summary standing.
          this.options.reportError(error);
          place.unavailableReason = unavailableReasonFor(error, 'snapshot');
        }
      }
      return readySummary(context, files, committed, now());
    } catch (error) {
      this.options.reportError(error);
      return pendingSummary(target.context, 'unavailable', unavailableReasonFor(error, operation));
    }
  }

  /** The files one place contributes, marked as coming from it. */
  private async list(
    workspaceId: string,
    path: string,
    resolution: { from: string; to: string; splitCommitted: boolean },
    placeId: string | null
  ): Promise<{ files: ChangedFile[]; committed: ChangedFile[] }> {
    const { engine } = this.options;
    const place = (entries: readonly ChangedFileEntry[]): ChangedFile[] =>
      entries.map((entry) => ({ ...entry, placeId }));
    const sessionFiles = await engine.changedFiles(workspaceId, path, resolution.from, resolution.to);
    if (!resolution.splitCommitted) {
      return { files: place(sessionFiles), committed: [] };
    }
    const headTree = await engine.headTree(workspaceId, path);
    const uncommitted = headTree === null
      ? sessionFiles
      : await engine.changedFiles(workspaceId, path, headTree, resolution.to);
    const split = splitCommitted(sessionFiles, uncommitted);
    return { files: place(split.files), committed: place(split.committed) };
  }

  /**
   * The folder and trees one file belongs to: the workspace's own root, or the
   * place it was listed under. Null when that place has nothing to compare.
   */
  async resolveFile(
    target: ChangeTarget,
    placeId: string | null,
    fresh: boolean
  ): Promise<{ workspaceId: string; path: string; from: string; to: string } | null> {
    const workspaceId = target.context.workspaceId;
    if (placeId === null) {
      const resolution = await this.resolve(target, fresh);
      return resolution.ready
        ? { workspaceId, path: resolution.workspacePath, from: resolution.from, to: resolution.to }
        : null;
    }
    const path = this.placePath(workspaceId, placeId);
    if (path === null) return null;
    const resolved = await this.resolvePlace(target, placeId, path, fresh);
    return resolved === null
      ? null
      : { workspaceId, path, from: resolved.from, to: resolved.to };
  }

  /** Null when this place has nothing to compare yet, such as a baseline still being taken. */
  private async resolvePlace(
    target: ChangeTarget,
    placeId: string,
    path: string,
    fresh: boolean
  ): Promise<PlaceResolution | null> {
    const { context, segment, review } = target;
    const workspaceId = context.workspaceId;
    if (review !== null) {
      return { placeId, path, from: review.fromTree, to: review.toTree, splitCommitted: false };
    }
    const current = await this.options.snapshots.get(workspaceId, path, fresh);
    if (context.source.kind === 'session' && context.source.view === 'session') {
      const root = segment === null
        ? undefined
        : this.options.repository.listRoots(segment.id).find((entry) => entry.placeId === placeId);
      if (root?.baselineTree == null || root.state !== 'ready') return null;
      const headMoved = current.head !== null && root.baselineHead !== null
        && current.head !== root.baselineHead;
      return { placeId, path, from: root.baselineTree, to: current.tree, splitCommitted: headMoved };
    }
    const headTree = await this.options.engine.headTree(workspaceId, path);
    if (headTree === null) return null;
    return { placeId, path, from: headTree, to: current.tree, splitCommitted: false };
  }

  /** The workspace's own root: the one a diff, a review or a file path is resolved against. */
  async resolve(target: ChangeTarget, fresh: boolean): Promise<ChangeResolution> {
    const { context, segment, review } = target;
    const unavailable = (reason: ChangesUnavailableReason): ChangeResolution =>
      ({ ready: false, context, state: 'unavailable', reason });
    // Only the session view needs the baseline; the uncommitted view compares against HEAD.
    if (context.source.kind === 'session' && context.source.view === 'session' && segment !== null
      && (segment.state !== 'ready' || segment.baselineTree === null)) {
      return segment.state === 'capturing'
        ? { ready: false, context, state: 'capturing', reason: null }
        : unavailable(segment.unavailableReason ?? 'failed');
    }
    const workspace = this.options.lookupWorkspace(context.workspaceId);
    if (workspace === null || !workspace.available) {
      return unavailable('workspace-unavailable');
    }
    const workspacePath = workspace.canonicalPath;
    const ready = (from: string, to: string, split = false): ChangeResolution =>
      ({ ready: true, context, workspacePath, from, to, splitCommitted: split });

    if (review !== null) {
      return ready(review.fromTree, review.toTree);
    }
    if (context.source.kind === 'workspace' && !(await this.options.isGitAvailable())) {
      return unavailable('git-missing');
    }
    const current = await this.options.snapshots.get(context.workspaceId, workspacePath, fresh);
    if (context.source.kind === 'session' && context.source.view === 'session' && segment?.baselineTree) {
      const headMoved = current.head !== null && segment.baselineHead !== null
        && current.head !== segment.baselineHead;
      return ready(segment.baselineTree, current.tree, headMoved);
    }
    const headTree = await this.options.engine.headTree(context.workspaceId, workspacePath);
    return headTree === null ? unavailable('not-a-repository') : ready(headTree, current.tree);
  }

  /** Where a place's files live; the workspace's own path when it is not a place. */
  placePath(workspaceId: string, placeId: string | null): string | null {
    if (placeId === null) {
      const workspace = this.options.lookupWorkspace(workspaceId);
      return workspace === null || !workspace.available ? null : workspace.canonicalPath;
    }
    const place = this.options.repository.getPlace(placeId);
    return place === null || place.workspaceId !== workspaceId ? null : place.path;
  }
}
