import { z } from 'zod';

import {
  REMOTE_HELPER_PROTOCOL_VERSION,
  RemoteHelperCapabilitySchema
} from '../../shared/remote-helper-protocol';
const SafeArtifactPathSchema = z.string().min(1).max(240).refine(
  (value) =>
    !value.startsWith('/') &&
    !value.startsWith('\\') &&
    !value.includes('..') &&
    !value.includes('\\') &&
    /^[A-Za-z0-9._/-]+$/u.test(value),
  'Artifact path must be a safe forward-slash relative path.'
);

export const RemoteHelperArtifactSchema = z.object({
  platform: z.enum(['win32', 'darwin', 'linux']),
  architecture: z.enum(['x64', 'arm64']),
  relativePath: SafeArtifactPathSchema,
  size: z.number().int().positive().max(128 * 1024 * 1024),
  sha256: z.string().regex(/^[a-f0-9]{64}$/u),
  capabilities: z.array(RemoteHelperCapabilitySchema).min(1).max(32)
}).strict();

export const RemoteHelperArtifactManifestSchema = z.object({
  formatVersion: z.literal(1),
  helperVersion: z.string().min(1).max(40),
  protocolVersion: z.literal(REMOTE_HELPER_PROTOCOL_VERSION),
  artifacts: z.array(RemoteHelperArtifactSchema).min(1).max(16)
}).strict().superRefine((manifest, context) => {
  const targets = new Set<string>();
  for (const [index, artifact] of manifest.artifacts.entries()) {
    const target = `${artifact.platform}-${artifact.architecture}`;
    if (targets.has(target)) {
      context.addIssue({
        code: 'custom',
        message: `Duplicate helper artifact target: ${target}`,
        path: ['artifacts', index]
      });
    }
    targets.add(target);
  }
});

export type RemoteHelperArtifactManifest = z.infer<
  typeof RemoteHelperArtifactManifestSchema
>;
export type RemoteHelperArtifact = z.infer<typeof RemoteHelperArtifactSchema>;

export function selectRemoteHelperArtifact(
  manifest: RemoteHelperArtifactManifest,
  platform: 'win32' | 'darwin' | 'linux',
  architecture: 'x64' | 'arm64'
): RemoteHelperArtifact {
  const artifact = manifest.artifacts.find((candidate) =>
    candidate.platform === platform && candidate.architecture === architecture
  );
  if (artifact === undefined) {
    throw new Error('The helper manifest does not contain this remote target.');
  }
  return artifact;
}
