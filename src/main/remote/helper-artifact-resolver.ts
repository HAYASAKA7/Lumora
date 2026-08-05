import { createHash, timingSafeEqual } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { resolve, sep } from 'node:path';

import type { RemoteHelperCapability } from '../../shared/remote-helper-protocol';
import {
  RemoteHelperArtifactManifestSchema,
  selectRemoteHelperArtifact
} from './helper-artifact-manifest';

const MAX_MANIFEST_BYTES = 64 * 1024;

export type RemoteHelperArtifactErrorCode =
  | 'MANIFEST_INVALID'
  | 'ARTIFACT_UNAVAILABLE'
  | 'ARTIFACT_INVALID';

export class RemoteHelperArtifactError extends Error {
  constructor(readonly code: RemoteHelperArtifactErrorCode) {
    super('Lumora could not verify the packaged remote helper.');
    this.name = 'RemoteHelperArtifactError';
  }
}

export interface VerifiedRemoteHelperArtifact {
  helperVersion: string;
  protocolVersion: number;
  platform: 'win32' | 'darwin' | 'linux';
  architecture: 'x64' | 'arm64';
  absolutePath: string;
  size: number;
  sha256: string;
  capabilities: RemoteHelperCapability[];
}

export async function resolveRemoteHelperArtifact(input: {
  bundleRoot: string;
  platform: 'win32' | 'darwin' | 'linux';
  architecture: 'x64' | 'arm64';
}): Promise<VerifiedRemoteHelperArtifact> {
  const root = resolve(input.bundleRoot);
  let manifestBytes: Buffer;
  try {
    manifestBytes = await readFile(resolve(root, 'manifest.json'));
  } catch {
    throw new RemoteHelperArtifactError('MANIFEST_INVALID');
  }
  if (manifestBytes.length === 0 || manifestBytes.length > MAX_MANIFEST_BYTES) {
    throw new RemoteHelperArtifactError('MANIFEST_INVALID');
  }

  let manifest: ReturnType<typeof RemoteHelperArtifactManifestSchema.parse>;
  try {
    manifest = RemoteHelperArtifactManifestSchema.parse(
      JSON.parse(manifestBytes.toString('utf8')) as unknown
    );
  } catch {
    throw new RemoteHelperArtifactError('MANIFEST_INVALID');
  }

  let artifact: ReturnType<typeof selectRemoteHelperArtifact>;
  try {
    artifact = selectRemoteHelperArtifact(
      manifest,
      input.platform,
      input.architecture
    );
  } catch {
    throw new RemoteHelperArtifactError('ARTIFACT_UNAVAILABLE');
  }

  const absolutePath = resolve(root, ...artifact.relativePath.split('/'));
  if (!absolutePath.startsWith(`${root}${sep}`)) {
    throw new RemoteHelperArtifactError('ARTIFACT_INVALID');
  }

  let contents: Buffer;
  try {
    const metadata = await stat(absolutePath);
    if (!metadata.isFile() || metadata.size !== artifact.size) {
      throw new RemoteHelperArtifactError('ARTIFACT_INVALID');
    }
    contents = await readFile(absolutePath);
  } catch (error) {
    if (error instanceof RemoteHelperArtifactError) throw error;
    throw new RemoteHelperArtifactError('ARTIFACT_INVALID');
  }
  if (contents.length !== artifact.size) {
    throw new RemoteHelperArtifactError('ARTIFACT_INVALID');
  }
  const expected = Buffer.from(artifact.sha256, 'hex');
  const actual = createHash('sha256').update(contents).digest();
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    throw new RemoteHelperArtifactError('ARTIFACT_INVALID');
  }

  return {
    helperVersion: manifest.helperVersion,
    protocolVersion: manifest.protocolVersion,
    platform: artifact.platform,
    architecture: artifact.architecture,
    absolutePath,
    size: artifact.size,
    sha256: artifact.sha256,
    capabilities: [...artifact.capabilities]
  };
}
