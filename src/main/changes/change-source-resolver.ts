import type { ChangesSource, ChangesSummary, ChangesUnavailableReason } from '../../shared/changes';
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

export interface ChangeSourceResolverOptions {
  repository: ChangesRepository;
  engine: Pick<WorkspaceSnapshotEngine, 'changedFiles' | 'headTree'>;
  snapshots: SnapshotCache;
  lookupWorkspace(workspaceId: string): { canonicalPath: string; available: boolean } | null;
  isGitAvailable(): Promise<boolean>;
  now(): string;
}

/** Turns a changes source into the two trees it compares, and those trees into a summary. */
export class ChangeSourceResolver {
  constructor(private readonly options: ChangeSourceResolverOptions) {}

  /** Throws for a session or review that is not known. */
  target(source: ChangesSource): ChangeTarget {
    const { repository } = this.options;
    if (source.kind === 'workspace') {
      return {
        context: { source, workspaceId: source.workspaceId, baselineLate: false, sharedWorkspace: false },
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
        context: { source, workspaceId: segment.workspaceId, baselineLate: false, sharedWorkspace: false },
        segment,
        review
      };
    }
    const segment = repository.getSegmentByOwner(source.ownerId);
    if (segment === null) {
      throw new Error('No changes are tracked for this session.');
    }
    const sharedWorkspace = repository.listOpenSegments().some(
      (other) => other.workspaceId === segment.workspaceId && other.id !== segment.id
    );
    return {
      context: { source, workspaceId: segment.workspaceId, baselineLate: segment.baselineLate, sharedWorkspace },
      segment,
      review: null
    };
  }

  /** Never throws: a failure becomes an unavailable summary. */
  async summarize(target: ChangeTarget, fresh: boolean): Promise<ChangesSummary> {
    const { engine, now } = this.options;
    try {
      const resolution = await this.resolve(target, fresh);
      if (!resolution.ready) {
        return pendingSummary(resolution.context, resolution.state, resolution.reason);
      }
      const { context, workspacePath, from, to } = resolution;
      const sessionFiles = await engine.changedFiles(context.workspaceId, workspacePath, from, to);
      if (!resolution.splitCommitted) {
        return readySummary(context, sessionFiles, [], now());
      }
      const headTree = await engine.headTree(context.workspaceId, workspacePath);
      const uncommitted = headTree === null
        ? sessionFiles
        : await engine.changedFiles(context.workspaceId, workspacePath, headTree, to);
      const split = splitCommitted(sessionFiles, uncommitted);
      return readySummary(context, split.files, split.committed, now());
    } catch (error) {
      return pendingSummary(target.context, 'unavailable', unavailableReasonFor(error));
    }
  }

  async resolve(target: ChangeTarget, fresh: boolean): Promise<ChangeResolution> {
    const { context, segment, review } = target;
    const unavailable = (reason: ChangesUnavailableReason): ChangeResolution =>
      ({ ready: false, context, state: 'unavailable', reason });
    if (context.source.kind === 'session' && segment !== null
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
}
