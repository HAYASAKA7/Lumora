import { describe, expect, it, vi } from 'vitest';

import {
  DiagnosticExportResultSchema,
  DiagnosticSummarySchema,
  IPC_CHANNELS
} from '../../shared/contracts';
import { registerDiagnosticIpc } from './register-diagnostic-ipc';

interface InvokeEventStub {
  senderFrame: { url: string } | null;
  sender: { id: number };
}

type InvokeHandler = (event: InvokeEventStub) => Promise<unknown> | unknown;

const summary = DiagnosticSummarySchema.parse({
  generatedAt: '2026-08-13T08:00:00.000Z',
  previousRunAbnormal: false,
  journal: { storedEvents: 2, invalidRecords: 0 },
  agents: { activeCount: 1 },
  processes: { processCount: 3, workingSetBytes: 1024, cpuPercent: 1.5 },
  recentEvents: []
});

const storage = {
  selectedJournalDirectory: null,
  effectiveJournalDirectory: 'C:\\Lumora\\diagnostics',
  selectedExportDirectory: null,
  effectiveExportDirectory: 'C:\\Documents',
  journalUsesDefault: true,
  exportUsesDefault: true,
  restartRequired: false,
  fallbackActive: false
} as const;

function createHarness(authorize = vi.fn(() => ({ mode: 'local' }))) {
  const handlers = new Map<string, InvokeHandler>();
  const service = {
    getSummary: vi.fn().mockResolvedValue(summary),
    exportBundle: vi.fn().mockResolvedValue({ status: 'saved' })
  };
  const storageService = {
    getSettings: vi.fn().mockResolvedValue(storage),
    selectJournalDirectory: vi.fn().mockResolvedValue({
      ...storage,
      selectedJournalDirectory: 'D:\\Diagnostics',
      journalUsesDefault: false,
      restartRequired: true
    }),
    resetJournalDirectory: vi.fn().mockResolvedValue(storage),
    selectExportDirectory: vi.fn().mockResolvedValue({
      ...storage,
      selectedExportDirectory: 'D:\\Exports',
      effectiveExportDirectory: 'D:\\Exports',
      exportUsesDefault: false
    }),
    resetExportDirectory: vi.fn().mockResolvedValue(storage)
  };
  const chooseDirectory = vi.fn()
    .mockResolvedValueOnce('D:\\Diagnostics')
    .mockResolvedValueOnce('D:\\Exports');

  registerDiagnosticIpc({
    ipc: {
      handle(channel: string, handler: InvokeHandler) {
        handlers.set(channel, handler);
      }
    },
    authorize: authorize as never,
    service,
    storage: storageService,
    chooseDirectory
  });

  return { authorize, chooseDirectory, handlers, service, storageService };
}

const trustedEvent: InvokeEventStub = {
  sender: { id: 7 },
  senderFrame: { url: 'app://lumora/index.html' }
};

describe('registerDiagnosticIpc', () => {
  it('registers validated summary and export operations', async () => {
    const { handlers, service } = createHarness();

    await expect(
      handlers.get(IPC_CHANNELS.diagnosticSummaryGet)?.(trustedEvent)
    ).resolves.toEqual(summary);
    await expect(
      handlers.get(IPC_CHANNELS.diagnosticBundleExport)?.(trustedEvent)
    ).resolves.toEqual({ status: 'saved' });

    expect(service.getSummary).toHaveBeenCalledOnce();
    expect(service.exportBundle).toHaveBeenCalledOnce();
    expect([...handlers.keys()]).toEqual([
      IPC_CHANNELS.diagnosticSummaryGet,
      IPC_CHANNELS.diagnosticBundleExport,
      IPC_CHANNELS.diagnosticStorageGet,
      IPC_CHANNELS.diagnosticJournalDirectoryChoose,
      IPC_CHANNELS.diagnosticJournalDirectoryReset,
      IPC_CHANNELS.diagnosticExportDirectoryChoose,
      IPC_CHANNELS.diagnosticExportDirectoryReset
    ]);
  });

  it('exposes native directory choices without accepting renderer paths', async () => {
    const { chooseDirectory, handlers, storageService } = createHarness();

    await expect(
      handlers.get(IPC_CHANNELS.diagnosticStorageGet)?.(trustedEvent)
    ).resolves.toEqual(storage);
    await handlers.get(IPC_CHANNELS.diagnosticJournalDirectoryChoose)?.(trustedEvent);
    await handlers.get(IPC_CHANNELS.diagnosticJournalDirectoryReset)?.(trustedEvent);
    await handlers.get(IPC_CHANNELS.diagnosticExportDirectoryChoose)?.(trustedEvent);
    await handlers.get(IPC_CHANNELS.diagnosticExportDirectoryReset)?.(trustedEvent);

    expect(chooseDirectory).toHaveBeenNthCalledWith(1, 'journal', storage.effectiveJournalDirectory);
    expect(chooseDirectory).toHaveBeenNthCalledWith(2, 'export', storage.effectiveExportDirectory);
    expect(storageService.selectJournalDirectory).toHaveBeenCalledWith('D:\\Diagnostics');
    expect(storageService.selectExportDirectory).toHaveBeenCalledWith('D:\\Exports');
    expect(storageService.resetJournalDirectory).toHaveBeenCalledOnce();
    expect(storageService.resetExportDirectory).toHaveBeenCalledOnce();
  });

  it('rejects calls denied by the local-window authorizer', async () => {
    const accessError = Object.assign(new Error('denied'), {
      code: 'IPC_UNTRUSTED_SENDER'
    });
    const { handlers, service } = createHarness(
      vi.fn(() => {
        throw accessError;
      })
    );

    await expect(
      handlers.get(IPC_CHANNELS.diagnosticSummaryGet)?.(trustedEvent)
    ).rejects.toBe(accessError);
    expect(service.getSummary).not.toHaveBeenCalled();
  });

  it('replaces malformed service results and internal failures with a stable error', async () => {
    const { handlers, service } = createHarness();
    service.getSummary.mockResolvedValueOnce({ recentEvents: ['unsafe'] });
    service.exportBundle.mockRejectedValueOnce(new Error('C:\\private\\path'));

    await expect(
      handlers.get(IPC_CHANNELS.diagnosticSummaryGet)?.(trustedEvent)
    ).rejects.toMatchObject({ code: 'DIAGNOSTIC_OPERATION_FAILED' });
    await expect(
      handlers.get(IPC_CHANNELS.diagnosticBundleExport)?.(trustedEvent)
    ).rejects.toMatchObject({ code: 'DIAGNOSTIC_OPERATION_FAILED' });

    expect(() => DiagnosticExportResultSchema.parse({ status: 'saved' })).not.toThrow();
  });
});
