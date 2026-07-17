import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ProviderId } from '../../shared/contracts';
import type { StoredCatalogSource } from '../storage/catalog-repository';
import { jsonSessionRecording } from './fixtures/json-session-recordings';
import { discoverJsonSessions } from './json-session-source';

const temporaryDirectories: string[] = [];

async function temporaryRoot(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'lumora-json-sessions-'));
  temporaryDirectories.push(directory);
  return directory;
}

async function writeProject(
  storageRoot: string,
  project: string,
  workspacePath: string,
  fileName: string,
  recording: unknown
): Promise<string> {
  const projectRoot = join(storageRoot, project);
  const chatsRoot = join(projectRoot, 'chats');
  await mkdir(chatsRoot, { recursive: true });
  await writeFile(join(projectRoot, '.project_root'), workspacePath, 'utf8');
  const sourcePath = join(chatsRoot, fileName);
  await writeFile(sourcePath, JSON.stringify(recording), 'utf8');
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

describe('discoverJsonSessions', () => {
  it('discovers metadata-only Gemini session files', async () => {
    const provider = 'gemini' as const;
    const workspacePath = '/work/gemini';
    const storageRoot = await temporaryRoot();
    const sourcePath = await writeProject(
      storageRoot,
      'project-hash',
      workspacePath,
      'session-one.json',
      jsonSessionRecording()
    );

    const result = await discoverJsonSessions({ provider, storageRoot });

    expect(result).toEqual({
      provider,
      sessions: [
        {
          provider,
          nativeId: '11111111-1111-4111-8111-111111111111',
          workspacePath,
          title: 'Refine catalog adapters',
          createdAt: '2026-07-11T01:00:00.000Z',
          updatedAt: '2026-07-11T01:10:00.000Z',
          source: {
            key: sourcePath,
            fingerprint: expect.objectContaining({ size: expect.any(Number) })
          }
        }
      ],
      discoveredCount: 1,
      unchangedCount: 0,
      invalidCount: 0
    });
    expect(JSON.stringify(result)).not.toContain('private prompt');
  });

  it('supports Windows workspace paths and safe metadata fallbacks', async () => {
    const storageRoot = await temporaryRoot();
    await writeProject(
      storageRoot,
      'windows-project',
      'D:\\code\\lumora',
      'fallback.json',
      jsonSessionRecording({
        summary: '   ',
        title: '',
        startTime: 'not-a-date',
        messages: [{ timestamp: 'also-not-a-date' }]
      })
    );

    const result = await discoverJsonSessions({ provider: 'gemini', storageRoot });

    expect(result.sessions[0]).toMatchObject({
      workspacePath: 'D:\\code\\lumora',
      title: 'Untitled session'
    });
    expect(result.sessions[0]!.createdAt).toBe(result.sessions[0]!.updatedAt);
  });

  it('reuses unchanged stored metadata without parsing JSON again', async () => {
    const storageRoot = await temporaryRoot();
    const sourcePath = await writeProject(
      storageRoot,
      'cached',
      '/work/cached',
      'cached.json',
      'deliberately invalid JSON'
    );
    const lookupSource = vi.fn(
      async (_provider: ProviderId, key: string, fingerprint): Promise<StoredCatalogSource> => ({
        fingerprint,
        candidate: {
          provider: 'gemini',
          nativeId: '22222222-2222-4222-8222-222222222222',
          workspace: {
            id: 'a'.repeat(64),
            canonicalPath: '/work/cached',
            identityKey: '/work/cached',
            displayName: 'cached',
            available: true
          },
          title: 'Cached Gemini session',
          createdAt: '2026-07-11T01:00:00.000Z',
          updatedAt: '2026-07-11T02:00:00.000Z',
          source: { key, fingerprint }
        }
      })
    );

    const result = await discoverJsonSessions({
      provider: 'gemini',
      storageRoot,
      lookupSource
    });

    expect(result.unchangedCount).toBe(1);
    expect(result.invalidCount).toBe(0);
    expect(result.sessions[0]).toMatchObject({
      nativeId: '22222222-2222-4222-8222-222222222222',
      title: 'Cached Gemini session',
      source: { key: sourcePath }
    });
  });

  it('isolates corrupt and nested files and bounds the direct file count', async () => {
    const storageRoot = await temporaryRoot();
    await writeProject(
      storageRoot,
      'a',
      '/work/a',
      'a.json',
      jsonSessionRecording({ sessionId: 'a-session' })
    );
    await writeProject(
      storageRoot,
      'b',
      '/work/b',
      'b.json',
      jsonSessionRecording({ sessionId: 'b-session' })
    );
    await writeProject(storageRoot, 'c', '/work/c', 'bad.json', 'bad JSON value');
    await writeProject(
      join(storageRoot, 'a', 'chats'),
      'nested',
      '/work/private',
      'private.json',
      jsonSessionRecording({ sessionId: 'private-session' })
    );

    const result = await discoverJsonSessions({
      provider: 'gemini',
      storageRoot,
      maxFiles: 2
    });

    expect(result.discoveredCount).toBe(2);
    expect(result.invalidCount).toBe(1);
    expect(result.sessions.some(({ nativeId }) => nativeId === 'private-session')).toBe(false);
  });

  it('returns an empty result for a missing root and rejects oversized files', async () => {
    const storageRoot = await temporaryRoot();
    const missing = await discoverJsonSessions({
      provider: 'gemini',
      storageRoot: join(storageRoot, 'missing')
    });
    expect(missing).toMatchObject({ sessions: [], invalidCount: 0 });

    await writeProject(
      storageRoot,
      'large',
      '/work/large',
      'large.json',
      jsonSessionRecording({ padding: 'x'.repeat(1_000) })
    );
    const bounded = await discoverJsonSessions({
      provider: 'gemini',
      storageRoot,
      maxBytes: 256
    });
    expect(bounded.sessions).toEqual([]);
    expect(bounded.invalidCount).toBe(1);
  });

  it('rejects a file that changes while being read', async () => {
    const storageRoot = await temporaryRoot();
    await writeProject(
      storageRoot,
      'moving',
      '/work/moving',
      'moving.json',
      jsonSessionRecording()
    );
    let chatStatCalls = 0;

    const result = await discoverJsonSessions({
      provider: 'gemini',
      storageRoot,
      statFile: async (path) => {
        const { stat } = await import('node:fs/promises');
        const value = await stat(path);
        if (path.endsWith('.json')) chatStatCalls += 1;
        return {
          size: value.size,
          mtimeMs:
            value.mtimeMs + (path.endsWith('.json') && chatStatCalls > 1 ? 1 : 0),
          isFile: () => value.isFile()
        };
      }
    });

    expect(result.sessions).toEqual([]);
    expect(result.invalidCount).toBe(1);
  });
});
