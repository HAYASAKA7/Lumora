import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import type { StoredCatalogSource } from '../storage/catalog-repository';
import { discoverCopilotSessions } from './copilot-session-source';
import { copilotEvent } from './fixtures/copilot-session-events';

const SESSION_ID = '22222222-2222-4222-8222-222222222222';
const temporaryDirectories: string[] = [];

async function temporaryHome(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'lumora-copilot-'));
  temporaryDirectories.push(directory);
  return directory;
}

async function writeSession(
  configRoot: string,
  sessionId: string,
  lines: readonly string[]
): Promise<string> {
  const sessionRoot = join(configRoot, 'session-state', sessionId);
  await mkdir(sessionRoot, { recursive: true });
  const sourcePath = join(sessionRoot, 'events.jsonl');
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

describe('discoverCopilotSessions', () => {
  it('extracts session metadata and applies the newest explicit rename', async () => {
    const home = await temporaryHome();
    const sourcePath = await writeSession(join(home, '.copilot'), SESSION_ID, [
      copilotEvent(),
      copilotEvent({
        type: 'user.message',
        id: 'event-2',
        timestamp: '2026-07-11T01:05:00.000Z',
        data: { content: 'private prompt must not become a title' }
      }),
      copilotEvent({
        type: 'session.renamed',
        id: 'event-3',
        timestamp: '2026-07-11T01:10:00.000Z',
        data: { name: 'Improve provider search' }
      })
    ]);

    const result = await discoverCopilotSessions({ homeDirectory: home, env: {} });

    expect(result).toEqual({
      provider: 'copilot',
      sessions: [
        {
          provider: 'copilot',
          nativeId: SESSION_ID,
          workspacePath: '/work/lumora',
          title: 'Improve provider search',
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

  it('honors case-insensitive COPILOT_HOME and portable workspace fields', async () => {
    const home = await temporaryHome();
    const customRoot = join(home, 'custom-copilot');
    await writeSession(customRoot, SESSION_ID, [
      copilotEvent({
        type: 'session.started',
        data: { workingDirectory: 'D:\\code\\lumora' }
      })
    ]);

    const result = await discoverCopilotSessions({
      homeDirectory: home,
      env: { copilot_home: customRoot }
    });

    expect(result.sessions[0]).toMatchObject({
      workspacePath: 'D:\\code\\lumora',
      title: 'Untitled session'
    });
  });

  it('ignores invalid session directories, missing logs, and a partial final line', async () => {
    const home = await temporaryHome();
    const root = join(home, '.copilot');
    await writeSession(root, SESSION_ID, [copilotEvent(), '{"type":"partial"']);
    await writeSession(root, 'not-a-uuid', [copilotEvent()]);
    await mkdir(
      join(root, 'session-state', '33333333-3333-4333-8333-333333333333'),
      { recursive: true }
    );

    const result = await discoverCopilotSessions({ homeDirectory: home, env: {} });

    expect(result.sessions).toHaveLength(1);
    expect(result.invalidCount).toBe(0);
  });

  it('reuses unchanged fingerprints without parsing event content', async () => {
    const home = await temporaryHome();
    const sourcePath = await writeSession(join(home, '.copilot'), SESSION_ID, [
      'not valid event JSON'
    ]);
    const lookupSource = vi.fn(
      async (_provider, key, fingerprint): Promise<StoredCatalogSource> => ({
        fingerprint,
        candidate: {
          provider: 'copilot',
          nativeId: SESSION_ID,
          workspace: {
            id: 'a'.repeat(64),
            canonicalPath: '/work/cached',
            identityKey: '/work/cached',
            displayName: 'cached',
            available: true
          },
          title: 'Cached Copilot session',
          createdAt: '2026-07-11T01:00:00.000Z',
          updatedAt: '2026-07-11T02:00:00.000Z',
          source: { key, fingerprint }
        }
      })
    );

    const result = await discoverCopilotSessions({
      homeDirectory: home,
      env: {},
      lookupSource
    });

    expect(result.unchangedCount).toBe(1);
    expect(result.sessions[0]).toMatchObject({
      title: 'Cached Copilot session',
      source: { key: sourcePath }
    });
  });

  it('bounds file count and file size', async () => {
    const home = await temporaryHome();
    const root = join(home, '.copilot');
    await writeSession(root, SESSION_ID, [copilotEvent()]);
    await writeSession(root, '33333333-3333-4333-8333-333333333333', [
      copilotEvent({ data: { cwd: '/work/second' } })
    ]);

    const countBounded = await discoverCopilotSessions({
      homeDirectory: home,
      env: {},
      maxFiles: 1
    });
    expect(countBounded.discoveredCount).toBe(1);
    expect(countBounded.invalidCount).toBe(1);

    const sizeBounded = await discoverCopilotSessions({
      homeDirectory: home,
      env: {},
      maxFileBytes: 32
    });
    expect(sizeBounded.sessions).toEqual([]);
    expect(sizeBounded.invalidCount).toBe(2);
  });

  it('rejects an event log that changes while it is read', async () => {
    const home = await temporaryHome();
    await writeSession(join(home, '.copilot'), SESSION_ID, [copilotEvent()]);
    let statCalls = 0;

    const result = await discoverCopilotSessions({
      homeDirectory: home,
      env: {},
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

    expect(result.sessions).toEqual([]);
    expect(result.invalidCount).toBe(1);
  });
});
