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

function harness(options: {
  path?: string | null;
  exportDirectory?: string;
  fallbackDirectory?: string;
} = {}) {
  const write = vi.fn(async (_path: string, _data: string) => undefined);
  const record = vi.fn(async () => undefined);
  const chooseExportPath = vi.fn(async () => options.path ?? null);
  const rememberExportDirectory = vi.fn(async () => undefined);
  const monotonic = { now: 10_000 };
  const getProcessMetrics = vi.fn(() => [
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
  ]);
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
    monotonicClock: () => monotonic.now,
    getActiveAgentCount: () => 1,
    getProcessMetrics,
    getExportDirectory: vi.fn(async () => options.exportDirectory ?? 'C:\\Documents'),
    getFallbackExportDirectory: () => options.fallbackDirectory ?? 'C:\\Documents',
    chooseExportPath,
    rememberExportDirectory,
    writeFile: write
  });
  return {
    chooseExportPath,
    getProcessMetrics,
    monotonic,
    record,
    rememberExportDirectory,
    service,
    write
  };
}

describe('diagnostic service', () => {
  it('builds a bounded summary of the journal', async () => {
    const { service } = harness();

    await expect(service.getSummary()).resolves.toEqual({
      generatedAt: '2026-08-13T07:01:00.000Z',
      previousRunAbnormal: true,
      journal: { storedEvents: 1, invalidRecords: 0 },
      recentEvents: [event]
    });
  });

  it('samples resource use, reporting CPU only against a recent sample', async () => {
    const { monotonic, service } = harness();

    // Electron measures CPU since the previous metrics call, so the first call has nothing recent to compare.
    await expect(service.getResources()).resolves.toEqual({
      sampledAt: '2026-08-13T07:01:00.000Z',
      lumora: { processCount: 2, workingSetBytes: 153_600_000, cpuPercent: null },
      agents: { activeCount: 1 }
    });

    monotonic.now += 2_000;
    await expect(service.getResources()).resolves.toMatchObject({
      lumora: { cpuPercent: 4 }
    });

    // A sample taken long after the last one would average CPU over the whole gap.
    monotonic.now += 60_000;
    await expect(service.getResources()).resolves.toMatchObject({
      lumora: { cpuPercent: null }
    });
  });

  it('lets a call moments after another share its reading instead of cutting the next one short', async () => {
    const { getProcessMetrics, monotonic, service, write } = harness({
      path: 'C:\\Exports\\Lumora-diagnostics.json'
    });

    await service.getResources();
    monotonic.now += 2_000;
    await service.getResources();

    // An export between the page's samples reads Electron's metrics itself…
    monotonic.now += 1_900;
    await service.exportBundle();
    expect(getProcessMetrics).toHaveBeenCalledTimes(3);
    expect(JSON.parse(write.mock.calls[0]![1])).toMatchObject({
      resources: { lumora: { cpuPercent: 4 } }
    });

    // …so the page's next sample, moments later, shares that reading. A fresh
    // one would measure CPU over 100 ms.
    monotonic.now += 100;
    await expect(service.getResources()).resolves.toMatchObject({
      lumora: { cpuPercent: 4 }
    });
    expect(getProcessMetrics).toHaveBeenCalledTimes(3);
  });

  it('lists every Lumora process and each agent\u2019s processes', async () => {
    const monotonic = { now: 0 };
    const helperProcess = (pid: number, parentPid: number, name: string, cpuTimeMs = 0) => ({
      pid, parentPid, name, measured: true, workingSetBytes: 4_096, cpuTimeMs, startedAt: pid
    });
    const sampleProcessTree = vi.fn(async (rootPid: number) => (rootPid === 100
      ? { processes: [helperProcess(100, 1, 'Lumora.exe'), helperProcess(200, 100, 'codex.exe', 1_000)], truncated: false }
      : { processes: [helperProcess(900, 1, 'claude.exe')], truncated: false }));
    const service = createDiagnosticService({
      journal: { readRecent: vi.fn(), record: vi.fn() },
      previousRunAbnormal: false,
      appVersion: '0.5.11',
      platform: 'win32',
      architecture: 'x64',
      monotonicClock: () => monotonic.now,
      getActiveAgentCount: () => 2,
      getProcessMetrics: () => [
        { pid: 100, type: 'Browser', cpu: { percentCPUUsage: 1 }, memory: { workingSetSize: 1 } }
      ],
      mainProcessId: 100,
      listAgentProcesses: () => [
        { id: 'connection-1', provider: 'codex', surface: 'unified', title: 'Fix the build', processId: 200, starting: false },
        // Not under Lumora's process, so read on its own.
        { id: 'runtime-1', provider: 'claude', surface: 'terminal', title: 'Refactor', processId: 900, starting: false }
      ],
      sampleProcessTree,
      getExportDirectory: vi.fn(),
      getFallbackExportDirectory: () => 'C:\\Documents',
      chooseExportPath: vi.fn(),
      rememberExportDirectory: vi.fn(),
      writeFile: vi.fn()
    });

    const first = await service.getProcessDetails();
    expect(sampleProcessTree.mock.calls).toEqual([[100], [900]]);
    expect(first.lumora.map((row) => [row.pid, row.kind])).toEqual([[100, 'main']]);
    expect(first.agents.map((agent) => [agent.id, agent.status, agent.processes.map((row) => row.pid)])).toEqual([
      ['connection-1', 'measured', [200]],
      ['runtime-1', 'measured', [900]]
    ]);
    expect(first.agents[0]!.processes[0]!.cpuPercent).toBeNull();

    monotonic.now += 2_000;
    sampleProcessTree.mockImplementation(async (rootPid: number) => (rootPid === 100
      ? { processes: [helperProcess(100, 1, 'Lumora.exe'), helperProcess(200, 100, 'codex.exe', 2_000)], truncated: false }
      : { processes: [helperProcess(900, 1, 'claude.exe')], truncated: false }));
    const second = await service.getProcessDetails();
    expect(second.agents[0]!.processes[0]!.cpuPercent).toBe(50);

    sampleProcessTree.mockRejectedValue(new Error('helper failed'));
    const unreadable = await service.getProcessDetails();
    expect(unreadable.processTreeAvailable).toBe(false);
    expect(unreadable.lumora.map((row) => row.pid)).toEqual([100]);
    expect(unreadable.agents.map((agent) => agent.status)).toEqual(['unavailable', 'unavailable']);
  });

  it('returns cancelled without writing when no destination is selected', async () => {
    const { rememberExportDirectory, service, write } = harness();

    await expect(service.exportBundle()).resolves.toEqual({ status: 'cancelled' });
    expect(write).not.toHaveBeenCalled();
    expect(rememberExportDirectory).not.toHaveBeenCalled();
  });

  it('exports a validated local bundle without incidental sensitive fields', async () => {
    const { chooseExportPath, rememberExportDirectory, service, write } = harness({
      exportDirectory: 'D:\\Existing exports',
      path: 'C:\\Users\\private\\Lumora-diagnostics.json'
    });

    await expect(service.exportBundle()).resolves.toEqual({ status: 'saved' });
    expect(write).toHaveBeenCalledTimes(1);
    const [path, raw] = write.mock.calls[0]!;
    expect(path).toContain('Lumora-diagnostics.json');
    expect(raw).toContain('"schemaVersion": 2');
    expect(JSON.parse(raw)).toMatchObject({
      summary: { journal: { storedEvents: 1 } },
      resources: { lumora: { processCount: 2 }, agents: { activeCount: 1 } }
    });
    expect(raw).not.toContain('C:\\\\Users\\\\private');
    expect(raw).not.toContain('secret output');
    expect(chooseExportPath).toHaveBeenCalledWith(
      'Lumora-diagnostics-2026-08-13.json',
      'D:\\Existing exports'
    );
    expect(rememberExportDirectory).toHaveBeenCalledWith('C:\\Users\\private');
  });

  it('falls back to Documents when the remembered export directory is unavailable', async () => {
    const chooseExportPath = vi.fn(async () => null);
    const service = createDiagnosticService({
      journal: {
        readRecent: vi.fn(async () => ({ events: [], storedEvents: 0, invalidRecords: 0 })),
        record: vi.fn(async () => undefined)
      },
      previousRunAbnormal: false,
      appVersion: '0.3.2',
      platform: 'win32',
      architecture: 'x64',
      getActiveAgentCount: () => 0,
      getProcessMetrics: () => [],
      getExportDirectory: vi.fn(async () => {
        throw new Error('directory unavailable');
      }),
      getFallbackExportDirectory: () => 'C:\\Documents',
      chooseExportPath,
      rememberExportDirectory: vi.fn(async () => undefined),
      writeFile: vi.fn(async () => undefined)
    });

    await service.exportBundle();

    expect(chooseExportPath).toHaveBeenCalledWith(
      expect.stringContaining('Lumora-diagnostics-'),
      'C:\\Documents'
    );
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
