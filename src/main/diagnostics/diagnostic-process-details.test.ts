import { describe, expect, it } from 'vitest';

import { DiagnosticProcessDetailsSchema } from '../../shared/diagnostics';
import type { HelperProcess } from '../../shared/remote-helper-protocol';
import {
  buildProcessDetails,
  createProcessCpuTracker,
  type AgentProcessRoot,
  type BuildProcessDetailsInput
} from './diagnostic-process-details';

function process(pid: number, parentPid: number, name: string, extra: Partial<HelperProcess> = {}): HelperProcess {
  return {
    pid, parentPid, name, measured: true,
    workingSetBytes: pid * 1_000, cpuTimeMs: 0, startedAt: 1_000 + pid,
    ...extra
  };
}

const electron = [
  { pid: 100, type: 'Browser', cpu: { percentCPUUsage: 1.5 }, memory: { workingSetSize: 200_000 } },
  { pid: 101, type: 'GPU', cpu: { percentCPUUsage: 0.5 }, memory: { workingSetSize: 90_000 } },
  { pid: 102, type: 'Utility', name: 'Network Service', cpu: { percentCPUUsage: 0 }, memory: { workingSetSize: 30_000 } },
  { pid: 103, type: 'Tab', cpu: { percentCPUUsage: 3 }, memory: { workingSetSize: 150_000 } }
];

const tree = [
  process(100, 1, 'Lumora.exe'),
  process(101, 100, 'Lumora.exe'),
  process(102, 100, 'Lumora.exe'),
  process(103, 100, 'Lumora.exe'),
  process(110, 100, 'lumora-helper.exe'),
  // A Codex session started through its npm shim.
  process(200, 100, 'cmd.exe'),
  process(201, 200, 'node.exe'),
  process(202, 201, 'codex.exe', { cpuTimeMs: 500 }),
  // A terminal session running Claude, which is running a build.
  process(300, 100, 'claude.exe'),
  process(301, 300, 'npm.exe', { measured: false })
];

const agents: AgentProcessRoot[] = [
  { id: 'runtime-1', provider: 'claude', surface: 'terminal', title: 'Refactor settings', processId: 300, starting: false },
  { id: 'connection-1', provider: 'codex', surface: 'unified', title: 'Fix the build', processId: 200, starting: false },
  { id: 'connection-2', provider: 'gemini', surface: 'unified', title: 'Starting', processId: null, starting: true },
  { id: 'connection-3', provider: 'qwen', surface: 'unified', title: 'Gone', processId: 999, starting: false }
];

function input(overrides: Partial<BuildProcessDetailsInput> = {}): BuildProcessDetailsInput {
  return {
    sampledAt: '2026-09-14T10:00:00.000Z',
    mainProcessId: 100,
    electron: { metrics: electron, cpuIsCurrent: true },
    processes: tree,
    truncated: false,
    cpuPercent: (entry) => (entry.pid === 202 ? 12.5 : 0),
    agents,
    ...overrides
  };
}

describe('diagnostic process details', () => {
  it('lists Lumora apart from each agent and the processes that agent started', () => {
    const details = DiagnosticProcessDetailsSchema.parse(buildProcessDetails(input()));

    expect(details.processTreeAvailable).toBe(true);
    expect(details.lumora).toEqual([
      { pid: 100, depth: 0, kind: 'main', name: 'Browser', workingSetBytes: 204_800_000, cpuPercent: 1.5 },
      { pid: 101, depth: 1, kind: 'gpu', name: 'GPU', workingSetBytes: 92_160_000, cpuPercent: 0.5 },
      { pid: 102, depth: 1, kind: 'utility', name: 'Network Service', workingSetBytes: 30_720_000, cpuPercent: 0 },
      { pid: 103, depth: 1, kind: 'renderer', name: 'Tab', workingSetBytes: 153_600_000, cpuPercent: 3 },
      { pid: 110, depth: 1, kind: 'process', name: 'lumora-helper.exe', workingSetBytes: 110_000, cpuPercent: 0 }
    ]);
    expect(details.agents.map((agent) => [agent.id, agent.status, agent.processes.map((row) => [row.pid, row.depth])])).toEqual([
      ['runtime-1', 'measured', [[300, 0], [301, 1]]],
      ['connection-1', 'measured', [[200, 0], [201, 1], [202, 2]]],
      ['connection-2', 'starting', []],
      ['connection-3', 'unavailable', []]
    ]);
    const codex = details.agents[1]!.processes;
    expect(codex[2]).toEqual({
      pid: 202, depth: 2, kind: 'process', name: 'codex.exe', workingSetBytes: 202_000, cpuPercent: 12.5
    });
    // A process that could not be read is listed without figures.
    expect(details.agents[0]!.processes[1]).toMatchObject({ workingSetBytes: null, cpuPercent: null });
  });

  it('still lists Electron processes when the process tree cannot be read', () => {
    const details = buildProcessDetails(input({
      processes: null,
      electron: { metrics: [...electron].reverse(), cpuIsCurrent: false }
    }));

    expect(details.processTreeAvailable).toBe(false);
    expect(details.lumora.map((row) => [row.pid, row.depth, row.cpuPercent])).toEqual([
      [100, 0, null], [103, 1, null], [102, 1, null], [101, 1, null]
    ]);
    expect(details.agents.map((agent) => agent.status)).toEqual([
      'unavailable', 'unavailable', 'starting', 'unavailable'
    ]);
  });

  it('measures CPU between samples and never across a reused process ID', () => {
    let now = 0;
    const track = createProcessCpuTracker(() => now);

    const first = track([process(5, 1, 'agent', { cpuTimeMs: 1_000 })]);
    expect(first(process(5, 1, 'agent', { cpuTimeMs: 1_000 }))).toBeNull();

    now = 2_000;
    const busy = process(5, 1, 'agent', { cpuTimeMs: 2_000 });
    expect(track([busy])(busy)).toBe(50);

    now = 4_000;
    const reused = process(5, 1, 'other', { cpuTimeMs: 9_000, startedAt: 3_500 });
    expect(track([reused])(reused)).toBeNull();

    now = 60_000;
    const late = process(5, 1, 'other', { cpuTimeMs: 9_500, startedAt: 3_500 });
    expect(track([late])(late)).toBeNull();
  });
});
