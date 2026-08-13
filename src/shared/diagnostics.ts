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
  cacheHits: z.number().int().min(0).max(MAX_COUNT).optional()
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
  processes: z.strictObject({
    processCount: z.number().int().min(0).max(1_024),
    workingSetBytes: z.number().int().min(0).max(1_099_511_627_776),
    cpuPercent: z.number().min(0).max(100_000)
  }),
  recentEvents: z.array(DiagnosticEventSchema).max(100)
});

export type DiagnosticSummary = z.infer<typeof DiagnosticSummarySchema>;

export const DiagnosticBundleSchema = z.strictObject({
  schemaVersion: z.literal(1),
  generatedAt: z.iso.datetime(),
  lumora: z.strictObject({
    version: z.string().min(1).max(64),
    platform: z.enum(['win32', 'darwin', 'linux']),
    architecture: z.string().min(1).max(32)
  }),
  summary: DiagnosticSummarySchema
});

export type DiagnosticBundle = z.infer<typeof DiagnosticBundleSchema>;

export const DiagnosticExportResultSchema = z.discriminatedUnion('status', [
  z.strictObject({ status: z.literal('saved') }),
  z.strictObject({ status: z.literal('cancelled') })
]);

export type DiagnosticExportResult = z.infer<
  typeof DiagnosticExportResultSchema
>;

