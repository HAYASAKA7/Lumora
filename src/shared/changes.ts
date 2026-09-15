import { z } from 'zod';

const PathSchema = z.string().min(1).max(4_096);

export const ChangeStatusSchema = z.enum(['added', 'modified', 'deleted', 'renamed', 'type-changed']);

export const ChangedFileSchema = z.strictObject({
  path: PathSchema,
  /** The path before a rename. */
  oldPath: PathSchema.nullable(),
  status: ChangeStatusSchema,
  /** Null for binary files. */
  additions: z.number().int().min(0).nullable(),
  deletions: z.number().int().min(0).nullable(),
  binary: z.boolean()
});

export type ChangedFile = z.infer<typeof ChangedFileSchema>;

const OwnerIdSchema = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);
const WorkspaceIdSchema = z.string().regex(/^[a-z0-9_-]{1,128}$/);
const ChangesStateSchema = z.enum(['capturing', 'ready', 'unavailable']);

export const ChangesViewSchema = z.enum(['session', 'uncommitted']);
export type ChangesView = z.infer<typeof ChangesViewSchema>;

export const ChangesUnavailableReasonSchema = z.enum([
  'git-missing', 'workspace-unavailable', 'too-large', 'failed', 'not-a-repository'
]);
export type ChangesUnavailableReason = z.infer<typeof ChangesUnavailableReasonSchema>;

export const ChangesSourceSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('session'), ownerId: OwnerIdSchema, view: ChangesViewSchema }),
  z.strictObject({ kind: z.literal('workspace'), workspaceId: WorkspaceIdSchema }),
  z.strictObject({ kind: z.literal('review'), reviewId: OwnerIdSchema })
]);
export type ChangesSource = z.infer<typeof ChangesSourceSchema>;

export const ChangesSummarySchema = z.strictObject({
  source: ChangesSourceSchema,
  workspaceId: WorkspaceIdSchema,
  state: ChangesStateSchema,
  unavailableReason: ChangesUnavailableReasonSchema.nullable(),
  /** The baseline was taken after the agent started, so its first edits may be missing. */
  baselineLate: z.boolean(),
  /** Other live sessions share this workspace, so their changes appear here too. */
  sharedWorkspace: z.boolean(),
  files: z.array(ChangedFileSchema).max(5_000),
  /** Files whose content now equals a new commit. */
  committed: z.array(ChangedFileSchema).max(5_000),
  truncated: z.boolean(),
  checkedAt: z.iso.datetime().nullable()
});
export type ChangesSummary = z.infer<typeof ChangesSummarySchema>;

export const ChangesFileDiffSchema = z.strictObject({
  path: PathSchema,
  patch: z.string().max(262_144),
  binary: z.boolean(),
  truncated: z.boolean()
});
export type ChangesFileDiff = z.infer<typeof ChangesFileDiffSchema>;

export const ChangesHistorySchema = z.strictObject({
  segments: z.array(z.strictObject({
    ownerId: OwnerIdSchema,
    ownerKind: z.enum(['terminal', 'unified']),
    catalogSessionId: z.string().max(128).nullable(),
    createdAt: z.iso.datetime(),
    endedAt: z.iso.datetime().nullable(),
    reviews: z.array(z.strictObject({
      reviewId: OwnerIdSchema,
      fileCount: z.number().int().min(0),
      reviewedAt: z.iso.datetime()
    })).max(500)
  })).max(500)
});
export type ChangesHistory = z.infer<typeof ChangesHistorySchema>;

export const ChangesCountSchema = z.strictObject({
  ownerId: OwnerIdSchema,
  workspaceId: WorkspaceIdSchema,
  state: ChangesStateSchema,
  changedFileCount: z.number().int().min(0)
});
export type ChangesCount = z.infer<typeof ChangesCountSchema>;
