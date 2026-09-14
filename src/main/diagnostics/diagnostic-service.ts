import { randomUUID } from 'node:crypto';
import { posix, win32 } from 'node:path';

import {
  DiagnosticBundleSchema,
  DiagnosticEventSchema,
  DiagnosticExportResultSchema,
  DiagnosticProcessDetailsSchema,
  DiagnosticResourcesSchema,
  DiagnosticSummarySchema,
  type DiagnosticEvent,
  type DiagnosticExportResult,
  type DiagnosticProcessDetails,
  type DiagnosticResources,
  type DiagnosticSummary
} from '../../shared/diagnostics';
import type { SystemInfo } from '../../shared/contracts';
import type { HelperProcessTreeResult } from '../../shared/remote-helper-protocol';
import {
  buildProcessDetails,
  createProcessCpuTracker,
  type AgentProcessRoot,
  type ElectronProcessMetric
} from './diagnostic-process-details';

type DiagnosticRecordInput = Omit<
  DiagnosticEvent,
  'id' | 'recordedAt' | 'correlationId'
> & { correlationId?: string };

interface DiagnosticJournalPort {
  readRecent(limit?: number): Promise<{
    events: DiagnosticEvent[];
    storedEvents: number;
    invalidRecords: number;
  }>;
  record(event: DiagnosticEvent): Promise<void>;
}

type ProcessMetricLike = ElectronProcessMetric;

interface CreateDiagnosticServiceOptions {
  journal: DiagnosticJournalPort;
  previousRunAbnormal: boolean;
  appVersion: string;
  platform: SystemInfo['platform'];
  architecture: string;
  getActiveAgentCount(): number;
  getProcessMetrics(): readonly ProcessMetricLike[];
  /** Lumora's main process, the root of its process tree. */
  mainProcessId?: number;
  listAgentProcesses?(): readonly AgentProcessRoot[];
  /** Reads a process and everything under it; absent where that is unsupported. */
  sampleProcessTree?(rootPid: number): Promise<HelperProcessTreeResult>;
  getExportDirectory(): Promise<string>;
  getFallbackExportDirectory(): string;
  chooseExportPath(
    suggestedName: string,
    initialDirectory: string
  ): Promise<string | null>;
  rememberExportDirectory(directory: string): Promise<void>;
  writeFile(path: string, data: string): Promise<void>;
  clock?: () => Date;
  /** Milliseconds that only move forward, for measuring the gap between samples. */
  monotonicClock?: () => number;
  createId?: () => string;
}

export interface DiagnosticService {
  getSummary(): Promise<DiagnosticSummary>;
  getResources(): Promise<DiagnosticResources>;
  getProcessDetails(): Promise<DiagnosticProcessDetails>;
  exportBundle(): Promise<DiagnosticExportResult>;
  record(input: DiagnosticRecordInput): Promise<void>;
}

/**
 * Electron reports each process's CPU use since the previous metrics call, so a
 * reading is only current when that call was recent — and not so recent that
 * the interval is too short to measure.
 */
const CPU_SAMPLE_MIN_GAP_MS = 250;
const CPU_SAMPLE_MAX_GAP_MS = 5_000;

function boundedNumber(value: number, maximum: number): number {
  return Number.isFinite(value)
    ? Math.max(0, Math.min(maximum, value))
    : 0;
}

export function createDiagnosticService({
  journal,
  previousRunAbnormal,
  appVersion,
  platform,
  architecture,
  getActiveAgentCount,
  getProcessMetrics,
  mainProcessId = process.pid,
  listAgentProcesses = () => [],
  sampleProcessTree,
  getExportDirectory,
  getFallbackExportDirectory,
  chooseExportPath,
  rememberExportDirectory,
  writeFile,
  clock = () => new Date(),
  monotonicClock = () => performance.now(),
  createId = randomUUID
}: CreateDiagnosticServiceOptions): DiagnosticService {
  let latestMetrics: {
    at: number;
    metrics: readonly ProcessMetricLike[];
    cpuIsCurrent: boolean;
  } | null = null;
  const trackProcessCpu = createProcessCpuTracker(monotonicClock);

  /**
   * Every metrics call restarts Electron's CPU measurement for all callers, so a
   * call made moments after another reuses that reading instead of cutting the
   * next one short.
   */
  const readMetrics = () => {
    const at = monotonicClock();
    if (latestMetrics !== null && at - latestMetrics.at < CPU_SAMPLE_MIN_GAP_MS) {
      return latestMetrics;
    }
    const gap = latestMetrics === null ? null : at - latestMetrics.at;
    latestMetrics = {
      at,
      metrics: getProcessMetrics().slice(0, 1_024),
      cpuIsCurrent: gap !== null && gap <= CPU_SAMPLE_MAX_GAP_MS
    };
    return latestMetrics;
  };

  const getSummary = async (): Promise<DiagnosticSummary> => {
    const recent = await journal.readRecent(100);
    return DiagnosticSummarySchema.parse({
      generatedAt: clock().toISOString(),
      previousRunAbnormal,
      journal: {
        storedEvents: recent.storedEvents,
        invalidRecords: recent.invalidRecords
      },
      recentEvents: recent.events
    });
  };

  const getResources = async (): Promise<DiagnosticResources> => {
    const { metrics, cpuIsCurrent } = readMetrics();
    const workingSetKilobytes = metrics.reduce(
      (total, metric) => total + boundedNumber(
        metric.memory.workingSetSize,
        1_073_741_824
      ),
      0
    );
    const cpuPercent = metrics.reduce(
      (total, metric) => total + boundedNumber(
        metric.cpu.percentCPUUsage,
        100_000
      ),
      0
    );
    return DiagnosticResourcesSchema.parse({
      sampledAt: clock().toISOString(),
      lumora: {
        processCount: metrics.length,
        workingSetBytes: Math.min(
          1_099_511_627_776,
          Math.round(workingSetKilobytes * 1_024)
        ),
        cpuPercent: cpuIsCurrent ? Math.min(100_000, cpuPercent) : null
      },
      agents: {
        activeCount: Math.floor(
          boundedNumber(getActiveAgentCount(), 1_000_000_000)
        )
      }
    });
  };

  const sampleTree = async (rootPid: number) => {
    if (sampleProcessTree === undefined) return null;
    try {
      return await sampleProcessTree(rootPid);
    } catch {
      return null;
    }
  };

  const getProcessDetails = async (): Promise<DiagnosticProcessDetails> => {
    const electron = readMetrics();
    const agents = listAgentProcesses();
    const lumoraTree = await sampleTree(mainProcessId);
    const processes = lumoraTree === null ? null : [...lumoraTree.processes];
    let truncated = lumoraTree?.truncated ?? false;
    if (processes !== null) {
      // An agent whose process is not under Lumora's is read on its own.
      const listed = new Set(processes.map((entry) => entry.pid));
      for (const agent of agents) {
        if (agent.processId === null || listed.has(agent.processId)) continue;
        const tree = await sampleTree(agent.processId);
        for (const entry of tree?.processes ?? []) {
          if (listed.has(entry.pid)) continue;
          listed.add(entry.pid);
          processes.push(entry);
        }
        truncated ||= tree?.truncated ?? false;
      }
    }
    return DiagnosticProcessDetailsSchema.parse(buildProcessDetails({
      sampledAt: clock().toISOString(),
      mainProcessId,
      electron,
      processes,
      truncated,
      cpuPercent: trackProcessCpu(processes ?? []),
      agents
    }));
  };

  return Object.freeze({
    getSummary,
    getResources,
    getProcessDetails,
    async exportBundle() {
      const generatedAt = clock().toISOString();
      const suggestedName = `Lumora-diagnostics-${generatedAt.slice(0, 10)}.json`;
      let initialDirectory: string;
      try {
        initialDirectory = await getExportDirectory();
      } catch {
        initialDirectory = getFallbackExportDirectory();
      }
      const path = await chooseExportPath(suggestedName, initialDirectory);
      if (path === null) {
        return DiagnosticExportResultSchema.parse({ status: 'cancelled' });
      }
      const bundle = DiagnosticBundleSchema.parse({
        schemaVersion: 2,
        generatedAt,
        lumora: { version: appVersion, platform, architecture },
        summary: await getSummary(),
        resources: await getResources()
      });
      await writeFile(path, `${JSON.stringify(bundle, null, 2)}\n`);
      await rememberExportDirectory(
        (platform === 'win32' ? win32 : posix).dirname(path)
      );
      return DiagnosticExportResultSchema.parse({ status: 'saved' });
    },
    async record(input: DiagnosticRecordInput) {
      const id = createId();
      const event = DiagnosticEventSchema.parse({
        ...input,
        id,
        recordedAt: clock().toISOString(),
        correlationId: input.correlationId ?? id
      });
      await journal.record(event);
    }
  });
}
