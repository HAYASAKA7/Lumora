import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';

import { afterEach, describe, expect, it } from 'vitest';

interface VerificationInput {
  rootDir: string;
  provider: string;
  sourcePlatform: string;
  destinationPlatform: string;
  providerVersion: string;
  lumoraCommit: string;
  now?: Date;
}

interface VerificationRecorder {
  recordTransferVerification(input: VerificationInput): {
    provider: string;
    sourcePlatform: string;
    destinationPlatform: string;
    providerVersion: string;
    verifiedAt: string;
    lumoraCommit: string;
    evidenceId: string;
  };
}

const require = createRequire(import.meta.url);
const roots: string[] = [];
const EMPTY_TABLE = `import type { VerifiedTransferRoute } from './transfer-adapter';

export const VERIFIED_TRANSFER_ROUTES: readonly VerifiedTransferRoute[] =
  Object.freeze([]);
`;

async function fixtureRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'lumora-transfer-verification-'));
  roots.push(root);
  const transferRoot = join(root, 'src', 'main', 'transfer');
  await mkdir(transferRoot, { recursive: true });
  await writeFile(
    join(transferRoot, 'verified-transfer-routes.ts'),
    EMPTY_TABLE,
    'utf8'
  );
  return root;
}

function loadRecorder(): VerificationRecorder {
  return require(
    '../../../scripts/release/record-transfer-verification.cjs'
  ) as VerificationRecorder;
}

describe('packaged transfer verification records', () => {
  afterEach(async () => {
    await Promise.all(
      roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))
    );
  });

  it('records and deterministically renders literal evidence-backed routes', async () => {
    const rootDir = await fixtureRoot();
    const recorder = loadRecorder();

    const record = recorder.recordTransferVerification({
      rootDir,
      provider: 'opencode',
      sourcePlatform: 'win32',
      destinationPlatform: 'linux',
      providerVersion: '1.2.3',
      lumoraCommit: 'a'.repeat(40),
      now: new Date('2026-07-29T12:00:00.000Z')
    });

    expect(record).toMatchObject({
      provider: 'opencode',
      sourcePlatform: 'win32',
      destinationPlatform: 'linux',
      providerVersion: '1.2.3',
      lumoraCommit: 'a'.repeat(40),
      verifiedAt: '2026-07-29T12:00:00.000Z'
    });
    expect(record.evidenceId).toMatch(/^[a-f0-9]{64}$/);

    const generated = await readFile(
      join(rootDir, 'src', 'main', 'transfer', 'verified-transfer-routes.ts'),
      'utf8'
    );
    expect(generated).toContain('provider: "opencode"');
    expect(generated).toContain('sourcePlatform: "win32"');
    expect(generated).toContain('destinationPlatform: "linux"');
    expect(generated).toContain(`evidenceId: "${record.evidenceId}"`);
    expect(generated).toContain('Literal evidence-backed rows');
  });

  it('refuses duplicate or malformed evidence', async () => {
    const rootDir = await fixtureRoot();
    const recorder = loadRecorder();
    const valid = {
      rootDir,
      provider: 'opencode',
      sourcePlatform: 'darwin',
      destinationPlatform: 'darwin',
      providerVersion: '1.2.3',
      lumoraCommit: 'b'.repeat(40),
      now: new Date('2026-07-29T12:00:00.000Z')
    };

    recorder.recordTransferVerification(valid);
    expect(() => recorder.recordTransferVerification(valid)).toThrow(
      'already exists'
    );
    expect(() =>
      recorder.recordTransferVerification({
        ...valid,
        provider: 'codex',
        now: new Date('2026-07-29T12:01:00.000Z')
      })
    ).toThrow('provider');
    expect(() =>
      recorder.recordTransferVerification({
        ...valid,
        sourcePlatform: 'freebsd',
        now: new Date('2026-07-29T12:01:00.000Z')
      })
    ).toThrow('source platform');
    expect(() =>
      recorder.recordTransferVerification({
        ...valid,
        lumoraCommit: 'not-a-commit',
        now: new Date('2026-07-29T12:01:00.000Z')
      })
    ).toThrow('commit');
  });
});
