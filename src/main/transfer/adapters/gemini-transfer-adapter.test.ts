import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ProviderSessionDiscoveryResult } from '../../providers/session-discovery';
import type { StructuredCommandRunner } from '../../providers/opencode-session-source';
import {
  buildGeminiTransferInvocation,
  createGeminiTransferAdapter
} from './gemini-transfer-adapter';

const installation = {
  provider: 'gemini' as const,
  displayName: 'Gemini CLI',
  state: 'ready' as const,
  executablePath: '/usr/local/bin/gemini',
  version: '0.44.1',
  issue: null
};

const metadata = {
  sessionId: 'source-session-id',
  projectHash: 'source-project-hash',
  startTime: '2026-07-29T08:00:00.000Z',
  lastUpdated: '2026-07-29T08:01:00.000Z',
  summary: 'Transfer me'
};
const nativePayload = [
  JSON.stringify(metadata),
  JSON.stringify({
    id: 'message-1',
    type: 'user',
    content: [{ text: 'preserve provider-native content' }],
    timestamp: '2026-07-29T08:01:00.000Z'
  })
].join('\n') + '\n';

function discovery(
  sessions: ProviderSessionDiscoveryResult['sessions'] = []
): ProviderSessionDiscoveryResult {
  return {
    provider: 'gemini',
    sessions,
    discoveredCount: sessions.length,
    unchangedCount: 0,
    invalidCount: 0
  };
}

describe('Gemini transfer adapter', () => {
  let root: string;
  let geminiRoot: string;
  let sourceWorkspace: string;
  let sourcePath: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'lumora-gemini-transfer-'));
    geminiRoot = join(root, '.gemini', 'tmp');
    sourceWorkspace = join(root, 'source-workspace');
    const projectDirectory = join(geminiRoot, 'source-project');
    sourcePath = join(projectDirectory, 'chats', 'session-source.jsonl');
    await mkdir(dirname(sourcePath), { recursive: true });
    await mkdir(sourceWorkspace);
    await writeFile(join(projectDirectory, '.project_root'), sourceWorkspace);
    await writeFile(sourcePath, nativePayload);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('uses Gemini native session-file import and list commands without a shell on Unix', () => {
    expect(buildGeminiTransferInvocation({
      operation: 'import',
      executablePath: '/usr/local/bin/gemini',
      payloadPath: '/tmp/lumora-transfer.jsonl',
      workspacePath: '/work/project',
      platform: 'linux',
      env: {}
    })).toEqual({
      file: '/usr/local/bin/gemini',
      args: ['--session-file', '/tmp/lumora-transfer.jsonl', '--list-sessions'],
      cwd: '/work/project',
      shell: false,
      windowsHide: true
    });
  });

  it('invokes a Windows command shim through ComSpec with verbatim arguments', () => {
    expect(buildGeminiTransferInvocation({
      operation: 'delete',
      executablePath: 'C:\\Users\\Dev\\gemini.cmd',
      nativeSessionId: 'imported-session',
      workspacePath: 'C:\\work\\project',
      platform: 'win32',
      env: { ComSpec: 'C:\\Windows\\System32\\cmd.exe' }
    })).toEqual({
      file: 'C:\\Windows\\System32\\cmd.exe',
      args: [
        '/d',
        '/s',
        '/c',
        '""C:\\Users\\Dev\\gemini.cmd" --delete-session imported-session"'
      ],
      cwd: 'C:\\work\\project',
      shell: false,
      windowsHide: true,
      windowsVerbatimArguments: true
    });
  });

  it('exports a stable native payload with provider-specific metadata', async () => {
    const adapter = createGeminiTransferAdapter({
      platform: 'linux',
      env: {},
      geminiStorageRoot: geminiRoot,
      runCommand: vi.fn(),
      discoverSessions: async () => discovery()
    });
    const stagingDirectory = join(root, 'export');
    await mkdir(stagingDirectory);

    const payload = await adapter.exportSession({
      installation,
      nativeSessionId: metadata.sessionId,
      sourceKeys: [sourcePath],
      expectedWorkspacePath: sourceWorkspace,
      expectedTitle: metadata.summary,
      stagingDirectory
    });

    const envelope = JSON.parse(await readFile(payload.payloadPath, 'utf8'));
    expect(envelope).toMatchObject({
      schemaVersion: 1,
      provider: 'gemini',
      nativeSessionId: metadata.sessionId,
      workspacePath: sourceWorkspace,
      title: metadata.summary,
      sourceFormat: 'jsonl',
      nativePayload
    });
  });

  it('rejects a source outside Gemini storage', async () => {
    const outside = join(root, 'outside.jsonl');
    await writeFile(outside, nativePayload);
    const adapter = createGeminiTransferAdapter({
      platform: 'linux', env: {}, geminiStorageRoot: geminiRoot,
      runCommand: vi.fn(), discoverSessions: async () => discovery()
    });

    await expect(adapter.exportSession({
      installation,
      nativeSessionId: metadata.sessionId,
      sourceKeys: [outside],
      expectedWorkspacePath: sourceWorkspace,
      expectedTitle: metadata.summary,
      stagingDirectory: root
    })).rejects.toMatchObject({ code: 'GEMINI_SOURCE_INVALID' });
  });

  it('imports through Gemini, accepts the new native ID, and verifies the marker', async () => {
    const exportAdapter = createGeminiTransferAdapter({
      platform: 'linux', env: {}, geminiStorageRoot: geminiRoot,
      runCommand: vi.fn(), discoverSessions: async () => discovery()
    });
    const exportDirectory = join(root, 'export-import');
    await mkdir(exportDirectory);
    const payload = await exportAdapter.exportSession({
      installation,
      nativeSessionId: metadata.sessionId,
      sourceKeys: [sourcePath],
      expectedWorkspacePath: sourceWorkspace,
      expectedTitle: metadata.summary,
      stagingDirectory: exportDirectory
    });
    const inspection = await exportAdapter.inspectImport({ payloadPath: payload.payloadPath });
    const destinationWorkspace = join(root, 'destination-workspace');
    await mkdir(destinationWorkspace);
    const importedPath = join(geminiRoot, 'destination-project', 'chats', 'session-imported.jsonl');
    let imported = false;
    const runCommand: StructuredCommandRunner = vi.fn(async (invocation) => {
      const stagedPath = invocation.args[1]!;
      await mkdir(dirname(importedPath), { recursive: true });
      await writeFile(importedPath, [
        JSON.stringify({ ...metadata, sessionId: 'new-native-id' }),
        JSON.stringify({
          id: 'import-1', type: 'info',
          content: `Imported session from ${stagedPath}`,
          timestamp: '2026-07-29T09:00:00.000Z'
        })
      ].join('\n') + '\n');
      imported = true;
      return { stdout: 'new-native-id', stderr: '', exitCode: 0 };
    });
    const importedRecord = {
      provider: 'gemini' as const,
      nativeId: 'new-native-id',
      workspacePath: destinationWorkspace,
      title: metadata.summary,
      createdAt: '2026-07-29T09:00:00.000Z',
      updatedAt: '2026-07-29T09:00:00.000Z',
      source: { key: importedPath, fingerprint: null }
    };
    const adapter = createGeminiTransferAdapter({
      platform: 'linux', env: {}, geminiStorageRoot: geminiRoot,
      runCommand,
      discoverSessions: async () => discovery(imported ? [importedRecord] : [])
    });
    const stagingDirectory = join(root, 'import');
    await mkdir(stagingDirectory);

    const outcome = await adapter.importSession({
      installation,
      inspection,
      destinationWorkspacePath: destinationWorkspace,
      stagingDirectory
    });

    expect(outcome).toMatchObject({ status: 'imported', nativeSessionId: 'new-native-id' });
    expect(runCommand).toHaveBeenCalledWith(expect.objectContaining({
      args: ['--session-file', expect.stringMatching(/lumora-transfer-[a-f0-9]{64}\.jsonl$/), '--list-sessions'],
      cwd: destinationWorkspace
    }));
    await expect(adapter.verifyImportedSession({
      installation,
      nativeSessionId: 'new-native-id',
      workspacePath: destinationWorkspace,
      title: metadata.summary
    })).resolves.toBe(true);
  });

  it('skips a previously imported payload without invoking Gemini again', async () => {
    const stagingDirectory = join(root, 'duplicate-staging');
    await mkdir(stagingDirectory);
    const exportAdapter = createGeminiTransferAdapter({
      platform: 'linux', env: {}, geminiStorageRoot: geminiRoot,
      runCommand: vi.fn(), discoverSessions: async () => discovery()
    });
    const payload = await exportAdapter.exportSession({
      installation, nativeSessionId: metadata.sessionId, sourceKeys: [sourcePath],
      expectedWorkspacePath: sourceWorkspace, expectedTitle: metadata.summary,
      stagingDirectory
    });
    const inspection = await exportAdapter.inspectImport({ payloadPath: payload.payloadPath });
    const markerName = `lumora-transfer-${await import('node:crypto').then(({ createHash }) =>
      createHash('sha256').update(metadata.sessionId).digest('hex'))}.jsonl`;
    const importedPath = join(geminiRoot, 'existing', 'chats', 'session-existing.jsonl');
    await mkdir(dirname(importedPath), { recursive: true });
    await writeFile(importedPath, [
      JSON.stringify({ ...metadata, sessionId: 'existing-import-id' }),
      JSON.stringify({ type: 'info', content: `Imported session from C:\\temp\\${markerName}` })
    ].join('\n') + '\n');
    const runCommand = vi.fn<StructuredCommandRunner>();
    const adapter = createGeminiTransferAdapter({
      platform: 'linux', env: {}, geminiStorageRoot: geminiRoot, runCommand,
      discoverSessions: async () => discovery([{
        provider: 'gemini', nativeId: 'existing-import-id', workspacePath: sourceWorkspace,
        title: metadata.summary, createdAt: metadata.startTime, updatedAt: metadata.lastUpdated,
        source: { key: importedPath, fingerprint: null }
      }])
    });

    await expect(adapter.importSession({
      installation, inspection, destinationWorkspacePath: sourceWorkspace, stagingDirectory
    })).resolves.toEqual({ status: 'duplicate', nativeSessionId: 'existing-import-id' });
    expect(runCommand).not.toHaveBeenCalled();
  });

  it('rolls back through Gemini in the destination workspace', async () => {
    const runCommand: StructuredCommandRunner = vi.fn(async () => ({
      stdout: '', stderr: '', exitCode: 0
    }));
    const adapter = createGeminiTransferAdapter({
      platform: 'linux', env: {}, geminiStorageRoot: geminiRoot,
      runCommand, discoverSessions: async () => discovery()
    });

    await adapter.rollbackImport({
      installation,
      nativeSessionId: 'new-native-id',
      workspacePath: sourceWorkspace
    });

    expect(runCommand).toHaveBeenCalledWith(expect.objectContaining({
      args: ['--delete-session', 'new-native-id'],
      cwd: sourceWorkspace
    }));
  });
});
