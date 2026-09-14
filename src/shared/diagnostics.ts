import { z } from 'zod';

const SAFE_IDENTIFIER = /^[a-z][a-z0-9.-]{0,63}$/;
const SAFE_CODE = /^[A-Z][A-Z0-9_]{0,63}$/;
const SAFE_PROVIDER = /^[a-z][a-z0-9-]{0,31}$/;
const MAX_COUNT = 1_000_000_000;

export const DiagnosticSeveritySchema = z.enum([
  'info',
  'warning',
  'error'
]);

export const DiagnosticSubsystemSchema = z.enum([
  'application',
  'startup',
  'environment',
  'provider',
  'catalog',
  'terminal',
  'remote',
  'helper',
  'transfer',
  'ipc',
  'renderer'
]);

export const DiagnosticOutcomeSchema = z.enum([
  'started',
  'succeeded',
  'failed',
  'cancelled',
  'ignored'
]);

export const DiagnosticCountsSchema = z.strictObject({
  active: z.number().int().min(0).max(MAX_COUNT).optional(),
  queued: z.number().int().min(0).max(MAX_COUNT).optional(),
  discovered: z.number().int().min(0).max(MAX_COUNT).optional(),
  unchanged: z.number().int().min(0).max(MAX_COUNT).optional(),
  invalid: z.number().int().min(0).max(MAX_COUNT).optional(),
  cacheHits: z.number().int().min(0).max(MAX_COUNT).optional(),
  ready: z.number().int().min(0).max(MAX_COUNT).optional(),
  notFound: z.number().int().min(0).max(MAX_COUNT).optional(),
  probeFailed: z.number().int().min(0).max(MAX_COUNT).optional()
});

export const DiagnosticEventSchema = z.strictObject({
  id: z.uuid(),
  recordedAt: z.iso.datetime(),
  severity: DiagnosticSeveritySchema,
  subsystem: DiagnosticSubsystemSchema,
  operation: z.string().regex(SAFE_IDENTIFIER),
  outcome: DiagnosticOutcomeSchema,
  correlationId: z.uuid(),
  provider: z.string().regex(SAFE_PROVIDER).optional(),
  targetKind: z.enum(['local', 'remote']),
  code: z.string().regex(SAFE_CODE).optional(),
  durationMs: z.number().int().min(0).max(86_400_000).optional(),
  counts: DiagnosticCountsSchema.optional()
});

export type DiagnosticEvent = z.infer<typeof DiagnosticEventSchema>;

export const DiagnosticSummarySchema = z.strictObject({
  generatedAt: z.iso.datetime(),
  previousRunAbnormal: z.boolean(),
  journal: z.strictObject({
    storedEvents: z.number().int().min(0).max(MAX_COUNT),
    invalidRecords: z.number().int().min(0).max(MAX_COUNT)
  }),
  recentEvents: z.array(DiagnosticEventSchema).max(100)
});

export type DiagnosticSummary = z.infer<typeof DiagnosticSummarySchema>;

export const DiagnosticProcessUsageSchema = z.strictObject({
  processCount: z.number().int().min(0).max(1_024),
  workingSetBytes: z.number().int().min(0).max(1_099_511_627_776),
  /** Null when there is no recent earlier sample to measure CPU use against. */
  cpuPercent: z.number().min(0).max(100_000).nullable()
});

export type DiagnosticProcessUsage = z.infer<typeof DiagnosticProcessUsageSchema>;

/** Resource use sampled on demand, kept apart from the journal so it is cheap to poll. */
export const DiagnosticResourcesSchema = z.strictObject({
  sampledAt: z.iso.datetime(),
  lumora: DiagnosticProcessUsageSchema,
  agents: z.strictObject({
    activeCount: z.number().int().min(0).max(MAX_COUNT)
  })
});

export type DiagnosticResources = z.infer<typeof DiagnosticResourcesSchema>;

export const DIAGNOSTIC_MAX_PROCESSES = 512;
export const DIAGNOSTIC_MAX_AGENTS = 64;
const MAX_PROCESS_ID = 2_147_483_647;

/** One process in a detailed listing, placed under the process that started it. */
export const DiagnosticProcessSchema = z.strictObject({
  pid: z.number().int().min(0).max(MAX_PROCESS_ID),
  depth: z.number().int().min(0).max(DIAGNOSTIC_MAX_PROCESSES),
  /** Electron's role for its own processes; `process` for anything else. */
  kind: z.enum(['main', 'renderer', 'gpu', 'utility', 'process']),
  /** An executable or Electron service name; never a command line. */
  name: z.string().max(128),
  workingSetBytes: z.number().int().min(0).max(1_099_511_627_776).nullable(),
  cpuPercent: z.number().min(0).max(100_000).nullable()
});

export type DiagnosticProcess = z.infer<typeof DiagnosticProcessSchema>;

export const DiagnosticAgentProcessesSchema = z.strictObject({
  id: z.string().min(1).max(128),
  provider: z.string().regex(SAFE_PROVIDER),
  surface: z.enum(['terminal', 'unified']),
  title: z.string().max(256),
  /**
   * `measured` lists the agent's processes; `starting` has no process yet;
   * `unavailable` means Lumora could not read them.
   */
  status: z.enum(['measured', 'starting', 'unavailable']),
  processes: z.array(DiagnosticProcessSchema).max(DIAGNOSTIC_MAX_PROCESSES)
});

export type DiagnosticAgentProcesses = z.infer<typeof DiagnosticAgentProcessesSchema>;

/**
 * Every Lumora process and every running agent's processes. Shown locally
 * only: titles and process names never go into an export.
 */
export const DiagnosticProcessDetailsSchema = z.strictObject({
  sampledAt: z.iso.datetime(),
  /** False when only Electron's own processes could be read. */
  processTreeAvailable: z.boolean(),
  truncated: z.boolean(),
  lumora: z.array(DiagnosticProcessSchema).max(DIAGNOSTIC_MAX_PROCESSES),
  agents: z.array(DiagnosticAgentProcessesSchema).max(DIAGNOSTIC_MAX_AGENTS)
});

export type DiagnosticProcessDetails = z.infer<typeof DiagnosticProcessDetailsSchema>;

export const DiagnosticBundleSchema = z.strictObject({
  schemaVersion: z.literal(2),
  generatedAt: z.iso.datetime(),
  lumora: z.strictObject({
    version: z.string().min(1).max(64),
    platform: z.enum(['win32', 'darwin', 'linux']),
    architecture: z.string().min(1).max(32)
  }),
  summary: DiagnosticSummarySchema,
  resources: DiagnosticResourcesSchema
});

export type DiagnosticBundle = z.infer<typeof DiagnosticBundleSchema>;

export const DiagnosticExportResultSchema = z.discriminatedUnion('status', [
  z.strictObject({ status: z.literal('saved') }),
  z.strictObject({ status: z.literal('cancelled') })
]);

export type DiagnosticExportResult = z.infer<
  typeof DiagnosticExportResultSchema
>;

const DiagnosticDirectorySchema = z.string().min(1).max(32_768);

export const DiagnosticStorageSettingsSchema = z.strictObject({
  selectedJournalDirectory: DiagnosticDirectorySchema.nullable(),
  effectiveJournalDirectory: DiagnosticDirectorySchema,
  selectedExportDirectory: DiagnosticDirectorySchema.nullable(),
  effectiveExportDirectory: DiagnosticDirectorySchema,
  journalUsesDefault: z.boolean(),
  exportUsesDefault: z.boolean(),
  restartRequired: z.boolean(),
  fallbackActive: z.boolean()
});

export type DiagnosticStorageSettings = z.infer<
  typeof DiagnosticStorageSettingsSchema
>;
