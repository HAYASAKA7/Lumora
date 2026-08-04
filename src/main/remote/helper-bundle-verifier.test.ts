import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import { afterEach, describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { verifyHelperBundle } = require('../../../scripts/helper/verify-helper.cjs') as {
  verifyHelperBundle(root: string): unknown;
};

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

const targets = [
  ['darwin', 'arm64', 'macos-arm64/lumora-helper', Buffer.from([0xcf, 0xfa, 0xed, 0xfe])],
  ['darwin', 'x64', 'macos-x64/lumora-helper', Buffer.from([0xcf, 0xfa, 0xed, 0xfe])],
  ['linux', 'arm64', 'linux-arm64/lumora-helper', Buffer.from([0x7f, 0x45, 0x4c, 0x46])],
  ['linux', 'x64', 'linux-x64/lumora-helper', Buffer.from([0x7f, 0x45, 0x4c, 0x46])],
  ['win32', 'arm64', 'windows-arm64/lumora-helper.exe', Buffer.from([0x4d, 0x5a, 0, 0])],
  ['win32', 'x64', 'windows-x64/lumora-helper.exe', Buffer.from([0x4d, 0x5a, 0, 0])]
] as const;

function bundle() {
  const root = mkdtempSync(join(tmpdir(), 'lumora-helper-bundle-'));
  roots.push(root);
  const artifacts = targets.map(([platform, architecture, suffix, contents]) => {
    const relativePath = `artifacts/${suffix}`;
    const file = join(root, ...relativePath.split('/'));
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, contents);
    return {
      platform,
      architecture,
      relativePath,
      size: contents.length,
      sha256: createHash('sha256').update(contents).digest('hex'),
      capabilities: ['system-info']
    };
  });
  const manifest = {
    formatVersion: 1,
    helperVersion: '0.1.0',
    protocolVersion: 1,
    artifacts
  };
  writeFileSync(join(root, 'manifest.json'), JSON.stringify(manifest));
  return { root, manifest };
}

describe('packaged helper bundle verification', () => {
  it('verifies all target binaries, sizes, formats, and digests', () => {
    const { root } = bundle();
    expect(verifyHelperBundle(root)).toMatchObject({ helperVersion: '0.1.0' });
  });

  it('rejects a modified artifact', () => {
    const { root, manifest } = bundle();
    const artifact = manifest.artifacts[0]!;
    writeFileSync(join(root, ...artifact.relativePath.split('/')), Buffer.from('tampered'));
    expect(() => verifyHelperBundle(root)).toThrow(/file size|digest|header/i);
  });

  it('rejects manifest traversal before reading outside the bundle', () => {
    const { root, manifest } = bundle();
    manifest.artifacts[0]!.relativePath = '../outside' as never;
    writeFileSync(join(root, 'manifest.json'), JSON.stringify(manifest));
    expect(() => verifyHelperBundle(root)).toThrow(/unsafe/i);
  });
});
