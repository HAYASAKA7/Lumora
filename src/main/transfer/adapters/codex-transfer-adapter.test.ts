import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { CodexAppServerTransport } from '../../providers/codex-app-server';
import type { ProviderSessionDiscoveryResult } from '../../providers/session-discovery';
import { createCodexTransferAdapter } from './codex-transfer-adapter';

const installation = {
  provider: 'codex' as const,
  displayName: 'Codex CLI',
  state: 'ready' as const,
  executablePath: '/usr/local/bin/codex',
  version: '0.146.0',
  issue: null
};
const nativeSessionId = '019fadcd-fc38-7803-b6ff-0d1d98974acc';
const sourceWorkspace = '/work/source';
const title = 'Native Codex session';

function rollout(id = nativeSessionId, cwd = sourceWorkspace, extra: object = {}): string {
  return [
    JSON.stringify({
      timestamp: '2026-07-29T12:16:26.421Z',
      type: 'session_meta',
      payload: { id, session_id: id, cwd, ...extra }
    }),
    JSON.stringify({ timestamp: '2026-07-29T12:17:00.000Z', type: 'event_msg', payload: { type: 'task_started' } })
  ].join('\n') + '\n';
}

function discovery(
  sessions: ProviderSessionDiscoveryResult['sessions'] = []
): ProviderSessionDiscoveryResult {
  return {
    provider: 'codex', sessions, discoveredCount: sessions.length,
    unchangedCount: 0, invalidCount: 0
  };
}

describe('Codex transfer adapter', () => {
  let root: string;
  let codexHome: string;
  let sourcePath: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'lumora-codex-transfer-'));
    codexHome = join(root, '.codex');
    sourcePath = join(codexHome, 'sessions', '2026', '07', '29', `rollout-${nativeSessionId}.jsonl`);
    await mkdir(dirname(sourcePath), { recursive: true });
    await writeFile(sourcePath, rollout());
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('exports a provider-owned rollout and preserves exact native bytes', async () => {
    const adapter = createCodexTransferAdapter({
      platform: 'linux', env: {}, codexHome,
      createTransport: vi.fn(), discoverSessions: async () => discovery()
    });
    const stagingDirectory = join(root, 'export');
    await mkdir(stagingDirectory);

    const payload = await adapter.exportSession({
      installation, nativeSessionId, sourceKeys: [sourcePath],
      expectedWorkspacePath: sourceWorkspace, expectedTitle: title,
      stagingDirectory
    });
    const inspection = await adapter.inspectImport({ payloadPath: payload.payloadPath });
    const raw = await readFile(payload.payloadPath);
    const newline = raw.indexOf(0x0a);

    expect(inspection).toMatchObject({
      provider: 'codex', nativeSessionId, workspacePath: sourceWorkspace, title
    });
    expect(raw.subarray(newline + 1).toString('utf8')).toBe(rollout());
  });

  it('rejects rollout sources outside Codex native storage', async () => {
    const outside = join(root, 'outside.jsonl');
    await writeFile(outside, rollout());
    const adapter = createCodexTransferAdapter({
      platform: 'linux', env: {}, codexHome,
      createTransport: vi.fn(), discoverSessions: async () => discovery()
    });

    await expect(adapter.exportSession({
      installation, nativeSessionId, sourceKeys: [outside],
      expectedWorkspacePath: sourceWorkspace, expectedTitle: title,
      stagingDirectory: root
    })).rejects.toMatchObject({ code: 'CODEX_SOURCE_INVALID' });
  });

  it('imports with prompt-free native fork and applies the original title', async () => {
    const requests: Array<{ method: string; params: unknown }> = [];
    const notify = vi.fn(async () => undefined);
    const transport: CodexAppServerTransport = {
      request: vi.fn(async (method, params) => {
        requests.push({ method, params });
        if (method === 'initialize') return {};
        if (method === 'thread/fork') {
          return { thread: {
            id: '019fb10c-fd3f-7950-8c96-1f5472d9d301',
            cwd: '/work/destination',
            path: join(codexHome, 'sessions', '2026', '07', '30', 'imported.jsonl')
          } };
        }
        if (method === 'thread/name/set') return {};
        throw new Error(`Unexpected request: ${method}`);
      }),
      notify,
      close: vi.fn(async () => undefined)
    };
    const adapter = createCodexTransferAdapter({
      platform: 'linux', env: {}, codexHome,
      createTransport: async () => transport,
      discoverSessions: async () => discovery()
    });
    const exportDirectory = join(root, 'export-import');
    const importDirectory = join(root, 'import');
    await mkdir(exportDirectory);
    await mkdir(importDirectory);
    const payload = await adapter.exportSession({
      installation, nativeSessionId, sourceKeys: [sourcePath],
      expectedWorkspacePath: sourceWorkspace, expectedTitle: title,
      stagingDirectory: exportDirectory
    });
    const inspection = await adapter.inspectImport({ payloadPath: payload.payloadPath });

    const outcome = await adapter.importSession({
      installation, inspection, destinationWorkspacePath: '/work/destination',
      stagingDirectory: importDirectory
    });

    expect(outcome).toMatchObject({
      status: 'imported', nativeSessionId: '019fb10c-fd3f-7950-8c96-1f5472d9d301'
    });
    expect(requests[0]).toEqual({
      method: 'initialize',
      params: expect.objectContaining({ capabilities: { experimentalApi: true } })
    });
    expect(notify).toHaveBeenCalledWith('initialized');
    expect(requests[1]).toEqual({
      method: 'thread/fork',
      params: expect.objectContaining({
        threadId: nativeSessionId,
        path: expect.stringMatching(/codex-rollout\.jsonl$/),
        cwd: '/work/destination',
        ephemeral: false
      })
    });
    expect(requests[2]).toEqual({
      method: 'thread/name/set',
      params: { threadId: '019fb10c-fd3f-7950-8c96-1f5472d9d301', name: title }
    });
  });

  it('deletes a newly forked thread when post-fork setup fails', async () => {
    const importedId = '019fb10c-fd3f-7950-8c96-1f5472d9d301';
    const requests: Array<{ method: string; params: unknown }> = [];
    const transport: CodexAppServerTransport = {
      request: vi.fn(async (method, params) => {
        requests.push({ method, params });
        if (method === 'initialize') return {};
        if (method === 'thread/fork') {
          return { thread: {
            id: importedId,
            cwd: '/work/destination',
            path: join(codexHome, 'sessions', '2026', '07', '30', 'imported.jsonl')
          } };
        }
        if (method === 'thread/name/set') throw new Error('Could not restore the title');
        if (method === 'thread/delete') return {};
        throw new Error(`Unexpected request: ${method}`);
      }),
      notify: vi.fn(async () => undefined),
      close: vi.fn(async () => undefined)
    };
    const adapter = createCodexTransferAdapter({
      platform: 'linux', env: {}, codexHome,
      createTransport: async () => transport,
      discoverSessions: async () => discovery()
    });
    const exportDirectory = join(root, 'failed-export');
    const importDirectory = join(root, 'failed-import');
    await mkdir(exportDirectory);
    await mkdir(importDirectory);
    const payload = await adapter.exportSession({
      installation, nativeSessionId, sourceKeys: [sourcePath],
      expectedWorkspacePath: sourceWorkspace, expectedTitle: title,
      stagingDirectory: exportDirectory
    });
    const inspection = await adapter.inspectImport({ payloadPath: payload.payloadPath });

    await expect(adapter.importSession({
      installation, inspection, destinationWorkspacePath: '/work/destination',
      stagingDirectory: importDirectory
    })).rejects.toThrow('Could not restore the title');

    expect(requests.at(-1)).toEqual({
      method: 'thread/delete',
      params: { threadId: importedId }
    });
  });

  it('skips a prior fork of the same native session in the mapped workspace', async () => {
    const importedPath = join(codexHome, 'sessions', '2026', '07', '30', 'imported.jsonl');
    await mkdir(dirname(importedPath), { recursive: true });
    await writeFile(importedPath, rollout(
      '019fb10c-fd3f-7950-8c96-1f5472d9d301',
      '/work/destination',
      { forked_from_id: nativeSessionId }
    ));
    const existing = {
      provider: 'codex' as const,
      nativeId: '019fb10c-fd3f-7950-8c96-1f5472d9d301',
      workspacePath: '/work/destination', title,
      createdAt: '2026-07-30T00:00:00.000Z', updatedAt: '2026-07-30T00:00:00.000Z',
      source: { key: importedPath, fingerprint: null }
    };
    const createTransport = vi.fn();
    const adapter = createCodexTransferAdapter({
      platform: 'linux', env: {}, codexHome, createTransport,
      discoverSessions: async () => discovery([existing])
    });
    const exportDirectory = join(root, 'duplicate-export');
    const importDirectory = join(root, 'duplicate-import');
    await mkdir(exportDirectory);
    await mkdir(importDirectory);
    const payload = await adapter.exportSession({
      installation, nativeSessionId, sourceKeys: [sourcePath],
      expectedWorkspacePath: sourceWorkspace, expectedTitle: title,
      stagingDirectory: exportDirectory
    });
    const inspection = await adapter.inspectImport({ payloadPath: payload.payloadPath });

    await expect(adapter.importSession({
      installation, inspection, destinationWorkspacePath: '/work/destination',
      stagingDirectory: importDirectory
    })).resolves.toEqual({
      status: 'duplicate', nativeSessionId: existing.nativeId
    });
    expect(createTransport).not.toHaveBeenCalled();
  });

  it('rolls back only through Codex native thread deletion', async () => {
    const transport: CodexAppServerTransport = {
      request: vi.fn(async () => ({})),
      notify: vi.fn(async () => undefined),
      close: vi.fn(async () => undefined)
    };
    const adapter = createCodexTransferAdapter({
      platform: 'linux', env: {}, codexHome,
      createTransport: async () => transport,
      discoverSessions: async () => discovery()
    });

    await adapter.rollbackImport({
      installation,
      nativeSessionId: '019fb10c-fd3f-7950-8c96-1f5472d9d301',
      workspacePath: '/work/destination'
    });

    expect(transport.request).toHaveBeenNthCalledWith(1, 'initialize',
      expect.objectContaining({ capabilities: { experimentalApi: true } }));
    expect(transport.request).toHaveBeenNthCalledWith(2, 'thread/delete', {
      threadId: '019fb10c-fd3f-7950-8c96-1f5472d9d301'
    });
  });
});
