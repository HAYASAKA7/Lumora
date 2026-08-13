import { mkdtemp, mkdir, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import type { StoredCatalogSource } from '../storage/catalog-repository';
import { kimiIndexRecord, kimiState, kimiWire } from './fixtures/kimi-session-recordings';
import { discoverKimiSessions } from './kimi-session-source';

const ID = 'session_123e4567-e89b-42d3-a456-426614174000';
const temporaryDirectories: string[] = [];

async function temporaryRoot(): Promise<string> {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'lumora-kimi-')));
  temporaryDirectories.push(root);
  return root;
}

async function writeSession(root: string, options: { title?: string; workDir?: string } = {}) {
  const sessionDir = join(root, 'sessions', 'wd_lumora', ID);
  await mkdir(join(sessionDir, 'agents', 'main'), { recursive: true });
  await writeFile(
    join(sessionDir, 'state.json'),
    kimiState(options.title === undefined ? {} : { title: options.title }),
    'utf8'
  );
  await writeFile(join(sessionDir, 'agents', 'main', 'wire.jsonl'), `${kimiWire().join('\n')}\n`, 'utf8');
  await writeFile(join(root, 'session_index.jsonl'), `${kimiIndexRecord({
    sessionId: ID,
    sessionDir,
    workDir: options.workDir ?? '/work/lumora'
  })}\n`, 'utf8');
  return { sessionDir, statePath: join(sessionDir, 'state.json') };
}

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(temporaryDirectories.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('discoverKimiSessions', () => {
  it('discovers indexed state and effective lifetime tokens without exposing prompts', async () => {
    const root = await temporaryRoot();
    const { statePath } = await writeSession(root);

    const result = await discoverKimiSessions({ kimiRoot: root });

    expect(result).toEqual({
      provider: 'kimi',
      sessions: [{
        provider: 'kimi',
        nativeId: ID,
        workspacePath: '/work/lumora',
        title: 'Build Kimi support',
        createdAt: '2026-08-12T01:00:00.000Z',
        updatedAt: '2026-08-12T02:00:00.000Z',
        lifetimeTokens: 1515,
        source: { key: statePath, fingerprint: expect.objectContaining({ size: expect.any(Number) }) }
      }],
      discoveredCount: 1,
      unchangedCount: 0,
      invalidCount: 0
    });
    expect(JSON.stringify(result)).not.toContain('private prompt');
  });

  it('reuses unchanged state metadata and refreshes a renamed state', async () => {
    const root = await temporaryRoot();
    const { statePath } = await writeSession(root);
    const first = await discoverKimiSessions({ kimiRoot: root });
    const fingerprint = first.sessions[0]!.source.fingerprint!;
    const lookupSource = vi.fn(async (): Promise<StoredCatalogSource> => ({
      fingerprint,
      candidate: {
        provider: 'kimi', nativeId: ID,
        workspace: { id: 'a'.repeat(64), canonicalPath: '/work/lumora', identityKey: '/work/lumora', displayName: 'lumora', available: true },
        title: 'Cached Kimi title', createdAt: '2026-08-12T01:00:00.000Z', updatedAt: '2026-08-12T02:00:00.000Z', lifetimeTokens: 1515,
        source: { key: statePath, fingerprint }
      }
    }));
    const cached = await discoverKimiSessions({ kimiRoot: root, lookupSource });
    expect(cached.unchangedCount).toBe(1);
    expect(cached.sessions[0]?.title).toBe('Cached Kimi title');

    await new Promise((resolve) => setTimeout(resolve, 10));
    await writeFile(statePath, kimiState({ title: 'Renamed in Kimi' }), 'utf8');
    const renamed = await discoverKimiSessions({ kimiRoot: root, lookupSource });
    expect(renamed.sessions[0]?.title).toBe('Renamed in Kimi');
  });

  it('rejects malformed, escaped, symlinked, and over-budget session sources', async () => {
    const root = await temporaryRoot();
    const outside = await temporaryRoot();
    const escapedState = join(outside, 'state.json');
    await writeFile(escapedState, kimiState(), 'utf8');
    const linkDir = join(root, 'sessions', 'linked');
    await mkdir(join(root, 'sessions'), { recursive: true });
    await symlink(outside, linkDir, 'junction');
    await writeFile(join(root, 'session_index.jsonl'), [
      '{bad json',
      kimiIndexRecord({ sessionId: ID, sessionDir: outside, workDir: '/work/escaped' }),
      kimiIndexRecord({ sessionId: `${ID}-link`, sessionDir: linkDir, workDir: '/work/link' })
    ].join('\n'), 'utf8');

    const result = await discoverKimiSessions({ kimiRoot: root, maxIndexBytes: 16 });
    expect(result.sessions).toEqual([]);
    expect(result.invalidCount).toBeGreaterThan(0);
  });

  it('keeps session metadata when a usage record is invalid but omits token totals', async () => {
    const root = await temporaryRoot();
    const { sessionDir } = await writeSession(root);
    await writeFile(join(sessionDir, 'agents', 'main', 'wire.jsonl'), `${JSON.stringify({ type: 'usage.record', usage: { inputOther: -1, output: 2 } })}\n`, 'utf8');

    const result = await discoverKimiSessions({ kimiRoot: root });
    expect(result.sessions[0]?.lifetimeTokens).toBeNull();
    expect(result.discoveredCount).toBe(1);
  });
});
