import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { ProviderSessionDiscoveryResult } from '../../providers/session-discovery';
import {
  createQwenTransferAdapter,
  qwenProjectDirectoryName
} from './qwen-transfer-adapter';

const nativeSessionId = '123e4567-e89b-42d3-a456-426614174000';
const installation = {
  provider: 'qwen' as const,
  displayName: 'Qwen Code',
  state: 'ready' as const,
  executablePath: '/usr/local/bin/qwen',
  version: '0.20.0',
  issue: null
};

function discovery(
  sessions: ProviderSessionDiscoveryResult['sessions'] = []
): ProviderSessionDiscoveryResult {
  return {
    provider: 'qwen', sessions, discoveredCount: sessions.length,
    unchangedCount: 0, invalidCount: 0
  };
}

describe('Qwen transfer adapter', () => {
  let root: string;
  let qwenRoot: string;
  let sourceWorkspace: string;
  let sourcePath: string;
  let nativePayload: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'lumora-qwen-transfer-'));
    qwenRoot = join(root, '.qwen');
    sourceWorkspace = join(root, 'Source Workspace');
    sourcePath = join(
      qwenRoot,
      'projects',
      qwenProjectDirectoryName(sourceWorkspace, 'linux'),
      'chats',
      `${nativeSessionId}.jsonl`
    );
    nativePayload = [
      JSON.stringify({
        sessionId: nativeSessionId,
        cwd: sourceWorkspace,
        type: 'user',
        timestamp: '2026-07-29T08:00:00.000Z',
        message: { content: 'keep this content byte-equivalent after parsing' }
      }),
      JSON.stringify({
        sessionId: nativeSessionId,
        cwd: sourceWorkspace,
        type: 'system',
        subtype: 'custom_title',
        timestamp: '2026-07-29T08:01:00.000Z',
        systemPayload: { customTitle: 'Transfer me' }
      }),
      JSON.stringify({
        sessionId: nativeSessionId,
        type: 'assistant',
        timestamp: '2026-07-29T08:02:00.000Z',
        message: { content: 'done' }
      })
    ].join('\n') + '\n';
    await mkdir(dirname(sourcePath), { recursive: true });
    await mkdir(sourceWorkspace);
    await writeFile(sourcePath, nativePayload);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('uses Qwen native project directory naming on every platform', () => {
    expect(qwenProjectDirectoryName('/Users/Dev/My App', 'darwin')).toBe('-Users-Dev-My-App');
    expect(qwenProjectDirectoryName('C:\\Users\\Dev\\My App', 'win32')).toBe('c--users-dev-my-app');
  });

  it('exports one validated provider-owned JSONL source', async () => {
    const adapter = createQwenTransferAdapter({
      platform: 'linux', qwenRoot, discoverSessions: async () => discovery()
    });
    const stagingDirectory = join(root, 'export');
    await mkdir(stagingDirectory);

    const payload = await adapter.exportSession({
      installation,
      nativeSessionId,
      sourceKeys: [sourcePath],
      expectedWorkspacePath: sourceWorkspace,
      expectedTitle: 'Transfer me',
      stagingDirectory
    });

    expect(JSON.parse(await readFile(payload.payloadPath, 'utf8'))).toMatchObject({
      schemaVersion: 1,
      provider: 'qwen',
      nativeSessionId,
      workspacePath: sourceWorkspace,
      title: 'Transfer me',
      nativePayload
    });
  });

  it('rejects source paths outside Qwen storage', async () => {
    const outside = join(root, `${nativeSessionId}.jsonl`);
    await writeFile(outside, nativePayload);
    const adapter = createQwenTransferAdapter({
      platform: 'linux', qwenRoot, discoverSessions: async () => discovery()
    });

    await expect(adapter.exportSession({
      installation, nativeSessionId, sourceKeys: [outside],
      expectedWorkspacePath: sourceWorkspace, expectedTitle: 'Transfer me',
      stagingDirectory: root
    })).rejects.toMatchObject({ code: 'QWEN_SOURCE_INVALID' });
  });

  it('writes an exclusive destination session and changes only matching cwd fields', async () => {
    let imported = false;
    const destinationWorkspace = join(root, 'Destination Workspace');
    await mkdir(destinationWorkspace);
    const destinationPath = join(
      qwenRoot,
      'projects',
      qwenProjectDirectoryName(destinationWorkspace, 'linux'),
      'chats',
      `${nativeSessionId}.jsonl`
    );
    const record = {
      provider: 'qwen' as const,
      nativeId: nativeSessionId,
      workspacePath: destinationWorkspace,
      title: 'Transfer me',
      createdAt: '2026-07-29T08:00:00.000Z',
      updatedAt: '2026-07-29T08:02:00.000Z',
      source: { key: destinationPath, fingerprint: null }
    };
    const adapter = createQwenTransferAdapter({
      platform: 'linux', qwenRoot,
      discoverSessions: async () => discovery(imported ? [record] : [])
    });
    const exportDirectory = join(root, 'round-trip-export');
    await mkdir(exportDirectory);
    const payload = await adapter.exportSession({
      installation, nativeSessionId, sourceKeys: [sourcePath],
      expectedWorkspacePath: sourceWorkspace, expectedTitle: 'Transfer me',
      stagingDirectory: exportDirectory
    });
    const inspection = await adapter.inspectImport({ payloadPath: payload.payloadPath });
    const importDirectory = join(root, 'round-trip-import');
    await mkdir(importDirectory);

    const outcome = await adapter.importSession({
      installation, inspection, destinationWorkspacePath: destinationWorkspace,
      stagingDirectory: importDirectory
    });
    imported = true;

    expect(outcome).toMatchObject({ status: 'imported', nativeSessionId });
    const importedRecords = (await readFile(destinationPath, 'utf8'))
      .trim().split('\n').map((line) => JSON.parse(line));
    expect(importedRecords[0]).toEqual({
      ...JSON.parse(nativePayload.split('\n')[0]!),
      cwd: destinationWorkspace
    });
    expect(importedRecords[1].cwd).toBe(destinationWorkspace);
    expect(importedRecords[2]).toEqual(JSON.parse(nativePayload.split('\n')[2]!));
    await expect(adapter.verifyImportedSession({
      installation, nativeSessionId, workspacePath: destinationWorkspace,
      title: 'Transfer me'
    })).resolves.toBe(true);
  });

  it('skips an existing destination identity without overwriting it', async () => {
    const adapter = createQwenTransferAdapter({
      platform: 'linux', qwenRoot,
      discoverSessions: async () => discovery([{
        provider: 'qwen', nativeId: nativeSessionId, workspacePath: sourceWorkspace,
        title: 'Transfer me', createdAt: '2026-07-29T08:00:00.000Z',
        updatedAt: '2026-07-29T08:02:00.000Z',
        source: { key: sourcePath, fingerprint: null }
      }])
    });
    const exportDirectory = join(root, 'duplicate-export');
    await mkdir(exportDirectory);
    const payload = await adapter.exportSession({
      installation, nativeSessionId, sourceKeys: [sourcePath],
      expectedWorkspacePath: sourceWorkspace, expectedTitle: 'Transfer me',
      stagingDirectory: exportDirectory
    });
    const inspection = await adapter.inspectImport({ payloadPath: payload.payloadPath });

    await expect(adapter.importSession({
      installation, inspection, destinationWorkspacePath: sourceWorkspace,
      stagingDirectory: root
    })).resolves.toEqual({ status: 'duplicate', nativeSessionId });
    expect(await readFile(sourcePath, 'utf8')).toBe(nativePayload);
  });

  it('removes only the imported workspace-scoped file during rollback', async () => {
    const destinationWorkspace = join(root, 'Rollback Workspace');
    const destinationPath = join(
      qwenRoot, 'projects', qwenProjectDirectoryName(destinationWorkspace, 'linux'),
      'chats', `${nativeSessionId}.jsonl`
    );
    await mkdir(dirname(destinationPath), { recursive: true });
    await writeFile(destinationPath, nativePayload);
    const adapter = createQwenTransferAdapter({
      platform: 'linux', qwenRoot, discoverSessions: async () => discovery()
    });

    await adapter.rollbackImport({ installation, nativeSessionId, workspacePath: destinationWorkspace });

    await expect(readFile(destinationPath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(readFile(sourcePath, 'utf8')).resolves.toBe(nativePayload);
  });
});
