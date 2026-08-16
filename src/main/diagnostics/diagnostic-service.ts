import { randomUUID } from 'node:crypto';
import { posix, win32 } from 'node:path';

import {
  DiagnosticBundleSchema,
  DiagnosticEventSchema,
  DiagnosticExportResultSchema,
  DiagnosticSummarySchema,
  type DiagnosticEvent,
  type DiagnosticExportResult,
  type DiagnosticSummary
} from '../../shared/diagnostics';
import type { SystemInfo } from '../../shared/contracts';

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

interface ProcessMetricLike {
  cpu: { percentCPUUsage: number };
  memory: { workingSetSize: number };
}

interface CreateDiagnosticServiceOptions {
  journal: DiagnosticJournalPort;
  previousRunAbnormal: boolean;
  appVersion: string;
  platform: SystemInfo['platform'];
  architecture: string;
  getActiveAgentCount(): number;
  getProcessMetrics(): readonly ProcessMetricLike[];
  getExportDirectory(): Promise<string>;
  getFallbackExportDirectory(): string;
  chooseExportPath(
    suggestedName: string,
    initialDirectory: string
  ): Promise<string | null>;
  rememberExportDirectory(directory: string): Promise<void>;
  writeFile(path: string, data: string): Promise<void>;
  clock?: () => Date;
  createId?: () => string;
}

export interface DiagnosticService {
  getSummary(): Promise<DiagnosticSummary>;
  exportBundle(): Promise<DiagnosticExportResult>;
  record(input: DiagnosticRecordInput): Promise<void>;
}

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
  getExportDirectory,
  getFallbackExportDirectory,
  chooseExportPath,
  rememberExportDirectory,
  writeFile,
  clock = () => new Date(),
  createId = randomUUID
}: CreateDiagnosticServiceOptions): DiagnosticService {
  const getSummary = async (): Promise<DiagnosticSummary> => {
    const recent = await journal.readRecent(100);
    const metrics = getProcessMetrics().slice(0, 1_024);
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
    return DiagnosticSummarySchema.parse({
      generatedAt: clock().toISOString(),
      previousRunAbnormal,
      journal: {
        storedEvents: recent.storedEvents,
        invalidRecords: recent.invalidRecords
      },
      agents: {
        activeCount: Math.floor(
          boundedNumber(getActiveAgentCount(), 1_000_000_000)
        )
      },
      processes: {
        processCount: metrics.length,
        workingSetBytes: Math.min(
          1_099_511_627_776,
          Math.round(workingSetKilobytes * 1_024)
        ),
        cpuPercent: Math.min(100_000, cpuPercent)
      },
      recentEvents: recent.events
    });
  };

  return Object.freeze({
    getSummary,
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
        schemaVersion: 1,
        generatedAt,
        lumora: { version: appVersion, platform, architecture },
        summary: await getSummary()
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
