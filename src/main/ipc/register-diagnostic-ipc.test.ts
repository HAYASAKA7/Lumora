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
  processes: { processCount: 3, workingSetBytes: 1024, cpuPercent: 1.5 },
  recentEvents: []
});

function createHarness(authorize = vi.fn(() => ({ mode: 'local' }))) {
  const handlers = new Map<string, InvokeHandler>();
  const service = {
    getSummary: vi.fn().mockResolvedValue(summary),
    exportBundle: vi.fn().mockResolvedValue({ status: 'saved' })
  };

  registerDiagnosticIpc({
    ipc: {
      handle(channel: string, handler: InvokeHandler) {
        handlers.set(channel, handler);
      }
    },
    authorize: authorize as never,
    service
  });

  return { authorize, handlers, service };
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
      IPC_CHANNELS.diagnosticBundleExport
    ]);
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
