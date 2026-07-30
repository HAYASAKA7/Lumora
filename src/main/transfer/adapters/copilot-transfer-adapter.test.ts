import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ProviderSessionDiscoveryResult } from '../../providers/session-discovery';
import { createCopilotTransferAdapter } from './copilot-transfer-adapter';

const installation = {
  provider: 'copilot' as const,
  displayName: 'GitHub Copilot CLI',
  state: 'ready' as const,
  executablePath: '/usr/local/bin/copilot',
  version: '1.0.20',
  issue: null
};
const nativeSessionId = '22222222-2222-4222-8222-222222222222';
const sourceWorkspace = '/work/source';
const title = 'Transfer Copilot task';

function discovery(
  sessions: ProviderSessionDiscoveryResult['sessions'] = []
): ProviderSessionDiscoveryResult {
  return { provider: 'copilot', sessions, discoveredCount: sessions.length,
    unchangedCount: 0, invalidCount: 0 };
}

describe('Copilot transfer adapter', () => {
  let root: string;
  let configRoot: string;
  let sessionRoot: string;
  let eventsPath: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'lumora-copilot-transfer-'));
    configRoot = join(root, '.copilot');
    sessionRoot = join(configRoot, 'session-state', nativeSessionId);
    eventsPath = join(sessionRoot, 'events.jsonl');
    await mkdir(join(sessionRoot, 'checkpoints'), { recursive: true });
    await writeFile(join(sessionRoot, 'workspace.yaml'), [
      `id: ${nativeSessionId}`,
      `cwd: ${sourceWorkspace}`,
      `summary: ${title}`,
      'created_at: 2026-07-29T08:00:00.000Z',
      'updated_at: 2026-07-29T08:01:00.000Z'
    ].join('\n') + '\n');
    await writeFile(eventsPath, [
      JSON.stringify({
        type: 'session.start', timestamp: '2026-07-29T08:00:00.000Z',
        data: { context: { cwd: sourceWorkspace }, sessionId: nativeSessionId }
      }),
      JSON.stringify({
        type: 'session.title_changed', timestamp: '2026-07-29T08:01:00.000Z',
        data: { title }
      })
    ].join('\n') + '\n');
    await writeFile(join(sessionRoot, 'checkpoints', 'index.md'), '# provider-owned checkpoint\n');
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('exports the complete provider-owned session directory', async () => {
    const adapter = createCopilotTransferAdapter({
      configRoot, discoverSessions: async () => discovery()
    });
    const stagingDirectory = join(root, 'export');
    await mkdir(stagingDirectory);

    const payload = await adapter.exportSession({
      installation, nativeSessionId, sourceKeys: [eventsPath],
      expectedWorkspacePath: sourceWorkspace, expectedTitle: title,
      stagingDirectory
    });
    const inspection = await adapter.inspectImport({ payloadPath: payload.payloadPath });

    expect(inspection).toMatchObject({
      provider: 'copilot', nativeSessionId, workspacePath: sourceWorkspace, title
    });
    expect(await readFile(payload.payloadPath, 'utf8')).toContain('checkpoints/index.md');
  });

  it('rejects a source outside the matching provider session directory', async () => {
    const outside = join(root, 'events.jsonl');
    await writeFile(outside, await readFile(eventsPath));
    const adapter = createCopilotTransferAdapter({
      configRoot, discoverSessions: async () => discovery()
    });

    await expect(adapter.exportSession({
      installation, nativeSessionId, sourceKeys: [outside],
      expectedWorkspacePath: sourceWorkspace, expectedTitle: title,
      stagingDirectory: root
    })).rejects.toMatchObject({ code: 'COPILOT_SOURCE_INVALID' });
  });

  it('imports the native directory with mapped workspace metadata', async () => {
    const exportAdapter = createCopilotTransferAdapter({
      configRoot, discoverSessions: async () => discovery()
    });
    const exportDirectory = join(root, 'export-import');
    await mkdir(exportDirectory);
    const payload = await exportAdapter.exportSession({
      installation, nativeSessionId, sourceKeys: [eventsPath],
      expectedWorkspacePath: sourceWorkspace, expectedTitle: title,
      stagingDirectory: exportDirectory
    });
    const inspection = await exportAdapter.inspectImport({ payloadPath: payload.payloadPath });
    await rm(sessionRoot, { recursive: true, force: true });
    const destinationWorkspace = '/work/destination';
    let imported = false;
    const importedRecord = {
      provider: 'copilot' as const, nativeId: nativeSessionId,
      workspacePath: destinationWorkspace, title,
      createdAt: '2026-07-29T08:00:00.000Z', updatedAt: '2026-07-29T08:01:00.000Z',
      source: { key: eventsPath, fingerprint: null }
    };
    const adapter = createCopilotTransferAdapter({
      configRoot,
      discoverSessions: async () => discovery(imported ? [importedRecord] : [])
    });

    const outcome = await adapter.importSession({
      installation, inspection, destinationWorkspacePath: destinationWorkspace,
      stagingDirectory: join(root, 'import')
    });
    imported = true;

    expect(outcome).toEqual({
      status: 'imported', nativeSessionId, payloadPath: eventsPath
    });
    expect(await readFile(join(sessionRoot, 'workspace.yaml'), 'utf8'))
      .toContain(`cwd: ${destinationWorkspace}`);
    expect(await readFile(eventsPath, 'utf8')).toContain(`"cwd":"${destinationWorkspace}"`);
    await expect(adapter.verifyImportedSession({
      installation, nativeSessionId, workspacePath: destinationWorkspace, title
    })).resolves.toBe(true);
  });

  it('skips duplicate native identities without overwriting files', async () => {
    const adapter = createCopilotTransferAdapter({
      configRoot,
      discoverSessions: async () => discovery([{
        provider: 'copilot', nativeId: nativeSessionId,
        workspacePath: sourceWorkspace, title,
        createdAt: '2026-07-29T08:00:00.000Z', updatedAt: '2026-07-29T08:01:00.000Z',
        source: { key: eventsPath, fingerprint: null }
      }])
    });
    const stagingDirectory = join(root, 'duplicate');
    await mkdir(stagingDirectory);
    const payload = await adapter.exportSession({
      installation, nativeSessionId, sourceKeys: [eventsPath],
      expectedWorkspacePath: sourceWorkspace, expectedTitle: title,
      stagingDirectory
    });
    const inspection = await adapter.inspectImport({ payloadPath: payload.payloadPath });

    await expect(adapter.importSession({
      installation, inspection, destinationWorkspacePath: sourceWorkspace,
      stagingDirectory
    })).resolves.toEqual({ status: 'duplicate', nativeSessionId });
  });

  it('rolls back only the imported native session directory', async () => {
    const adapter = createCopilotTransferAdapter({
      configRoot, discoverSessions: async () => discovery()
    });

    await adapter.rollbackImport({ installation, nativeSessionId, workspacePath: sourceWorkspace });

    await expect(readFile(eventsPath)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await readFile(join(configRoot, 'config.json'), 'utf8').catch(() => 'missing')).toBe('missing');
  });
});
