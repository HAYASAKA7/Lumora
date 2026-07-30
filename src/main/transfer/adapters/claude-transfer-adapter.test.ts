import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, posix } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { ProviderSessionDiscoveryResult } from '../../providers/session-discovery';
import {
  claudeProjectDirectoryName,
  createClaudeTransferAdapter
} from './claude-transfer-adapter';

const nativeSessionId = '123e4567-e89b-42d3-a456-426614174000';
const installation = {
  provider: 'claude' as const,
  displayName: 'Claude Code',
  state: 'ready' as const,
  executablePath: '/usr/local/bin/claude',
  version: '2.1.212',
  issue: null
};

function discovery(
  sessions: ProviderSessionDiscoveryResult['sessions'] = []
): ProviderSessionDiscoveryResult {
  return {
    provider: 'claude', sessions, discoveredCount: sessions.length,
    unchangedCount: 0, invalidCount: 0
  };
}

describe('Claude transfer adapter', () => {
  let root: string;
  let configRoot: string;
  let sourceWorkspace: string;
  let sourcePath: string;
  let nativePayload: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'lumora-claude-transfer-'));
    configRoot = join(root, '.claude');
    sourceWorkspace = join(root, 'Source_Workspace');
    const projectDirectory = join(
      configRoot,
      'projects',
      claudeProjectDirectoryName(sourceWorkspace)
    );
    sourcePath = join(projectDirectory, `${nativeSessionId}.jsonl`);
    nativePayload = [
      JSON.stringify({
        sessionId: nativeSessionId,
        cwd: sourceWorkspace,
        type: 'user',
        timestamp: '2026-07-29T08:00:00.000Z',
        message: { content: 'provider content' }
      }),
      JSON.stringify({
        sessionId: nativeSessionId,
        cwd: sourceWorkspace,
        type: 'system',
        timestamp: '2026-07-29T08:01:00.000Z',
        customTitle: 'Transfer me'
      })
    ].join('\n') + '\n';
    await mkdir(dirname(sourcePath), { recursive: true });
    await mkdir(sourceWorkspace);
    await writeFile(sourcePath, nativePayload);
    await mkdir(join(projectDirectory, nativeSessionId, 'subagents'), { recursive: true });
    await mkdir(join(projectDirectory, nativeSessionId, 'tool-results'), { recursive: true });
    await writeFile(
      join(projectDirectory, nativeSessionId, 'subagents', 'agent-one.jsonl'),
      JSON.stringify({ sessionId: nativeSessionId, cwd: sourceWorkspace, type: 'assistant' }) + '\n'
    );
    await writeFile(
      join(projectDirectory, nativeSessionId, 'tool-results', 'result.txt'),
      'opaque provider sidecar\n'
    );
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('uses Claude project directory naming without lowercasing Windows paths', () => {
    expect(claudeProjectDirectoryName('/Users/Dev/My_App')).toBe('-Users-Dev-My-App');
    expect(claudeProjectDirectoryName('D:\\Projects\\AI\\Lumora')).toBe('D--Projects-AI-Lumora');
  });

  it('exports the main transcript and only its session-specific companion tree', async () => {
    const adapter = createClaudeTransferAdapter({
      configRoot, discoverSessions: async () => discovery()
    });
    const stagingDirectory = join(root, 'export');
    await mkdir(stagingDirectory);

    const payload = await adapter.exportSession({
      installation, nativeSessionId, sourceKeys: [sourcePath],
      expectedWorkspacePath: sourceWorkspace, expectedTitle: 'Transfer me',
      stagingDirectory
    });

    const envelope = JSON.parse(await readFile(payload.payloadPath, 'utf8'));
    expect(envelope).toMatchObject({
      schemaVersion: 1,
      provider: 'claude',
      nativeSessionId,
      workspacePath: sourceWorkspace,
      title: 'Transfer me'
    });
    expect(envelope.files.map((file: { path: string }) => file.path).sort()).toEqual([
      'session.jsonl',
      'session/subagents/agent-one.jsonl',
      'session/tool-results/result.txt'
    ]);
    expect(envelope.files.some((file: { path: string }) => file.path.includes('memory'))).toBe(false);
  });

  it('accepts Windows workspace casing normalized by the catalog', async () => {
    const providerWorkspace = 'D:\\Projects\\ai\\haya-pet';
    const catalogWorkspace = 'D:\\Projects\\AI\\haya-pet';
    const providerProject = join(
      configRoot,
      'projects',
      claudeProjectDirectoryName(providerWorkspace)
    );
    const providerPath = join(providerProject, `${nativeSessionId}.jsonl`);
    const body = [
      JSON.stringify({
        sessionId: nativeSessionId,
        cwd: providerWorkspace,
        type: 'user',
        timestamp: '2026-07-29T08:00:00.000Z'
      }),
      JSON.stringify({
        sessionId: nativeSessionId,
        cwd: providerWorkspace,
        type: 'system',
        timestamp: '2026-07-29T08:01:00.000Z',
        customTitle: 'Transfer me'
      })
    ].join('\n') + '\n';
    await mkdir(providerProject, { recursive: true });
    await writeFile(providerPath, body);
    const stagingDirectory = join(root, 'case-export');
    await mkdir(stagingDirectory);
    const adapter = createClaudeTransferAdapter({
      configRoot, discoverSessions: async () => discovery()
    });

    const payload = await adapter.exportSession({
      installation, nativeSessionId, sourceKeys: [providerPath],
      expectedWorkspacePath: catalogWorkspace, expectedTitle: 'Transfer me',
      stagingDirectory
    });

    expect(payload.workspacePath).toBe(catalogWorkspace);
  });

  it('maps nested Claude working directories into the destination workspace', async () => {
    const nestedSource = join(sourceWorkspace, 'packages', 'desktop');
    nativePayload += JSON.stringify({
      sessionId: nativeSessionId,
      cwd: nestedSource,
      type: 'assistant',
      timestamp: '2026-07-29T08:02:00.000Z'
    }) + '\n';
    await writeFile(sourcePath, nativePayload);
    const adapter = createClaudeTransferAdapter({
      configRoot, discoverSessions: async () => discovery()
    });
    const exportDirectory = join(root, 'nested-export');
    const importDirectory = join(root, 'nested-import');
    const destinationWorkspace = join(root, 'Nested Destination');
    await mkdir(exportDirectory);
    await mkdir(importDirectory);
    await mkdir(destinationWorkspace);
    const payload = await adapter.exportSession({
      installation, nativeSessionId, sourceKeys: [sourcePath],
      expectedWorkspacePath: sourceWorkspace, expectedTitle: 'Transfer me',
      stagingDirectory: exportDirectory
    });
    const inspection = await adapter.inspectImport({ payloadPath: payload.payloadPath });

    await adapter.importSession({
      installation, inspection, destinationWorkspacePath: destinationWorkspace,
      stagingDirectory: importDirectory
    });

    const destinationPath = join(
      configRoot,
      'projects',
      claudeProjectDirectoryName(destinationWorkspace),
      `${nativeSessionId}.jsonl`
    );
    const records = (await readFile(destinationPath, 'utf8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    expect(records.map((record) => record.cwd)).toContain(
      join(destinationWorkspace, 'packages', 'desktop')
    );
  });

  it('preserves POSIX path semantics while mapping nested working directories', async () => {
    const portableSourceWorkspace = '/Users/dev/Source Workspace';
    const portableDestinationWorkspace = '/Users/dev/Destination Workspace';
    const portableSourcePath = join(
      configRoot,
      'projects',
      claudeProjectDirectoryName(portableSourceWorkspace),
      `${nativeSessionId}.jsonl`
    );
    const portablePayload = [
      JSON.stringify({
        sessionId: nativeSessionId,
        cwd: portableSourceWorkspace,
        type: 'system',
        customTitle: 'Transfer me'
      }),
      JSON.stringify({
        sessionId: nativeSessionId,
        cwd: posix.join(portableSourceWorkspace, 'packages', 'desktop'),
        type: 'assistant'
      })
    ].join('\n') + '\n';
    await mkdir(dirname(portableSourcePath), { recursive: true });
    await writeFile(portableSourcePath, portablePayload);
    const exportDirectory = join(root, 'posix-export');
    const importDirectory = join(root, 'posix-import');
    await mkdir(exportDirectory);
    await mkdir(importDirectory);
    const adapter = createClaudeTransferAdapter({
      configRoot,
      discoverSessions: async () => discovery()
    });

    const payload = await adapter.exportSession({
      installation,
      nativeSessionId,
      sourceKeys: [portableSourcePath],
      expectedWorkspacePath: portableSourceWorkspace,
      expectedTitle: 'Transfer me',
      stagingDirectory: exportDirectory
    });
    const inspection = await adapter.inspectImport({
      payloadPath: payload.payloadPath
    });
    await adapter.importSession({
      installation,
      inspection,
      destinationWorkspacePath: portableDestinationWorkspace,
      stagingDirectory: importDirectory
    });

    const destinationPath = join(
      configRoot,
      'projects',
      claudeProjectDirectoryName(portableDestinationWorkspace),
      `${nativeSessionId}.jsonl`
    );
    const records = (await readFile(destinationPath, 'utf8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    expect(records.map((record) => record.cwd)).toContain(
      posix.join(portableDestinationWorkspace, 'packages', 'desktop')
    );
  });

  it('rejects a transcript outside Claude project storage', async () => {
    const outside = join(root, `${nativeSessionId}.jsonl`);
    await writeFile(outside, nativePayload);
    const adapter = createClaudeTransferAdapter({
      configRoot, discoverSessions: async () => discovery()
    });

    await expect(adapter.exportSession({
      installation, nativeSessionId, sourceKeys: [outside],
      expectedWorkspacePath: sourceWorkspace, expectedTitle: 'Transfer me',
      stagingDirectory: root
    })).rejects.toMatchObject({ code: 'CLAUDE_SOURCE_INVALID' });
  });

  it('imports the complete session bundle and rewrites JSONL workspace metadata', async () => {
    let imported = false;
    const destinationWorkspace = join(root, 'Destination Workspace');
    await mkdir(destinationWorkspace);
    const destinationProject = join(
      configRoot, 'projects', claudeProjectDirectoryName(destinationWorkspace)
    );
    const destinationPath = join(destinationProject, `${nativeSessionId}.jsonl`);
    const adapter = createClaudeTransferAdapter({
      configRoot,
      discoverSessions: async () => discovery(imported ? [{
        provider: 'claude', nativeId: nativeSessionId,
        workspacePath: destinationWorkspace, title: 'Transfer me',
        createdAt: '2026-07-29T08:00:00.000Z',
        updatedAt: '2026-07-29T08:01:00.000Z',
        source: { key: destinationPath, fingerprint: null }
      }] : [])
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
    const main = (await readFile(destinationPath, 'utf8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    expect(main.every((record) => record.cwd === destinationWorkspace)).toBe(true);
    const subagent = JSON.parse(await readFile(
      join(destinationProject, nativeSessionId, 'subagents', 'agent-one.jsonl'),
      'utf8'
    ));
    expect(subagent.cwd).toBe(destinationWorkspace);
    await expect(readFile(
      join(destinationProject, nativeSessionId, 'tool-results', 'result.txt'),
      'utf8'
    )).resolves.toBe('opaque provider sidecar\n');
    await expect(adapter.verifyImportedSession({
      installation, nativeSessionId, workspacePath: destinationWorkspace,
      title: 'Transfer me'
    })).resolves.toBe(true);
  });

  it('skips a duplicate native identity without overwriting provider data', async () => {
    const adapter = createClaudeTransferAdapter({
      configRoot,
      discoverSessions: async () => discovery([{
        provider: 'claude', nativeId: nativeSessionId,
        workspacePath: sourceWorkspace, title: 'Transfer me',
        createdAt: '2026-07-29T08:00:00.000Z',
        updatedAt: '2026-07-29T08:01:00.000Z',
        source: { key: sourcePath, fingerprint: null }
      }])
    });
    const stagingDirectory = join(root, 'duplicate');
    await mkdir(stagingDirectory);
    const payload = await adapter.exportSession({
      installation, nativeSessionId, sourceKeys: [sourcePath],
      expectedWorkspacePath: sourceWorkspace, expectedTitle: 'Transfer me',
      stagingDirectory
    });
    const inspection = await adapter.inspectImport({ payloadPath: payload.payloadPath });

    await expect(adapter.importSession({
      installation, inspection, destinationWorkspacePath: sourceWorkspace,
      stagingDirectory
    })).resolves.toEqual({ status: 'duplicate', nativeSessionId });
    expect(await readFile(sourcePath, 'utf8')).toBe(nativePayload);
  });

  it('removes the imported transcript and companion tree during rollback', async () => {
    const workspace = join(root, 'Rollback Workspace');
    const project = join(configRoot, 'projects', claudeProjectDirectoryName(workspace));
    const transcript = join(project, `${nativeSessionId}.jsonl`);
    const companion = join(project, nativeSessionId, 'tool-results', 'result.txt');
    await mkdir(dirname(companion), { recursive: true });
    await writeFile(transcript, nativePayload);
    await writeFile(companion, 'sidecar');
    const adapter = createClaudeTransferAdapter({
      configRoot, discoverSessions: async () => discovery()
    });

    await adapter.rollbackImport({ installation, nativeSessionId, workspacePath: workspace });

    await expect(stat(transcript)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(stat(join(project, nativeSessionId))).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
