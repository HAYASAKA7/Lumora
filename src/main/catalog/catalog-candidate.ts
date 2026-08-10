import { createHash } from 'node:crypto';

import {
  ExecutionTargetIdSchema,
  LOCAL_EXECUTION_TARGET_ID,
  type ExecutionTargetId
} from '../../shared/contracts';

import { z } from 'zod';

import {
  LifetimeTokenCountSchema,
  ProviderIdSchema
} from '../../shared/contracts';

const StableIdSchema = z.string().regex(/^[a-f0-9]{64}$/);

export const CatalogSourceFingerprintSchema = z.strictObject({
  size: z.number().int().nonnegative(),
  modifiedAtMs: z.number().int().nonnegative()
});

export const CatalogCandidateSchema = z
  .strictObject({
    provider: ProviderIdSchema,
    nativeId: z.string().trim().min(1).max(256),
    workspace: z.strictObject({
      id: StableIdSchema,
      canonicalPath: z.string().min(1).max(32_768),
      identityKey: z.string().min(1).max(32_768),
      displayName: z.string().trim().min(1).max(256),
      available: z.boolean()
    }),
    title: z.string().trim().min(1).max(256),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
    lifetimeTokens: LifetimeTokenCountSchema.nullable(),
    source: z.strictObject({
      key: z.string().min(1).max(32_768),
      fingerprint: CatalogSourceFingerprintSchema.nullable()
    })
  })
  .refine(
    (candidate) => Date.parse(candidate.createdAt) <= Date.parse(candidate.updatedAt),
    {
      message: 'Session creation time cannot be after its update time.'
    }
  );

export type CatalogSourceFingerprint = z.infer<
  typeof CatalogSourceFingerprintSchema
>;
export type CatalogCandidate = z.infer<typeof CatalogCandidateSchema>;

export function createSessionId(
  provider: string,
  nativeId: string,
  executionTargetId: ExecutionTargetId = LOCAL_EXECUTION_TARGET_ID
): string {
  const targetId = ExecutionTargetIdSchema.parse(executionTargetId);
  const hash = createHash('sha256');
  if (targetId !== LOCAL_EXECUTION_TARGET_ID) {
    hash.update(targetId).update('\0');
  }
  return hash.update(provider).update('\0').update(nativeId).digest('hex');
}
