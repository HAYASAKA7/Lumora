import { posix, win32 } from 'node:path';

import { z } from 'zod';

import { ProviderIdSchema, type ProviderId } from '../../shared/contracts';
import { CatalogSourceFingerprintSchema } from '../catalog/catalog-candidate';

export function isPortableAbsolutePath(value: string): boolean {
  return posix.isAbsolute(value) || win32.isAbsolute(value);
}

export const ProviderSessionRecordSchema = z.strictObject({
  provider: ProviderIdSchema,
  nativeId: z.string().trim().min(1).max(256),
  workspacePath: z
    .string()
    .min(1)
    .max(32_768)
    .refine(isPortableAbsolutePath, 'Workspace paths must be absolute.'),
  title: z.string().trim().min(1).max(256),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  source: z.strictObject({
    key: z.string().min(1).max(32_768),
    fingerprint: CatalogSourceFingerprintSchema.nullable()
  })
});

export type ProviderSessionRecord = z.infer<typeof ProviderSessionRecordSchema>;

export interface ProviderSessionDiscoveryResult {
  provider: ProviderId;
  sessions: readonly ProviderSessionRecord[];
  discoveredCount: number;
  unchangedCount: number;
  invalidCount: number;
}
