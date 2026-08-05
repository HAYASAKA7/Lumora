import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  RemoteHelperArtifactError,
  resolveRemoteHelperArtifact
} from './helper-artifact-resolver';

function bundle(contents = Buffer.from('verified-helper')) {
  const root = mkdtempSync(join(tmpdir(), 'lumora-runtime-helper-'));
  const relativePath = 'artifacts/linux-x64/lumora-helper';
  const artifactPath = join(root, ...relativePath.split('/'));
  mkdirSync(dirname(artifactPath), { recursive: true });
  writeFileSync(artifactPath, contents);
  writeFileSync(join(root, 'manifest.json'), JSON.stringify({
    formatVersion: 1,
    helperVersion: '0.1.0',
    protocolVersion: 1,
    artifacts: [{
      platform: 'linux',
      architecture: 'x64',
      relativePath,
      size: contents.length,
      sha256: createHash('sha256').update(contents).digest('hex'),
      capabilities: ['system-info']
    }]
  }));
  return { root, artifactPath, contents };
}

describe('runtime remote helper artifact resolver', () => {
  it('returns only an exact, contained, size- and digest-verified artifact', async () => {
    const fixture = bundle();

    await expect(resolveRemoteHelperArtifact({
      bundleRoot: fixture.root,
      platform: 'linux',
      architecture: 'x64'
    })).resolves.toMatchObject({
      helperVersion: '0.1.0',
      protocolVersion: 1,
      platform: 'linux',
      architecture: 'x64',
      absolutePath: fixture.artifactPath,
      size: fixture.contents.length,
      capabilities: ['system-info']
    });
  });

  it('fails closed for an unsupported platform and architecture', async () => {
    const fixture = bundle();

    await expect(resolveRemoteHelperArtifact({
      bundleRoot: fixture.root,
      platform: 'darwin',
      architecture: 'arm64'
    })).rejects.toMatchObject({
      name: RemoteHelperArtifactError.name,
      code: 'ARTIFACT_UNAVAILABLE'
    });
  });

  it('rejects a manifest larger than its runtime control limit', async () => {
    const fixture = bundle();
    writeFileSync(join(fixture.root, 'manifest.json'), Buffer.alloc(64 * 1024 + 1));

    await expect(resolveRemoteHelperArtifact({
      bundleRoot: fixture.root,
      platform: 'linux',
      architecture: 'x64'
    })).rejects.toMatchObject({ code: 'MANIFEST_INVALID' });
  });

  it('rejects artifact size and digest mismatches with sanitized errors', async () => {
    const fixture = bundle();
    writeFileSync(fixture.artifactPath, Buffer.from('changed'));

    await expect(resolveRemoteHelperArtifact({
      bundleRoot: fixture.root,
      platform: 'linux',
      architecture: 'x64'
    })).rejects.toMatchObject({ code: 'ARTIFACT_INVALID' });

    const sameSize = bundle(Buffer.from('same-size'));
    writeFileSync(sameSize.artifactPath, Buffer.from('tampered!'));
    await expect(resolveRemoteHelperArtifact({
      bundleRoot: sameSize.root,
      platform: 'linux',
      architecture: 'x64'
    })).rejects.toMatchObject({ code: 'ARTIFACT_INVALID' });
  });
});
