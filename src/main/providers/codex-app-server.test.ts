import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import type { StoredCatalogSource } from '../storage/catalog-repository';

import {
  buildCodexAppServerInvocation,
  discoverCodexSessions,
  type CodexAppServerTransport
} from './codex-app-server';
import { codexThread, codexThreadPage } from './fixtures/codex-thread-pages';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true })
    )
  );
});

async function rollout(totalTokens: number): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'lumora-codex-thread-'));
  temporaryDirectories.push(directory);
  const path = join(directory, 'rollout.jsonl');
  await writeFile(
    path,
    `${JSON.stringify({
      type: 'event_msg',
      payload: {
        type: 'token_count',
        info: {
          total_token_usage: {
            input_tokens: totalTokens,
            cached_input_tokens: 0,
            output_tokens: 0,
            total_tokens: totalTokens
          }
        }
      }
    })}\n`,
    'utf8'
  );
  return path;
}

class FakeTransport implements CodexAppServerTransport {
  readonly calls: { method: string; params?: unknown }[] = [];
  readonly close = vi.fn(async () => undefined);

  constructor(
    private readonly respond: (
      method: string,
      params: unknown,
      callIndex: number
    ) => unknown | Promise<unknown>
  ) {}

  async request(method: string, params: unknown): Promise<unknown> {
    this.calls.push({ method, params });
    return this.respond(method, params, this.calls.length - 1);
  }

  async notify(method: string): Promise<void> {
    this.calls.push({ method });
  }
}

describe('discoverCodexSessions', () => {
  it('initializes, paginates, and emits metadata without preview or path', async () => {
    const transport = new FakeTransport((method, params) => {
      if (method === 'initialize') {
        return {
          userAgent: 'codex-cli/0.144.1',
          codexHome: '/home/dev/.codex',
          platformFamily: 'unix',
          platformOs: 'linux'
        };
      }
      const cursor = (params as { cursor?: string | null }).cursor;
      return cursor === 'next-page'
        ? codexThreadPage(
            [
              codexThread('thread-2', {
                cwd: '/work/nebula',
                name: '  Named session  ',
                createdAt: 1_720_000_200,
                updatedAt: 1_720_000_300
              })
            ],
            null
          )
        : codexThreadPage([codexThread('thread-1')], 'next-page');
    });

    const result = await discoverCodexSessions({
      executablePath: '/usr/local/bin/codex',
      createTransport: async () => transport
    });

    expect(transport.calls.map((call) => call.method)).toEqual([
      'initialize',
      'initialized',
      'thread/list',
      'thread/list'
    ]);
    expect(transport.calls[2]!.params).toEqual({
      cursor: null,
      limit: 500,
      sortKey: 'updated_at',
      sortDirection: 'desc',
      useStateDbOnly: false
    });
    expect(transport.calls[3]!.params).toEqual(
      expect.objectContaining({ cursor: 'next-page' })
    );
    expect(result).toEqual({
      provider: 'codex',
      sessions: [
        {
          provider: 'codex',
          nativeId: 'thread-2',
          workspacePath: '/work/nebula',
          title: 'Named session',
          createdAt: '2024-07-03T09:50:00.000Z',
          updatedAt: '2024-07-03T09:51:40.000Z',
          lifetimeTokens: null,
          source: { key: 'thread:thread-2', fingerprint: null }
        },
        {
          provider: 'codex',
          nativeId: 'thread-1',
          workspacePath: '/work/lumora',
          title: 'Untitled session',
          createdAt: '2024-07-03T09:46:40.000Z',
          updatedAt: '2024-07-03T09:48:20.000Z',
          lifetimeTokens: null,
          source: { key: 'thread:thread-1', fingerprint: null }
        }
      ],
      discoveredCount: 2,
      unchangedCount: 0,
      invalidCount: 0
    });
    expect(JSON.stringify(result)).not.toContain('fixture prompt');
    expect(JSON.stringify(result)).not.toContain('private-rollout');
    expect(transport.close).toHaveBeenCalledOnce();
  });

  it('isolates invalid and ephemeral threads', async () => {
    const transport = new FakeTransport((method) =>
      method === 'initialize'
        ? {}
        : codexThreadPage(
            [
              codexThread('valid'),
              codexThread('ephemeral', { ephemeral: true }),
              codexThread('relative', { cwd: 'relative/path' }),
              codexThread('bad-time', { updatedAt: Number.NaN }),
              codexThread('', { id: '' })
            ],
            null
          )
    );

    const result = await discoverCodexSessions({
      executablePath: '/usr/local/bin/codex',
      createTransport: async () => transport
    });

    expect(result.sessions.map((session) => session.nativeId)).toEqual(['valid']);
    expect(result.invalidCount).toBe(3);
    expect(result.discoveredCount).toBe(1);
  });

  it('deduplicates native IDs using the newest valid metadata', async () => {
    const transport = new FakeTransport((method) =>
      method === 'initialize'
        ? {}
        : codexThreadPage(
            [
              codexThread('duplicate', {
                name: 'Older',
                updatedAt: 1_720_000_100
              }),
              codexThread('duplicate', {
                name: 'Newer',
                updatedAt: 1_720_000_500
              })
            ],
            null
          )
    );

    const result = await discoverCodexSessions({
      executablePath: '/usr/local/bin/codex',
      createTransport: async () => transport
    });

    expect(result.sessions).toHaveLength(1);
    expect(result.sessions[0]!.title).toBe('Newer');
    expect(result.invalidCount).toBe(0);
  });

  it('reads a changed rollout and attaches its cumulative lifetime total', async () => {
    const sourcePath = await rollout(48_250);
    const transport = new FakeTransport((method) =>
      method === 'initialize'
        ? {}
        : codexThreadPage([codexThread('usage', { path: sourcePath })], null)
    );

    const result = await discoverCodexSessions({
      executablePath: '/usr/local/bin/codex',
      createTransport: async () => transport,
      lookupSource: async () => null
    });

    expect(result.sessions[0]).toMatchObject({
      nativeId: 'usage',
      lifetimeTokens: 48_250,
      source: {
        key: sourcePath,
        fingerprint: { size: expect.any(Number), modifiedAtMs: expect.any(Number) }
      }
    });
    expect(result.unchangedCount).toBe(0);
  });

  it('reuses an unchanged rollout total without reading its content', async () => {
    const sourcePath = await rollout(48_250);
    const file = await stat(sourcePath);
    const fingerprint = {
      size: Math.trunc(file.size),
      modifiedAtMs: Math.trunc(file.mtimeMs)
    };
    const cached: StoredCatalogSource = {
      fingerprint,
      candidate: {
        provider: 'codex',
        nativeId: 'cached',
        workspace: {
          id: 'a'.repeat(64),
          canonicalPath: '/work/lumora',
          identityKey: '/work/lumora',
          displayName: 'lumora',
          available: true
        },
        title: 'Cached',
        createdAt: '2024-07-03T09:46:40.000Z',
        updatedAt: '2024-07-03T09:48:20.000Z',
        lifetimeTokens: 77_000,
        source: { key: sourcePath, fingerprint }
      }
    };
    const inspectUsage = vi.fn(async () => {
      throw new Error('unchanged files must not be read');
    });
    const transport = new FakeTransport((method) =>
      method === 'initialize'
        ? {}
        : codexThreadPage([codexThread('cached', { path: sourcePath })], null)
    );

    const result = await discoverCodexSessions({
      executablePath: '/usr/local/bin/codex',
      createTransport: async () => transport,
      lookupSource: async () => cached,
      inspectUsage
    });

    expect(result.sessions[0]).toMatchObject({
      lifetimeTokens: 77_000,
      source: { key: sourcePath, fingerprint }
    });
    expect(result.unchangedCount).toBe(1);
    expect(inspectUsage).not.toHaveBeenCalled();
  });

  it('keeps sessions discoverable when optional token inspection fails', async () => {
    const sourcePath = await rollout(100);
    const transport = new FakeTransport((method) =>
      method === 'initialize'
        ? {}
        : codexThreadPage([codexThread('fallback', { path: sourcePath })], null)
    );

    const result = await discoverCodexSessions({
      executablePath: '/usr/local/bin/codex',
      createTransport: async () => transport,
      lookupSource: async () => null,
      inspectUsage: async () => {
        throw new Error('optional metric unavailable');
      }
    });

    expect(result.sessions[0]).toMatchObject({
      nativeId: 'fallback',
      lifetimeTokens: null,
      source: { key: 'thread:fallback', fingerprint: null }
    });
    expect(result.invalidCount).toBe(0);
  });

  it('rejects invalid envelopes and always closes the transport', async () => {
    const transport = new FakeTransport((method) =>
      method === 'initialize' ? {} : { data: 'not-an-array' }
    );

    await expect(
      discoverCodexSessions({
        executablePath: '/usr/local/bin/codex',
        createTransport: async () => transport
      })
    ).rejects.toThrow('protocol');
    expect(transport.close).toHaveBeenCalledOnce();
  });

  it('bounds request time and pagination', async () => {
    const stalled = new FakeTransport(
      (method) =>
        method === 'initialize' ? new Promise(() => undefined) : undefined
    );
    await expect(
      discoverCodexSessions({
        executablePath: '/usr/local/bin/codex',
        createTransport: async () => stalled,
        requestTimeoutMs: 10
      })
    ).rejects.toThrow('timed out');
    expect(stalled.close).toHaveBeenCalledOnce();

    const endless = new FakeTransport((method) =>
      method === 'initialize'
        ? {}
        : codexThreadPage([], 'another-page')
    );
    await expect(
      discoverCodexSessions({
        executablePath: '/usr/local/bin/codex',
        createTransport: async () => endless,
        maxPages: 2
      })
    ).rejects.toThrow('page limit');
    expect(endless.close).toHaveBeenCalledOnce();
  });
});

describe('buildCodexAppServerInvocation', () => {
  it('runs native executables directly on every platform', () => {
    expect(
      buildCodexAppServerInvocation('/usr/local/bin/codex', {
        platform: 'linux',
        env: {}
      })
    ).toEqual({
      file: '/usr/local/bin/codex',
      args: ['app-server', '--stdio']
    });
  });

  it('routes Windows command wrappers through ComSpec safely', () => {
    expect(
      buildCodexAppServerInvocation('C:\\tools\\codex.cmd', {
        platform: 'win32',
        env: { ComSpec: 'C:\\Windows\\System32\\cmd.exe' }
      })
    ).toEqual({
      file: 'C:\\Windows\\System32\\cmd.exe',
      args: ['/d', '/s', '/c', '""C:\\tools\\codex.cmd" app-server --stdio"'],
      windowsVerbatimArguments: true
    });
  });

  it('rejects relative and unsafe wrapper paths', () => {
    expect(() =>
      buildCodexAppServerInvocation('codex', {
        platform: 'linux',
        env: {}
      })
    ).toThrow('absolute');
    expect(() =>
      buildCodexAppServerInvocation('C:\\bad%path\\codex.cmd', {
        platform: 'win32',
        env: {}
      })
    ).toThrow('safely');
  });
});
