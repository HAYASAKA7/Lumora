import { describe, expect, it, vi } from 'vitest';

import type { DiagnosticEvent } from '../../shared/diagnostics';
import { createDiagnosticService } from './diagnostic-service';

const event: DiagnosticEvent = {
  id: '0198f8b6-18f3-7ca0-9f0f-123456789abc',
  recordedAt: '2026-08-13T07:00:00.000Z',
  severity: 'warning',
  subsystem: 'startup',
  operation: 'previous-run',
  outcome: 'failed',
  correlationId: '0198f8b6-18f3-7ca0-9f0f-123456789abd',
  targetKind: 'local',
  code: 'PREVIOUS_RUN_ABNORMAL'
};

function harness(options: { path?: string | null } = {}) {
  const write = vi.fn(async (_path: string, _data: string) => undefined);
  const record = vi.fn(async () => undefined);
  const service = createDiagnosticService({
    journal: {
      readRecent: vi.fn(async () => ({
        events: [event],
        storedEvents: 1,
        invalidRecords: 0
      })),
      record
    },
    previousRunAbnormal: true,
    appVersion: '0.3.2',
    platform: 'win32',
    architecture: 'x64',
    clock: () => new Date('2026-08-13T07:01:00.000Z'),
    createId: () => '0198f8b6-18f3-7ca0-9f0f-123456789abe',
    getProcessMetrics: () => [
      {
        cpu: { percentCPUUsage: 1.25 },
        memory: { workingSetSize: 100_000 },
        privatePath: 'C:\\Users\\private\\secret'
      },
      {
        cpu: { percentCPUUsage: 2.75 },
        memory: { workingSetSize: 50_000 },
        terminalOutput: 'secret output'
      }
    ],
    chooseExportPath: vi.fn(async () => options.path ?? null),
    writeFile: write
  });
  return { record, service, write };
}

describe('diagnostic service', () => {
  it('builds a bounded summary from fixed process metrics', async () => {
    const { service } = harness();

    await expect(service.getSummary()).resolves.toEqual({
      generatedAt: '2026-08-13T07:01:00.000Z',
      previousRunAbnormal: true,
      journal: { storedEvents: 1, invalidRecords: 0 },
      processes: {
        processCount: 2,
        workingSetBytes: 153_600_000,
        cpuPercent: 4
      },
      recentEvents: [event]
    });
  });

  it('returns cancelled without writing when no destination is selected', async () => {
    const { service, write } = harness();

    await expect(service.exportBundle()).resolves.toEqual({ status: 'cancelled' });
    expect(write).not.toHaveBeenCalled();
  });

  it('exports a validated local bundle without incidental sensitive fields', async () => {
    const { service, write } = harness({
      path: 'C:\\Users\\private\\Lumora-diagnostics.json'
    });

    await expect(service.exportBundle()).resolves.toEqual({ status: 'saved' });
    expect(write).toHaveBeenCalledTimes(1);
    const [path, raw] = write.mock.calls[0]!;
    expect(path).toContain('Lumora-diagnostics.json');
    expect(raw).toContain('"schemaVersion": 1');
    expect(raw).not.toContain('C:\\\\Users\\\\private');
    expect(raw).not.toContain('secret output');
  });

  it('constructs journal events and rejects arbitrary diagnostic text', async () => {
    const { record, service } = harness();

    await service.record({
      severity: 'info',
      subsystem: 'application',
      operation: 'launch',
      outcome: 'succeeded',
      targetKind: 'local'
    });
    expect(record).toHaveBeenCalledWith(expect.objectContaining({
      id: '0198f8b6-18f3-7ca0-9f0f-123456789abe',
      correlationId: '0198f8b6-18f3-7ca0-9f0f-123456789abe',
      recordedAt: '2026-08-13T07:01:00.000Z'
    }));
    await expect(service.record({
      severity: 'error',
      subsystem: 'application',
      operation: 'launch',
      outcome: 'failed',
      targetKind: 'local',
      message: 'private exception'
    } as never)).rejects.toThrow();
  });
});
