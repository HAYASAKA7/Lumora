import type { DatabaseSync, StatementSync } from 'node:sqlite';

import type {
  ChangeOwnerKind,
  ChangeSegmentState,
  ChangeSegmentUnavailableReason
} from '../../shared/changes';
import {
  ExecutionTargetIdSchema,
  LOCAL_EXECUTION_TARGET_ID,
  type ExecutionTargetId
} from '../../shared/contracts';

export type UnavailableReason = ChangeSegmentUnavailableReason;
export type SegmentOwnerKind = ChangeOwnerKind;
export type SegmentState = ChangeSegmentState;

export interface ChangeSegment {
  id: string;
  workspaceId: string;
  ownerKind: SegmentOwnerKind;
  ownerId: string;
  catalogSessionId: string | null;
  snapshotKind: 'repository' | 'folder' | null;
  baselineTree: string | null;
  baselineHead: string | null;
  baselineLate: boolean;
  state: SegmentState;
  unavailableReason: UnavailableReason | null;
  createdAt: string;
  endedAt: string | null;
}

export interface ChangeReview {
  id: string;
  segmentId: string;
  /** Which watched place the batch covered; the workspace itself when null. */
  placeId: string | null;
  fromTree: string;
  toTree: string;
  fileCount: number;
  reviewedAt: string;
}

/** A folder a workspace's sessions watch besides the workspace itself. */
export interface ChangePlace {
  id: string;
  workspaceId: string;
  path: string;
  createdAt: string;
}

export interface CreatePlaceInput {
  id: string;
  workspaceId: string;
  path: string;
  createdAt: string;
}

/** One segment's baseline for one extra place; the workspace's own lives on the segment. */
export interface ChangeSegmentRoot {
  segmentId: string;
  placeId: string;
  path: string;
  snapshotKind: 'repository' | 'folder' | null;
  baselineTree: string | null;
  baselineHead: string | null;
  baselineLate: boolean;
  state: SegmentState;
  unavailableReason: UnavailableReason | null;
}

export interface CreateSegmentInput {
  id: string;
  workspaceId: string;
  ownerKind: SegmentOwnerKind;
  ownerId: string;
  catalogSessionId: string | null;
  createdAt: string;
}

export interface BaselineInput {
  snapshotKind: 'repository' | 'folder';
  tree: string;
  head: string | null;
  late: boolean;
}

interface SegmentRow {
  id: string;
  workspace_id: string;
  owner_kind: SegmentOwnerKind;
  owner_id: string;
  catalog_session_id: string | null;
  snapshot_kind: 'repository' | 'folder' | null;
  baseline_tree: string | null;
  baseline_head: string | null;
  baseline_late: number;
  state: SegmentState;
  unavailable_reason: UnavailableReason | null;
  created_at: string;
  ended_at: string | null;
}

interface ReviewRow {
  id: string;
  segment_id: string;
  place_id: string | null;
  from_tree: string;
  to_tree: string;
  file_count: number;
  reviewed_at: string;
}

interface PlaceRow {
  id: string;
  workspace_id: string;
  path: string;
  created_at: string;
}

interface RootRow {
  segment_id: string;
  place_id: string;
  path: string;
  snapshot_kind: 'repository' | 'folder' | null;
  baseline_tree: string | null;
  baseline_head: string | null;
  baseline_late: number;
  state: SegmentState;
  unavailable_reason: UnavailableReason | null;
}

const SEGMENT_COLUMNS = `id, workspace_id, owner_kind, owner_id, catalog_session_id, snapshot_kind,
  baseline_tree, baseline_head, baseline_late, state, unavailable_reason, created_at, ended_at`;

const REVIEW_COLUMNS =
  'r.id, r.segment_id, r.place_id, r.from_tree, r.to_tree, r.file_count, r.reviewed_at';

const PLACE_COLUMNS = 'id, workspace_id, path, created_at';

const ROOT_COLUMNS = `t.segment_id, t.place_id, p.path, t.snapshot_kind, t.baseline_tree,
  t.baseline_head, t.baseline_late, t.state, t.unavailable_reason`;

function toSegment(row: SegmentRow): ChangeSegment {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    ownerKind: row.owner_kind,
    ownerId: row.owner_id,
    catalogSessionId: row.catalog_session_id,
    snapshotKind: row.snapshot_kind,
    baselineTree: row.baseline_tree,
    baselineHead: row.baseline_head,
    baselineLate: row.baseline_late === 1,
    state: row.state,
    unavailableReason: row.unavailable_reason,
    createdAt: row.created_at,
    endedAt: row.ended_at
  };
}

function toPlace(row: PlaceRow): ChangePlace {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    path: row.path,
    createdAt: row.created_at
  };
}

function toRoot(row: RootRow): ChangeSegmentRoot {
  return {
    segmentId: row.segment_id,
    placeId: row.place_id,
    path: row.path,
    snapshotKind: row.snapshot_kind,
    baselineTree: row.baseline_tree,
    baselineHead: row.baseline_head,
    baselineLate: row.baseline_late === 1,
    state: row.state,
    unavailableReason: row.unavailable_reason
  };
}

function toReview(row: ReviewRow): ChangeReview {
  return {
    id: row.id,
    segmentId: row.segment_id,
    placeId: row.place_id,
    fromTree: row.from_tree,
    toTree: row.to_tree,
    fileCount: row.file_count,
    reviewedAt: row.reviewed_at
  };
}

/** Change segments (one per session run) and the review batches recorded against them, for one execution target. */
export class ChangesRepository {
  private readonly executionTargetId: ExecutionTargetId;
  private readonly statements = new Map<string, StatementSync>();

  constructor(
    private readonly database: DatabaseSync,
    executionTargetId: ExecutionTargetId = LOCAL_EXECUTION_TARGET_ID
  ) {
    this.executionTargetId = ExecutionTargetIdSchema.parse(executionTargetId);
  }

  private prepare(sql: string): StatementSync {
    const cached = this.statements.get(sql);
    if (cached !== undefined) return cached;
    const statement = this.database.prepare(sql);
    this.statements.set(sql, statement);
    return statement;
  }

  createSegment(input: CreateSegmentInput): void {
    this.prepare(
      `INSERT INTO workspace_change_segment (
        id, execution_target_id, workspace_id, owner_kind, owner_id,
        catalog_session_id, state, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, 'capturing', ?)`
    ).run(
      input.id,
      this.executionTargetId,
      input.workspaceId,
      input.ownerKind,
      input.ownerId,
      input.catalogSessionId,
      input.createdAt
    );
  }

  getSegmentByOwner(ownerId: string): ChangeSegment | null {
    const row = this.prepare(
      `SELECT ${SEGMENT_COLUMNS} FROM workspace_change_segment
       WHERE execution_target_id = ? AND owner_id = ?`
    ).get(this.executionTargetId, ownerId) as unknown as SegmentRow | undefined;
    return row === undefined ? null : toSegment(row);
  }

  getSegment(id: string): ChangeSegment | null {
    const row = this.prepare(
      `SELECT ${SEGMENT_COLUMNS} FROM workspace_change_segment
       WHERE execution_target_id = ? AND id = ?`
    ).get(this.executionTargetId, id) as unknown as SegmentRow | undefined;
    return row === undefined ? null : toSegment(row);
  }

  recordBaseline(segmentId: string, baseline: BaselineInput): void {
    this.prepare(
      `UPDATE workspace_change_segment
       SET snapshot_kind = ?, baseline_tree = ?, baseline_head = ?, baseline_late = ?,
         state = 'ready', unavailable_reason = NULL
       WHERE execution_target_id = ? AND id = ?`
    ).run(
      baseline.snapshotKind,
      baseline.tree,
      baseline.head,
      baseline.late ? 1 : 0,
      this.executionTargetId,
      segmentId
    );
  }

  markUnavailable(segmentId: string, reason: UnavailableReason): void {
    this.prepare(
      `UPDATE workspace_change_segment SET state = 'unavailable', unavailable_reason = ?
       WHERE execution_target_id = ? AND id = ?`
    ).run(reason, this.executionTargetId, segmentId);
  }

  endSegment(ownerId: string, endedAt: string): void {
    this.prepare(
      `UPDATE workspace_change_segment SET ended_at = COALESCE(ended_at, ?)
       WHERE execution_target_id = ? AND owner_id = ?`
    ).run(endedAt, this.executionTargetId, ownerId);
  }

  endOpenSegments(endedAt: string): void {
    this.prepare(
      `UPDATE workspace_change_segment SET ended_at = ?
       WHERE execution_target_id = ? AND ended_at IS NULL`
    ).run(endedAt, this.executionTargetId);
  }

  linkCatalogSession(ownerId: string, catalogSessionId: string): void {
    this.prepare(
      `UPDATE workspace_change_segment SET catalog_session_id = ?
       WHERE execution_target_id = ? AND owner_id = ?
         AND (catalog_session_id IS NULL OR catalog_session_id <> ?)`
    ).run(catalogSessionId, this.executionTargetId, ownerId, catalogSessionId);
  }

  listPlaces(workspaceId: string): ChangePlace[] {
    const rows = this.prepare(
      `SELECT ${PLACE_COLUMNS} FROM workspace_change_place
       WHERE execution_target_id = ? AND workspace_id = ?
       ORDER BY created_at, rowid`
    ).all(this.executionTargetId, workspaceId) as unknown as PlaceRow[];
    return rows.map(toPlace);
  }

  getPlace(id: string): ChangePlace | null {
    const row = this.prepare(
      `SELECT ${PLACE_COLUMNS} FROM workspace_change_place
       WHERE execution_target_id = ? AND id = ?`
    ).get(this.executionTargetId, id) as unknown as PlaceRow | undefined;
    return row === undefined ? null : toPlace(row);
  }

  addPlace(input: CreatePlaceInput): void {
    this.prepare(
      `INSERT INTO workspace_change_place (
        id, execution_target_id, workspace_id, path, created_at
      ) VALUES (?, ?, ?, ?, ?)`
    ).run(input.id, this.executionTargetId, input.workspaceId, input.path, input.createdAt);
  }

  /** Takes the place's baselines and reviewed batches with it. */
  removePlace(id: string): void {
    this.prepare(
      'DELETE FROM workspace_change_place WHERE execution_target_id = ? AND id = ?'
    ).run(this.executionTargetId, id);
  }

  /** The extra places this segment watches; the workspace's own root is the segment. */
  listRoots(segmentId: string): ChangeSegmentRoot[] {
    const rows = this.prepare(
      `SELECT ${ROOT_COLUMNS} FROM workspace_change_segment_root t
       JOIN workspace_change_place p ON p.id = t.place_id
       JOIN workspace_change_segment s ON s.id = t.segment_id
       WHERE s.execution_target_id = ? AND t.segment_id = ?
       ORDER BY p.created_at, p.rowid`
    ).all(this.executionTargetId, segmentId) as unknown as RootRow[];
    return rows.map(toRoot);
  }

  createRoot(segmentId: string, placeId: string): void {
    this.prepare(
      `INSERT INTO workspace_change_segment_root (segment_id, place_id, state)
       VALUES (?, ?, 'capturing')
       ON CONFLICT (segment_id, place_id) DO NOTHING`
    ).run(segmentId, placeId);
  }

  recordRootBaseline(segmentId: string, placeId: string, baseline: BaselineInput): void {
    this.prepare(
      `UPDATE workspace_change_segment_root
       SET snapshot_kind = ?, baseline_tree = ?, baseline_head = ?, baseline_late = ?,
         state = 'ready', unavailable_reason = NULL
       WHERE segment_id = ? AND place_id = ?`
    ).run(
      baseline.snapshotKind,
      baseline.tree,
      baseline.head,
      baseline.late ? 1 : 0,
      segmentId,
      placeId
    );
  }

  markRootUnavailable(segmentId: string, placeId: string, reason: UnavailableReason): void {
    this.prepare(
      `UPDATE workspace_change_segment_root
       SET state = 'unavailable', unavailable_reason = ?
       WHERE segment_id = ? AND place_id = ?`
    ).run(reason, segmentId, placeId);
  }

  /**
   * Records a review batch and moves the segment's baseline to what was
   * reviewed, together. Refused when the baseline is no longer the review's
   * starting tree, so a stale review cannot overwrite a newer one.
   */
  recordReview(review: ChangeReview): void {
    let transactionStarted = false;
    try {
      this.database.exec('BEGIN IMMEDIATE');
      transactionStarted = true;
      this.prepare(
        `INSERT INTO workspace_change_review (
          id, segment_id, place_id, from_tree, to_tree, file_count, reviewed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).run(
        review.id,
        review.segmentId,
        review.placeId,
        review.fromTree,
        review.toTree,
        review.fileCount,
        review.reviewedAt
      );
      const moved = review.placeId === null
        ? this.prepare(
            `UPDATE workspace_change_segment SET baseline_tree = ?
             WHERE execution_target_id = ? AND id = ? AND baseline_tree = ?`
          ).run(review.toTree, this.executionTargetId, review.segmentId, review.fromTree)
        : this.prepare(
            `UPDATE workspace_change_segment_root SET baseline_tree = ?
             WHERE segment_id = ? AND place_id = ? AND baseline_tree = ?`
          ).run(review.toTree, review.segmentId, review.placeId, review.fromTree);
      if (moved.changes !== 1) {
        throw new Error('The change segment no longer starts from the reviewed tree.');
      }
      this.database.exec('COMMIT');
      transactionStarted = false;
    } catch (error) {
      // A failed BEGIN leaves no transaction, and rolling one back would throw over the real failure.
      if (transactionStarted) this.database.exec('ROLLBACK');
      throw error;
    }
  }

  /** Newest first; a negative limit lists every review. */
  listReviews(segmentId: string, limit = -1): ChangeReview[] {
    const rows = this.prepare(
      `SELECT ${REVIEW_COLUMNS} FROM workspace_change_review r
       JOIN workspace_change_segment s ON s.id = r.segment_id
       WHERE s.execution_target_id = ? AND r.segment_id = ?
       ORDER BY r.reviewed_at DESC, r.rowid DESC
       LIMIT ?`
    ).all(this.executionTargetId, segmentId, limit) as unknown as ReviewRow[];
    return rows.map(toReview);
  }

  getReview(id: string): ChangeReview | null {
    const row = this.prepare(
      `SELECT ${REVIEW_COLUMNS} FROM workspace_change_review r
       JOIN workspace_change_segment s ON s.id = r.segment_id
       WHERE s.execution_target_id = ? AND r.id = ?`
    ).get(this.executionTargetId, id) as unknown as ReviewRow | undefined;
    return row === undefined ? null : toReview(row);
  }

  /** Newest first; a negative limit lists every segment. */
  listWorkspaceSegments(workspaceId: string, limit = -1): ChangeSegment[] {
    const rows = this.prepare(
      `SELECT ${SEGMENT_COLUMNS} FROM workspace_change_segment
       WHERE execution_target_id = ? AND workspace_id = ?
       ORDER BY created_at DESC, rowid DESC
       LIMIT ?`
    ).all(this.executionTargetId, workspaceId, limit) as unknown as SegmentRow[];
    return rows.map(toSegment);
  }

  listOpenSegments(): ChangeSegment[] {
    const rows = this.prepare(
      `SELECT ${SEGMENT_COLUMNS} FROM workspace_change_segment
       WHERE execution_target_id = ? AND ended_at IS NULL
       ORDER BY created_at DESC, rowid DESC`
    ).all(this.executionTargetId) as unknown as SegmentRow[];
    return rows.map(toSegment);
  }

  /** Deletes segments that ended before the cutoff, and returns which ones went. */
  pruneEndedBefore(cutoff: string): Array<{ segmentId: string; workspaceId: string }> {
    const rows = this.prepare(
      `DELETE FROM workspace_change_segment
       WHERE execution_target_id = ? AND ended_at IS NOT NULL AND ended_at < ?
       RETURNING id, workspace_id`
    ).all(this.executionTargetId, cutoff) as unknown as Array<{ id: string; workspace_id: string }>;
    return rows.map((row) => ({ segmentId: row.id, workspaceId: row.workspace_id }));
  }

  /** Whether a live segment other than this owner's works in the same workspace. */
  hasOtherOpenSegment(workspaceId: string, ownerId: string): boolean {
    return this.prepare(
      `SELECT 1 FROM workspace_change_segment
       WHERE execution_target_id = ? AND workspace_id = ? AND ended_at IS NULL AND owner_id <> ?
       LIMIT 1`
    ).get(this.executionTargetId, workspaceId, ownerId) !== undefined;
  }

  hasSegments(workspaceId: string): boolean {
    return this.prepare(
      `SELECT 1 FROM workspace_change_segment
       WHERE execution_target_id = ? AND workspace_id = ? LIMIT 1`
    ).get(this.executionTargetId, workspaceId) !== undefined;
  }
}
