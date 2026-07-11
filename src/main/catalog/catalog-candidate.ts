import { createHash } from 'node:crypto';

import { z } from 'zod';

import { ProviderIdSchema } from '../../shared/contracts';

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
    source: z.strictObject({
      key: z.string().min(1).max(32_768),
      fingerprint: CatalogSourceFingerprintSchema.nullable()
    })
  })
  .refine((candidate) => candidate.createdAt <= candidate.updatedAt, {
    message: 'Session creation time cannot be after its update time.'
  });

export type CatalogSourceFingerprint = z.infer<
  typeof CatalogSourceFingerprintSchema
>;
export type CatalogCandidate = z.infer<typeof CatalogCandidateSchema>;

export function createSessionId(provider: string, nativeId: string): string {
  return createHash('sha256')
    .update(provider)
    .update('\0')
    .update(nativeId)
    .digest('hex');
}
