import {
  DIAGNOSTIC_MAX_AGENTS,
  DIAGNOSTIC_MAX_PROCESSES,
  type DiagnosticAgentProcesses,
  type DiagnosticProcess,
  type DiagnosticProcessDetails
} from '../../shared/diagnostics';
import type { HelperProcess } from '../../shared/remote-helper-protocol';

/** The parts of Electron's ProcessMetric the details use. */
export interface ElectronProcessMetric {
  pid?: number;
  type?: string;
  name?: string;
  serviceName?: string;
  cpu: { percentCPUUsage: number };
  memory: { workingSetSize: number };
}

/** A running agent and the process Lumora started for it. */
export interface AgentProcessRoot {
  id: string;
  provider: string;
  surface: 'terminal' | 'unified';
  title: string;
  processId: number | null;
  starting: boolean;
}

export interface BuildProcessDetailsInput {
  sampledAt: string;
  mainProcessId: number;
  electron: { metrics: readonly ElectronProcessMetric[]; cpuIsCurrent: boolean };
  /** Processes under Lumora and any agent outside its tree; null when unreadable. */
  processes: readonly HelperProcess[] | null;
  truncated: boolean;
  cpuPercent(process: HelperProcess): number | null;
  agents: readonly AgentProcessRoot[];
}

const ELECTRON_KINDS: Readonly<Record<string, DiagnosticProcess['kind']>> = {
  Browser: 'main',
  Tab: 'renderer',
  GPU: 'gpu',
  Utility: 'utility'
};

/**
 * Electron reports CPU per process since its previous metrics call; the helper
 * reports total CPU time, so its share is measured between two samples.
 */
export function createProcessCpuTracker(now: () => number, maxGapMs = 10_000) {
  const minGapMs = 250;
  let previous = new Map<string, { cpuTimeMs: number; at: number }>();
  return (processes: readonly HelperProcess[]) => {
    const at = now();
    const next = new Map<string, { cpuTimeMs: number; at: number }>();
    const percents = new Map<string, number>();
    for (const process of processes) {
      if (!process.measured) continue;
      // A PID reused by a newer process must not inherit the old one's CPU time.
      const key = `${process.pid}:${process.startedAt}`;
      const before = previous.get(key);
      next.set(key, { cpuTimeMs: process.cpuTimeMs, at });
      if (before === undefined) continue;
      const gap = at - before.at;
      if (gap < minGapMs || gap > maxGapMs) continue;
      percents.set(key, Math.min(100_000, Math.max(0, ((process.cpuTimeMs - before.cpuTimeMs) / gap) * 100)));
    }
    previous = next;
    return (process: HelperProcess) => percents.get(`${process.pid}:${process.startedAt}`) ?? null;
  };
}

function electronRow(metric: ElectronProcessMetric, depth: number, cpuIsCurrent: boolean): DiagnosticProcess {
  const kind = ELECTRON_KINDS[metric.type ?? ''] ?? 'process';
  return {
    pid: metric.pid ?? 0,
    depth,
    kind,
    name: (metric.name ?? metric.serviceName ?? metric.type ?? '').slice(0, 128),
    workingSetBytes: Number.isFinite(metric.memory.workingSetSize)
      ? Math.max(0, Math.round(metric.memory.workingSetSize * 1_024))
      : null,
    cpuPercent: cpuIsCurrent && Number.isFinite(metric.cpu.percentCPUUsage)
      ? Math.min(100_000, Math.max(0, metric.cpu.percentCPUUsage))
      : null
  };
}

export function buildProcessDetails(input: BuildProcessDetailsInput): DiagnosticProcessDetails {
  const processes = input.processes ?? [];
  const byPid = new Map(processes.map((process) => [process.pid, process]));
  const children = new Map<number, HelperProcess[]>();
  for (const process of processes) {
    if (process.pid === process.parentPid) continue;
    const siblings = children.get(process.parentPid) ?? [];
    siblings.push(process);
    children.set(process.parentPid, siblings);
  }
  for (const siblings of children.values()) siblings.sort((left, right) => left.pid - right.pid);

  const electronByPid = new Map(
    input.electron.metrics.flatMap((metric) => (metric.pid === undefined ? [] : [[metric.pid, metric] as const]))
  );
  const claimed = new Set<number>();
  let truncated = input.truncated;

  const toRow = (process: HelperProcess, depth: number): DiagnosticProcess => {
    const electron = electronByPid.get(process.pid);
    if (electron !== undefined) return electronRow(electron, depth, input.electron.cpuIsCurrent);
    return {
      pid: process.pid,
      depth,
      kind: 'process',
      name: process.name,
      workingSetBytes: process.measured ? process.workingSetBytes : null,
      cpuPercent: process.measured ? input.cpuPercent(process) : null
    };
  };

  // Depth first from root, skipping anything already listed, such as an agent
  // started under Lumora whose processes belong to that agent.
  const collect = (rootPid: number): DiagnosticProcess[] => {
    const rows: DiagnosticProcess[] = [];
    const stack: Array<{ process: HelperProcess; depth: number }> = [];
    const root = byPid.get(rootPid);
    if (root !== undefined) stack.push({ process: root, depth: 0 });
    while (stack.length > 0) {
      const { process, depth } = stack.pop()!;
      if (claimed.has(process.pid)) continue;
      if (rows.length === DIAGNOSTIC_MAX_PROCESSES) {
        truncated = true;
        break;
      }
      claimed.add(process.pid);
      rows.push(toRow(process, Math.min(depth, DIAGNOSTIC_MAX_PROCESSES)));
      const next = children.get(process.pid) ?? [];
      for (let index = next.length - 1; index >= 0; index -= 1) {
        stack.push({ process: next[index]!, depth: depth + 1 });
      }
    }
    return rows;
  };

  const agents: DiagnosticAgentProcesses[] = input.agents.slice(0, DIAGNOSTIC_MAX_AGENTS).map((agent) => {
    const base = {
      id: agent.id.slice(0, 128),
      provider: agent.provider,
      surface: agent.surface,
      title: agent.title.slice(0, 256)
    };
    if (agent.processId === null) {
      return { ...base, status: agent.starting ? 'starting' : 'unavailable', processes: [] };
    }
    const rows = collect(agent.processId);
    return rows.length === 0
      ? { ...base, status: 'unavailable', processes: [] }
      : { ...base, status: 'measured', processes: rows };
  });
  if (input.agents.length > DIAGNOSTIC_MAX_AGENTS) truncated = true;

  // Agents claimed their processes above, so Lumora's own list leaves them out.
  const lumora = collect(input.mainProcessId);
  // Electron's own processes stay listed even when the process tree is unreadable.
  const electronOnly = input.electron.metrics
    .filter((metric) => metric.pid !== undefined && !claimed.has(metric.pid))
    .sort((left, right) => (left.pid === input.mainProcessId ? -1 : right.pid === input.mainProcessId ? 1 : 0))
    .map((metric) => electronRow(metric, metric.pid === input.mainProcessId ? 0 : 1, input.electron.cpuIsCurrent));
  const combined = [...lumora, ...electronOnly];
  if (combined.length > DIAGNOSTIC_MAX_PROCESSES) truncated = true;

  return {
    sampledAt: input.sampledAt,
    processTreeAvailable: input.processes !== null,
    truncated,
    lumora: combined.slice(0, DIAGNOSTIC_MAX_PROCESSES),
    agents
  };
}
