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
