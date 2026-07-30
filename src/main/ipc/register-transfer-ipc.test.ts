import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { IPC_CHANNELS } from '../../shared/contracts';
import { registerTransferIpc } from './register-transfer-ipc';

interface InvokeEventStub {
  senderFrame: { url: string } | null;
}

type InvokeHandler = (
  event: InvokeEventStub,
  ...args: readonly unknown[]
) => Promise<unknown> | unknown;

const TOKEN = '0198f8b6-18f3-7ca0-9f0f-123456789abc';
const SESSION_ID = 'a'.repeat(64);
const WORKSPACE_ID = 'b'.repeat(64);
const NOW = '2026-07-29T08:00:00.000Z';
const capability = {
  provider: 'opencode' as const,
  displayName: 'OpenCode',
  exportSupport: 'supported' as const,
  routes: [
    {
      sourcePlatform: 'win32' as const,
      destinationPlatform: 'win32' as const,
      support: 'supported' as const
    }
  ],
  installGuidance: null
};
const exportPlan = {
  planToken: TOKEN,
  sessions: [
    {
      sessionId: SESSION_ID,
      nativeSessionId: 'ses_transfer',
      provider: 'opencode' as const,
      title: 'Transfer session',
      workspaceId: WORKSPACE_ID,
      estimatedBytes: 0
    }
  ],
  skipped: [],
  estimatedBytes: 0,
  expiresAt: '2026-07-29T08:15:00.000Z'
};
const archiveSelection = {
  selectionToken: TOKEN,
  fileName: 'sessions.lumora-sessions',
  encrypted: true
};
const inspection = {
  inspectionToken: TOKEN,
  archiveName: 'sessions.lumora-sessions',
  encrypted: true,
  sourcePlatform: 'win32' as const,
  providers: [
    {
      provider: 'opencode' as const,
      displayName: 'OpenCode',
      sessionCount: 1,
      support: 'supported' as const,
      installGuidance: null
    }
  ],
  workspaces: [],
  sessionCount: 1,
  expiresAt: '2026-07-29T08:15:00.000Z'
};
const importPlan = {
  planToken: TOKEN,
  ready: exportPlan.sessions,
  skipped: [],
  providers: ['opencode' as const],
  expiresAt: '2026-07-29T08:15:00.000Z'
};
const transferResult = {
  operationId: TOKEN,
  direction: 'import' as const,
  completedAt: NOW,
  status: 'completed' as const,
  importedCount: 1,
  exportedCount: 0,
  skippedCount: 0,
  failedCount: 0,
  providers: ['opencode' as const],
  items: [
    {
      sessionId: SESSION_ID,
      provider: 'opencode' as const,
      status: 'imported' as const,
      reason: null,
      message: 'Session imported.'
    }
  ]
};
const workspace = {
  id: WORKSPACE_ID,
  displayName: 'Lumora',
  canonicalPath: 'D:\\Projects\\Lumora',
  available: true,
  origin: 'manual' as const,
  sessionCount: 1,
  providerCounts: { opencode: 1 },
  lastActivityAt: NOW
};

function createHarness(options: {
  saveCancelled?: boolean;
  openCancelled?: boolean;
  workspaceCancelled?: boolean;
  executeImport?: () => Promise<typeof transferResult>;
} = {}) {
  const handlers = new Map<string, InvokeHandler>();
  const ipc = {
    handle(channel: string, handler: InvokeHandler) {
      handlers.set(channel, handler);
    }
  };
  const service = {
    getCapabilities: vi.fn(() => [capability]),
    prepareExport: vi.fn(async () => exportPlan),
    executeExport: vi.fn(async () => ({
      ...transferResult,
      direction: 'export' as const,
      importedCount: 0,
      exportedCount: 1,
      items: [
        {
          sessionId: SESSION_ID,
          provider: 'opencode' as const,
          status: 'exported' as const,
          reason: null,
          message: 'Session exported.'
        }
      ]
    })),
    chooseImportArchive: vi.fn(async () => archiveSelection),
    inspectImport: vi.fn(async () => inspection),
    planImport: vi.fn(async () => importPlan),
    executeImport: vi.fn(
      options.executeImport ?? (async () => transferResult)
    ),
    getHistory: vi.fn(() => [
      {
        id: TOKEN,
        direction: 'import' as const,
        completedAt: NOW,
        importedCount: 1,
        exportedCount: 0,
        skippedCount: 0,
        providers: ['opencode' as const]
      }
    ]),
    cancelOperation: vi.fn(() => ({ accepted: true as const }))
  };
  const showSaveDialog = vi.fn(async () =>
    options.saveCancelled
      ? { canceled: true }
      : {
          canceled: false,
          filePath: 'D:\\Exports\\Lumora-Sessions-2026-07-29.lumora-sessions'
        }
  );
  const showOpenDialog = vi.fn(async (dialogOptions: { properties: string[] }) => {
    const workspaceDialog = dialogOptions.properties.includes('openDirectory');
    const cancelled = workspaceDialog
      ? options.workspaceCancelled
      : options.openCancelled;
    return cancelled
      ? { canceled: true, filePaths: [] }
      : {
          canceled: false,
          filePaths: [
            workspaceDialog
              ? 'D:\\Projects\\Lumora'
              : 'D:\\Imports\\sessions.lumora-sessions'
          ]
        };
  });
  const registerWorkspace = vi.fn(async () => workspace);

  registerTransferIpc({
    ipc,
    service,
    downloadsDirectory: 'D:\\Downloads',
    lastDirectory: (direction) =>
      direction === 'export' ? 'D:\\Exports' : 'D:\\Imports',
    showSaveDialog,
    showOpenDialog,
    registerWorkspace,
    clock: () => new Date(NOW)
  });

  return {
    handlers,
    service,
    showSaveDialog,
    showOpenDialog,
    registerWorkspace
  };
}

function trustedEvent(): InvokeEventStub {
  return { senderFrame: { url: 'app://lumora/index.html' } };
}

function untrustedEvent(): InvokeEventStub {
  return { senderFrame: { url: 'https://example.com/index.html' } };
}

describe('registerTransferIpc', () => {
  it('registers only the narrowed transfer operations', () => {
    expect([...createHarness().handlers.keys()]).toEqual([
      IPC_CHANNELS.transferCapabilitiesGet,
      IPC_CHANNELS.transferExportPrepare,
      IPC_CHANNELS.transferExportExecute,
      IPC_CHANNELS.transferImportChoose,
      IPC_CHANNELS.transferImportInspect,
      IPC_CHANNELS.transferImportPlan,
      IPC_CHANNELS.transferImportExecute,
      IPC_CHANNELS.transferWorkspaceChoose,
      IPC_CHANNELS.transferHistoryGet,
      IPC_CHANNELS.transferOperationCancel
    ]);
  });

  it('uses native archive dialogs and returns null on cancellation', async () => {
    const harness = createHarness({ saveCancelled: true, openCancelled: true });

    await expect(
      harness.handlers.get(IPC_CHANNELS.transferExportExecute)!(
        trustedEvent(),
        { planToken: TOKEN, protection: { encrypted: false } }
      )
    ).resolves.toBeNull();
    await expect(
      harness.handlers.get(IPC_CHANNELS.transferImportChoose)!(trustedEvent())
    ).resolves.toBeNull();

    expect(harness.showSaveDialog).toHaveBeenCalledWith({
      defaultPath: join(
        'D:\\Exports',
        'Lumora-Sessions-2026-07-29.lumora-sessions'
      ),
      filters: [
        { name: 'Lumora Sessions', extensions: ['lumora-sessions'] }
      ],
      properties: ['showOverwriteConfirmation', 'createDirectory']
    });
    expect(harness.showOpenDialog).toHaveBeenCalledWith({
      defaultPath: 'D:\\Imports',
      filters: [
        { name: 'Lumora Sessions', extensions: ['lumora-sessions'] }
      ],
      properties: ['openFile']
    });
    expect(harness.service.executeExport).not.toHaveBeenCalled();
    expect(harness.service.chooseImportArchive).not.toHaveBeenCalled();
  });

  it('validates requests and results across transfer service handlers', async () => {
    const { handlers, service } = createHarness();

    await expect(
      handlers.get(IPC_CHANNELS.transferCapabilitiesGet)!(trustedEvent())
    ).resolves.toEqual([capability]);
    await expect(
      handlers.get(IPC_CHANNELS.transferExportPrepare)!(trustedEvent(), {
        sessionIds: [SESSION_ID]
      })
    ).resolves.toEqual(exportPlan);
    await expect(
      handlers.get(IPC_CHANNELS.transferImportInspect)!(trustedEvent(), {
        selectionToken: TOKEN,
        password: 'secret'
      })
    ).resolves.toEqual(inspection);
    await expect(
      handlers.get(IPC_CHANNELS.transferImportPlan)!(trustedEvent(), {
        inspectionToken: TOKEN,
        providers: ['opencode'],
        workspaceMappings: []
      })
    ).resolves.toEqual(importPlan);
    await expect(
      handlers.get(IPC_CHANNELS.transferImportExecute)!(trustedEvent(), {
        planToken: TOKEN
      })
    ).resolves.toEqual(transferResult);
    await expect(
      handlers.get(IPC_CHANNELS.transferHistoryGet)!(trustedEvent())
    ).resolves.toHaveLength(1);
    await expect(
      handlers.get(IPC_CHANNELS.transferOperationCancel)!(trustedEvent(), {
        operationId: TOKEN
      })
    ).resolves.toEqual({ accepted: true });

    expect(service.inspectImport).toHaveBeenCalledWith({
      selectionToken: TOKEN,
      password: 'secret'
    });
    expect(service.cancelOperation).toHaveBeenCalledWith(TOKEN);
  });

  it('passes only native-picker paths to export and import operations', async () => {
    const harness = createHarness();
    const request = {
      planToken: TOKEN,
      protection: { encrypted: false as const }
    };

    await expect(
      harness.handlers.get(IPC_CHANNELS.transferExportExecute)!(
        trustedEvent(),
        request,
        'C:\\renderer-controlled\\archive.lumora-sessions'
      )
    ).resolves.toMatchObject({ direction: 'export', exportedCount: 1 });
    await expect(
      harness.handlers.get(IPC_CHANNELS.transferImportChoose)!(
        trustedEvent(),
        'C:\\renderer-controlled\\archive.lumora-sessions'
      )
    ).resolves.toEqual(archiveSelection);

    expect(harness.service.executeExport).toHaveBeenCalledWith(
      request,
      'D:\\Exports\\Lumora-Sessions-2026-07-29.lumora-sessions'
    );
    expect(harness.service.chooseImportArchive).toHaveBeenCalledWith(
      'D:\\Imports\\sessions.lumora-sessions'
    );
  });
  it('registers a directory chosen through the trusted workspace picker', async () => {
    const harness = createHarness();
    await expect(
      harness.handlers.get(IPC_CHANNELS.transferWorkspaceChoose)!(trustedEvent())
    ).resolves.toEqual(workspace);
    expect(harness.showOpenDialog).toHaveBeenCalledWith({
      properties: ['openDirectory']
    });
    expect(harness.registerWorkspace).toHaveBeenCalledWith(
      'D:\\Projects\\Lumora'
    );
  });

  it('rejects untrusted senders before opening dialogs or invoking services', async () => {
    const harness = createHarness();
    await expect(
      harness.handlers.get(IPC_CHANNELS.transferExportExecute)!(
        untrustedEvent(),
        { planToken: TOKEN, protection: { encrypted: false } }
      )
    ).rejects.toMatchObject({ code: 'IPC_UNTRUSTED_SENDER' });
    await expect(
      harness.handlers.get(IPC_CHANNELS.transferImportChoose)!(untrustedEvent())
    ).rejects.toMatchObject({ code: 'IPC_UNTRUSTED_SENDER' });
    await expect(
      harness.handlers.get(IPC_CHANNELS.transferWorkspaceChoose)!(untrustedEvent())
    ).rejects.toMatchObject({ code: 'IPC_UNTRUSTED_SENDER' });
    expect(harness.showSaveDialog).not.toHaveBeenCalled();
    expect(harness.showOpenDialog).not.toHaveBeenCalled();
  });

  it('redacts internal paths and causes from privileged failures', async () => {
    const harness = createHarness({
      executeImport: async () => {
        throw new Error('C:\\Users\\name\\.opencode\\secret');
      }
    });
    await expect(
      harness.handlers.get(IPC_CHANNELS.transferImportExecute)!(trustedEvent(), {
        planToken: TOKEN
      })
    ).rejects.toMatchObject({
      code: 'SESSION_TRANSFER_FAILED',
      message: 'Lumora could not complete the session transfer.'
    });
  });
});
