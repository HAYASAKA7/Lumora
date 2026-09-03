import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import type { StoredCatalogSource } from '../storage/catalog-repository';
import { discoverClaudeSessions } from './claude-session-source';
import { claudeLine } from './fixtures/claude-session-lines';

const temporaryDirectories: string[] = [];

async function temporaryHome(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'lumora-claude-'));
  temporaryDirectories.push(directory);
  return directory;
}

async function writeSession(
  projectsRoot: string,
  project: string,
  fileName: string,
  lines: readonly string[]
): Promise<string> {
  const projectRoot = join(projectsRoot, project);
  await mkdir(projectRoot, { recursive: true });
  const filePath = join(projectRoot, fileName);
  await writeFile(filePath, `${lines.join('\n')}\n`, 'utf8');
  return filePath;
}

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true })
    )
  );
});

describe('discoverClaudeSessions', () => {
  it('uses the default Claude directory and extracts metadata-only fields', async () => {
    const home = await temporaryHome();
    const projects = join(home, '.claude', 'projects');
    const sourcePath = await writeSession(projects, '-work-lumora', 'one.jsonl', [
      claudeLine(),
      claudeLine({
        type: 'user',
        timestamp: '2026-07-11T01:05:00.000Z',
        message: { role: 'user', content: 'private prompt fixture' }
      }),
      claudeLine({
        type: 'ai-title',
        aiTitle: '  Catalog storage  ',
        timestamp: '2026-07-11T01:10:00.000Z'
      })
    ]);

    const result = await discoverClaudeSessions({
      homeDirectory: home,
      env: {}
    });

    expect(result).toEqual({
      provider: 'claude',
      sessions: [
        {
          provider: 'claude',
          nativeId: '11111111-1111-4111-8111-111111111111',
          workspacePath: '/work/lumora',
          title: 'Catalog storage',
          createdAt: '2026-07-11T01:00:00.000Z',
          updatedAt: '2026-07-11T01:10:00.000Z',
          lifetimeTokens: null,
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
    expect(JSON.stringify(result)).not.toContain('private prompt fixture');
  });

  it('honors CLAUDE_CONFIG_DIR and ignores nested sidecar JSONL files', async () => {
    const home = await temporaryHome();
    const config = join(home, 'custom-claude');
    const projects = join(config, 'projects');
    await writeSession(projects, 'project', 'main.jsonl', [claudeLine()]);
    await writeSession(
      join(projects, 'project'),
      'subagents',
      'agent-private.jsonl',
      [claudeLine({ sessionId: '22222222-2222-4222-8222-222222222222' })]
    );

    const result = await discoverClaudeSessions({
      homeDirectory: home,
      env: { CLAUDE_CONFIG_DIR: config }
    });

    expect(result.sessions).toHaveLength(1);
    expect(basename(result.sessions[0]!.source.key)).toBe('main.jsonl');
  });

  it('isolates malformed files and tolerates a partial final line', async () => {
    const home = await temporaryHome();
    const projects = join(home, '.claude', 'projects');
    await writeSession(projects, 'project', 'partial.jsonl', [
      claudeLine(),
      '{"type":"assistant"'
    ]);
    await writeSession(projects, 'project', 'missing-id.jsonl', [
      JSON.stringify({ cwd: '/work/lumora', timestamp: '2026-07-11T01:00:00Z' })
    ]);
    await writeSession(projects, 'project', 'relative-cwd.jsonl', [
      claudeLine({ cwd: 'relative/path' })
    ]);

    const result = await discoverClaudeSessions({
      homeDirectory: home,
      env: {}
    });

    expect(result.sessions).toHaveLength(1);
    expect(result.sessions[0]!.title).toBe('Untitled session');
    expect(result.invalidCount).toBe(2);
  });

  it('reuses an unchanged fingerprint without parsing the file again', async () => {
    const home = await temporaryHome();
    const projects = join(home, '.claude', 'projects');
    const sourcePath = await writeSession(projects, 'project', 'cached.jsonl', [
      'this is deliberately not valid JSON'
    ]);
    let stored: StoredCatalogSource | null = null;
    const lookupSource = vi.fn(async () => stored);

    const first = await discoverClaudeSessions({
      homeDirectory: home,
      env: {},
      lookupSource: async (_provider, key, fingerprint) => {
        stored = {
          fingerprint,
          candidate: {
            provider: 'claude',
            nativeId: '33333333-3333-4333-8333-333333333333',
            workspace: {
              id: 'c'.repeat(64),
              canonicalPath: '/work/cached',
              identityKey: '/work/cached',
              displayName: 'cached',
              available: true
            },
            title: 'Cached session',
            createdAt: '2026-07-11T01:00:00.000Z',
            updatedAt: '2026-07-11T02:00:00.000Z',
            lifetimeTokens: 777,
            source: { key, fingerprint }
          }
        };
        return stored;
      }
    });
    expect(first.invalidCount).toBe(0);
    expect(first.unchangedCount).toBe(1);
    expect(first.sessions[0]).toMatchObject({
      nativeId: '33333333-3333-4333-8333-333333333333',
      workspacePath: '/work/cached',
      title: 'Cached session',
      lifetimeTokens: 777,
      source: { key: sourcePath }
    });

    await discoverClaudeSessions({
      homeDirectory: home,
      env: {},
      lookupSource
    });
    expect(lookupSource).toHaveBeenCalled();
  });

  it('deduplicates native IDs using newest metadata', async () => {
    const home = await temporaryHome();
    const projects = join(home, '.claude', 'projects');
    await writeSession(projects, 'a', 'old.jsonl', [
      claudeLine({ aiTitle: 'Old', timestamp: '2026-07-11T01:00:00.000Z' })
    ]);
    await writeSession(projects, 'b', 'new.jsonl', [
      claudeLine({ aiTitle: 'New', timestamp: '2026-07-11T02:00:00.000Z' })
    ]);

    const result = await discoverClaudeSessions({
      homeDirectory: home,
      env: {}
    });

    expect(result.sessions).toHaveLength(1);
    expect(result.sessions[0]!.title).toBe('New');
  });

  it('attaches effective lifetime tokens from unique Claude responses', async () => {
    const home = await temporaryHome();
    const projects = join(home, '.claude', 'projects');
    const assistant = claudeLine({
      type: 'assistant',
      message: {
        id: 'msg-1',
        role: 'assistant',
        usage: {
          input_tokens: 1_000,
          output_tokens: 250,
          cache_creation_input_tokens: 500,
          cache_read_input_tokens: 400
        }
      }
    });
    await writeSession(projects, 'project', 'usage.jsonl', [
      claudeLine(),
      assistant,
      assistant
    ]);

    const result = await discoverClaudeSessions({ homeDirectory: home, env: {} });

    expect(result.sessions[0]?.lifetimeTokens).toBe(1_250);
  });

  it('bounds file count and does not inspect title metadata outside read windows', async () => {
    const home = await temporaryHome();
    const projects = join(home, '.claude', 'projects');
    for (const name of ['a.jsonl', 'b.jsonl', 'c.jsonl']) {
      await writeSession(projects, 'project', name, [
        claudeLine({ sessionId: `${name}-session` })
      ]);
    }
    const bounded = await discoverClaudeSessions({
      homeDirectory: home,
      env: {},
      maxFiles: 2
    });
    expect(bounded.discoveredCount).toBe(2);
    expect(bounded.invalidCount).toBe(1);

    const largeId = '44444444-4444-4444-8444-444444444444';
    await writeSession(projects, 'large', 'large.jsonl', [
      claudeLine({ sessionId: largeId }),
      'x'.repeat(2_000),
      claudeLine({
        sessionId: largeId,
        aiTitle: 'Must stay unread',
        timestamp: '2026-07-11T01:05:00.000Z'
      }),
      'y'.repeat(2_000),
      claudeLine({
        sessionId: largeId,
        timestamp: '2026-07-11T01:10:00.000Z'
      })
    ]);
    const windowed = await discoverClaudeSessions({
      homeDirectory: home,
      env: {},
      prefixBytes: 512,
      tailBytes: 512
    });
    const large = windowed.sessions.find((session) => session.nativeId === largeId);
    expect(large?.title).toBe('Untitled session');
    expect(large?.updatedAt).toBe('2026-07-11T01:10:00.000Z');
  });

  it('rejects a source that changes while it is being read', async () => {
    const home = await temporaryHome();
    const projects = join(home, '.claude', 'projects');
    await writeSession(projects, 'project', 'moving.jsonl', [claudeLine()]);
    let statCall = 0;

    const result = await discoverClaudeSessions({
      homeDirectory: home,
      env: {},
      statFile: async (path) => {
        const { stat } = await import('node:fs/promises');
        const value = await stat(path);
        statCall += 1;
        return {
          size: value.size,
          mtimeMs: value.mtimeMs + (statCall > 1 ? 1 : 0),
          isFile: () => value.isFile()
        };
      }
    });

    expect(result.sessions).toEqual([]);
    expect(result.invalidCount).toBe(1);
  });
  it('prefers a renamed custom title over a later automatic title record', async () => {
    const home = await temporaryHome();
    const projects = join(home, '.claude', 'projects');
    await writeSession(projects, 'project', 'renamed.jsonl', [
      claudeLine(),
      claudeLine({
        type: 'custom-title',
        customTitle: 'kokoro-new',
        timestamp: '2026-07-11T01:05:00.000Z'
      }),
      claudeLine({
        type: 'ai-title',
        aiTitle: 'Automatic summary title',
        timestamp: '2026-07-11T01:05:01.000Z'
      })
    ]);

    const result = await discoverClaudeSessions({ homeDirectory: home, env: {} });

    expect(result.sessions).toHaveLength(1);
    expect(result.sessions[0]?.title).toBe('kokoro-new');
  });

  it('reads the custom title sidecar written when a session is renamed', async () => {
    const home = await temporaryHome();
    const projects = join(home, '.claude', 'projects');
    await writeSession(projects, 'project', 'sidecar.jsonl', [
      claudeLine(),
      claudeLine({
        type: 'ai-title',
        aiTitle: 'Automatic summary title',
        timestamp: '2026-07-11T01:05:00.000Z'
      })
    ]);
    const sessionDirectory = join(projects, 'project', 'sidecar');
    await mkdir(sessionDirectory, { recursive: true });
    await writeFile(
      join(sessionDirectory, 'custom-title.json'),
      JSON.stringify({ customTitle: 'renamed in claude' }),
      'utf8'
    );

    const result = await discoverClaudeSessions({ homeDirectory: home, env: {} });

    expect(result.sessions).toHaveLength(1);
    expect(result.sessions[0]?.title).toBe('renamed in claude');
  });

  it('applies a renamed sidecar title to an unchanged cached transcript', async () => {
    const home = await temporaryHome();
    const projects = join(home, '.claude', 'projects');
    const sourcePath = await writeSession(projects, 'project', 'cached.jsonl', [
      claudeLine(),
      claudeLine({
        type: 'ai-title',
        aiTitle: 'Automatic summary title',
        timestamp: '2026-07-11T01:05:00.000Z'
      })
    ]);
    const sessionDirectory = join(projects, 'project', 'cached');
    await mkdir(sessionDirectory, { recursive: true });
    await writeFile(
      join(sessionDirectory, 'custom-title.json'),
      JSON.stringify({ customTitle: 'renamed while cached' }),
      'utf8'
    );

    const result = await discoverClaudeSessions({
      homeDirectory: home,
      env: {},
      lookupSource: async (_provider, sourceKey, fingerprint) =>
        sourceKey === sourcePath
          ? ({
              fingerprint,
              candidate: {
                provider: 'claude',
                nativeId: '11111111-1111-4111-8111-111111111111',
                workspace: { id: 'workspace', canonicalPath: '/work/lumora' },
                title: 'Automatic summary title',
                createdAt: '2026-07-11T01:00:00.000Z',
                updatedAt: '2026-07-11T01:05:00.000Z',
                lifetimeTokens: null
              }
            } as unknown as StoredCatalogSource)
          : null
    });

    expect(result.sessions).toHaveLength(1);
    expect(result.sessions[0]?.title).toBe('renamed while cached');
    expect(result.unchangedCount).toBe(1);
  });

  it('ignores an unusable custom title sidecar', async () => {
    const home = await temporaryHome();
    const projects = join(home, '.claude', 'projects');
    await writeSession(projects, 'project', 'broken.jsonl', [
      claudeLine(),
      claudeLine({
        type: 'ai-title',
        aiTitle: 'Automatic summary title',
        timestamp: '2026-07-11T01:05:00.000Z'
      })
    ]);
    const sessionDirectory = join(projects, 'project', 'broken');
    await mkdir(sessionDirectory, { recursive: true });
    await writeFile(
      join(sessionDirectory, 'custom-title.json'),
      '{ not valid json',
      'utf8'
    );

    const result = await discoverClaudeSessions({ homeDirectory: home, env: {} });

    expect(result.sessions).toHaveLength(1);
    expect(result.sessions[0]?.title).toBe('Automatic summary title');
  });
});
