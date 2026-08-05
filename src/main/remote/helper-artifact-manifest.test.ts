import { describe, expect, it } from 'vitest';

import {
  RemoteHelperArtifactManifestSchema,
  selectRemoteHelperArtifact
} from './helper-artifact-manifest';

const manifest = {
  formatVersion: 1,
  helperVersion: '0.1.0',
  protocolVersion: 1,
  artifacts: [
    {
      platform: 'linux',
      architecture: 'x64',
      relativePath: 'artifacts/linux-x64/lumora-helper',
      size: 1_234_567,
      sha256: 'a'.repeat(64),
      capabilities: ['system-info']
    },
    {
      platform: 'win32',
      architecture: 'arm64',
      relativePath: 'artifacts/windows-arm64/lumora-helper.exe',
      size: 1_345_678,
      sha256: 'b'.repeat(64),
      capabilities: ['system-info']
    }
  ]
} as const;

describe('remote helper artifact manifest', () => {
  it('selects the exact target artifact independent of controller OS', () => {
    const parsed = RemoteHelperArtifactManifestSchema.parse(manifest);
    expect(selectRemoteHelperArtifact(parsed, 'win32', 'arm64').relativePath)
      .toBe('artifacts/windows-arm64/lumora-helper.exe');
  });

  it('rejects traversal, invalid digests, empty files, and duplicate targets', () => {
    expect(RemoteHelperArtifactManifestSchema.safeParse({
      ...manifest,
      artifacts: [{ ...manifest.artifacts[0], relativePath: '../helper' }]
    }).success).toBe(false);
    expect(RemoteHelperArtifactManifestSchema.safeParse({
      ...manifest,
      artifacts: [{ ...manifest.artifacts[0], sha256: 'not-a-digest' }]
    }).success).toBe(false);
    expect(RemoteHelperArtifactManifestSchema.safeParse({
      ...manifest,
      artifacts: [{ ...manifest.artifacts[0], size: 0 }]
    }).success).toBe(false);
    expect(RemoteHelperArtifactManifestSchema.safeParse({
      ...manifest,
      artifacts: [manifest.artifacts[0], manifest.artifacts[0]]
    }).success).toBe(false);
  });

  it('fails closed when an artifact target is unavailable', () => {
    const parsed = RemoteHelperArtifactManifestSchema.parse(manifest);
    expect(() => selectRemoteHelperArtifact(parsed, 'darwin', 'x64'))
      .toThrow(/not contain/i);
  });
});
