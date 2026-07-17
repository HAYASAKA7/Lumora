import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import type { StoredCatalogSource } from '../storage/catalog-repository';
import { qwenSessionRecording } from './fixtures/qwen-session-recordings';
import { discoverQwenSessions } from './qwen-session-source';

const SESSION_ID = '33333333-3333-4333-8333-333333333333';
const temporaryDirectories: string[] = [];

async function temporaryHome(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'lumora-qwen-'));
  temporaryDirectories.push(directory);
  return directory;
}

async function writeSession(
  qwenRoot: string,
  project: string,
  sessionId: string,
  lines: readonly string[]
): Promise<string> {
  const chats = join(qwenRoot, 'projects', project, 'chats');
  await mkdir(chats, { recursive: true });
  const sourcePath = join(chats, `${sessionId}.jsonl`);
  await writeFile(sourcePath, `${lines.join('\n')}\n`, 'utf8');
  return sourcePath;
}

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true })
    )
  );
});

describe('discoverQwenSessions', () => {
  it('discovers Qwen JSONL metadata without exposing prompt content', async () => {
    const home = await temporaryHome();
    const qwenRoot = join(home, '.qwen');
    const sourcePath = await writeSession(
      qwenRoot,
      '-work-qwen',
      SESSION_ID,
      qwenSessionRecording()
    );

    const result = await discoverQwenSessions({ qwenRoot });

    expect(result).toEqual({
      provider: 'qwen',
      sessions: [{
        provider: 'qwen',
        nativeId: SESSION_ID,
        workspacePath: '/work/qwen',
        title: 'Refine Qwen catalog adapter',
        createdAt: '2026-07-11T01:00:00.000Z',
        updatedAt: '2026-07-11T01:10:00.000Z',
        source: {
          key: sourcePath,
          fingerprint: expect.objectContaining({ size: expect.any(Number) })
        }
      }],
      discoveredCount: 1,
      unchangedCount: 0,
      invalidCount: 0
    });
    expect(JSON.stringify(result)).not.toContain('private prompt');
  });

  it('accepts Windows workspaces and reuses unchanged catalog metadata', async () => {
    const home = await temporaryHome();
    const qwenRoot = join(home, 'qwen-home');
    const sourcePath = await writeSession(
      qwenRoot,
      'd--code-lumora',
      SESSION_ID,
      qwenSessionRecording({ cwd: 'D:\\code\\lumora' })
    );
    const first = await discoverQwenSessions({ qwenRoot });
    expect(first.sessions[0]!.workspacePath).toBe('D:\\code\\lumora');

    const lookupSource = vi.fn(async (_provider, key, fingerprint): Promise<StoredCatalogSource> => ({
      fingerprint,
      candidate: {
        provider: 'qwen',
        nativeId: SESSION_ID,
        workspace: {
          id: 'a'.repeat(64),
          canonicalPath: 'D:\\code\\lumora',
          identityKey: 'd:\\code\\lumora',
          displayName: 'lumora',
          available: true
        },
        title: 'Cached Qwen session',
        createdAt: '2026-07-11T01:00:00.000Z',
        updatedAt: '2026-07-11T02:00:00.000Z',
        source: { key, fingerprint }
      }
    }));
    const cached = await discoverQwenSessions({ qwenRoot, lookupSource });
    expect(cached.unchangedCount).toBe(1);
    expect(cached.sessions[0]).toMatchObject({
      title: 'Cached Qwen session',
      source: { key: sourcePath }
    });
  });

  it('bounds sources and rejects a file that changes while read', async () => {
    const home = await temporaryHome();
    const qwenRoot = join(home, '.qwen');
    await writeSession(qwenRoot, 'one', SESSION_ID, qwenSessionRecording());
    await writeSession(
      qwenRoot,
      'two',
      '66666666-6666-4666-8666-666666666666',
      qwenSessionRecording({
        sessionId: '66666666-6666-4666-8666-666666666666',
        cwd: '/work/two'
      })
    );
    const bounded = await discoverQwenSessions({ qwenRoot, maxFiles: 1 });
    expect(bounded.discoveredCount).toBe(1);
    expect(bounded.invalidCount).toBe(1);

    let statCalls = 0;
    const changed = await discoverQwenSessions({
      qwenRoot,
      maxFiles: 1,
      statFile: async (path) => {
        const { stat } = await import('node:fs/promises');
        const value = await stat(path);
        statCalls += 1;
        return {
          size: value.size,
          mtimeMs: value.mtimeMs + (statCalls > 1 ? 1 : 0),
          isFile: () => value.isFile()
        };
      }
    });
    expect(changed.sessions).toEqual([]);
    expect(changed.invalidCount).toBeGreaterThan(0);
  });
});
