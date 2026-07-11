import { z } from 'zod';

export const PlatformSchema = z.enum(['win32', 'darwin', 'linux']);

export const SystemInfoSchema = z.strictObject({
  platform: PlatformSchema,
  arch: z.string().min(1),
  appVersion: z.string().min(1)
});

export type SystemInfo = z.infer<typeof SystemInfoSchema>;

export const ProviderIdSchema = z.enum(['codex', 'claude']);
export const ProviderStateSchema = z.enum([
  'ready',
  'not_found',
  'probe_failed'
]);

const issueFields = {
  message: z.string().min(1),
  recovery: z.string().min(1),
  retryable: z.boolean()
};

const NotFoundIssueSchema = z.strictObject({
  code: z.literal('PROVIDER_NOT_FOUND'),
  ...issueFields
});

const ProbeFailedIssueSchema = z.strictObject({
  code: z.enum([
    'PROVIDER_VERSION_PROBE_FAILED',
    'PROVIDER_SCAN_FAILED'
  ]),
  ...issueFields
});

export const ProviderIssueSchema = z.union([
  NotFoundIssueSchema,
  ProbeFailedIssueSchema
]);

const providerFields = {
  provider: ProviderIdSchema,
  displayName: z.string().min(1)
};

export const ProviderInstallationSchema = z.discriminatedUnion('state', [
  z.strictObject({
    ...providerFields,
    state: z.literal('ready'),
    executablePath: z.string().min(1),
    version: z.string().min(1),
    issue: z.null()
  }),
  z.strictObject({
    ...providerFields,
    state: z.literal('not_found'),
    executablePath: z.null(),
    version: z.null(),
    issue: NotFoundIssueSchema
  }),
  z.strictObject({
    ...providerFields,
    state: z.literal('probe_failed'),
    executablePath: z.string().min(1).nullable(),
    version: z.null(),
    issue: ProbeFailedIssueSchema
  })
]);

export const ProviderScanResultSchema = z.strictObject({
  scannedAt: z.iso.datetime(),
  providers: z.array(ProviderInstallationSchema).length(2)
});

export type ProviderId = z.infer<typeof ProviderIdSchema>;
export type ProviderInstallation = z.infer<
  typeof ProviderInstallationSchema
>;
export type ProviderScanResult = z.infer<typeof ProviderScanResultSchema>;

const StableIdSchema = z.string().regex(/^[a-f0-9]{64}$/);

export const WorkspaceOriginSchema = z.enum(['manual', 'discovered']);
export const SessionLifecycleSchema = z.enum([
  'discovered',
  'saved',
  'launching',
  'running',
  'waiting',
  'completed',
  'failed',
  'runtime_lost',
  'launch_failed'
]);
export const SessionSourceFreshnessSchema = z.enum(['current', 'stale']);

export const ProviderCountsSchema = z.strictObject({
  codex: z.number().int().nonnegative(),
  claude: z.number().int().nonnegative()
});

export const WorkspaceSummarySchema = z.strictObject({
  id: StableIdSchema,
  displayName: z.string().trim().min(1).max(256),
  canonicalPath: z.string().min(1).max(32_768),
  available: z.boolean(),
  origin: WorkspaceOriginSchema,
  sessionCount: z.number().int().nonnegative(),
  providerCounts: ProviderCountsSchema,
  lastActivityAt: z.iso.datetime().nullable()
});

export const SessionSummarySchema = z.strictObject({
  id: StableIdSchema,
  nativeId: z.string().trim().min(1).max(256),
  provider: ProviderIdSchema,
  workspaceId: StableIdSchema,
  title: z.string().trim().min(1).max(256),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  lifecycle: SessionLifecycleSchema,
  sourceFreshness: SessionSourceFreshnessSchema
});

export const CatalogDiagnosticCodeSchema = z.enum([
  'CATALOG_PROVIDER_UNAVAILABLE',
  'CATALOG_PROTOCOL_FAILED',
  'CATALOG_SOURCE_UNAVAILABLE',
  'CATALOG_SOURCE_INVALID',
  'CATALOG_DATABASE_FAILED'
]);

export const CatalogDiagnosticSchema = z.strictObject({
  code: CatalogDiagnosticCodeSchema,
  provider: ProviderIdSchema.nullable(),
  affectedCount: z.number().int().nonnegative(),
  message: z.string().trim().min(1).max(512),
  recovery: z.string().trim().min(1).max(512),
  retryable: z.boolean(),
  scannedAt: z.iso.datetime()
});

export const CatalogProviderStateSchema = z.enum([
  'ready',
  'unavailable',
  'failed'
]);

export const CatalogProviderStatusSchema = z.strictObject({
  provider: ProviderIdSchema,
  state: CatalogProviderStateSchema,
  discoveredCount: z.number().int().nonnegative(),
  unchangedCount: z.number().int().nonnegative(),
  invalidCount: z.number().int().nonnegative()
});

export const CatalogSnapshotSchema = z.strictObject({
  refreshedAt: z.iso.datetime(),
  workspaces: z.array(WorkspaceSummarySchema).max(25_000),
  sessions: z.array(SessionSummarySchema).max(25_000),
  providerStatus: z.array(CatalogProviderStatusSchema).length(2),
  diagnostics: z.array(CatalogDiagnosticSchema).max(100)
});

export const CatalogQuerySchema = z.strictObject({
  text: z.string().trim().max(120),
  provider: ProviderIdSchema.nullable()
});

export type WorkspaceSummary = z.infer<typeof WorkspaceSummarySchema>;
export type SessionSummary = z.infer<typeof SessionSummarySchema>;
export type CatalogDiagnostic = z.infer<typeof CatalogDiagnosticSchema>;
export type CatalogProviderStatus = z.infer<
  typeof CatalogProviderStatusSchema
>;
export type CatalogSnapshot = z.infer<typeof CatalogSnapshotSchema>;
export type CatalogQuery = z.infer<typeof CatalogQuerySchema>;

export const IPC_CHANNELS = {
  systemInfo: 'lumora:system:info',
  providerScan: 'lumora:providers:scan',
  catalogGet: 'lumora:catalog:get',
  catalogRefresh: 'lumora:catalog:refresh',
  workspaceChoose: 'lumora:workspace:choose'
} as const;

export interface LumoraApi {
  getSystemInfo(): Promise<SystemInfo>;
  scanProviders(): Promise<ProviderScanResult>;
  getCatalog(query?: CatalogQuery): Promise<CatalogSnapshot>;
  refreshCatalog(query?: CatalogQuery): Promise<CatalogSnapshot>;
  chooseWorkspace(): Promise<CatalogSnapshot | null>;
}
