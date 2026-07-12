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

const ProviderLaunchCommandSchema = z
  .string()
  .trim()
  .min(1)
  .max(4_096)
  .refine((command) => !/[\0\r\n]/.test(command), {
    message: 'Provider launch commands must use one line.'
  });

export const ProviderLaunchConfigSchema = z.strictObject({
  provider: ProviderIdSchema,
  command: ProviderLaunchCommandSchema.nullable()
});

export const ProviderLaunchConfigInputSchema = ProviderLaunchConfigSchema;
export const ProviderLaunchConfigListSchema = z
  .array(ProviderLaunchConfigSchema)
  .length(2);

export type ProviderLaunchConfig = z.infer<
  typeof ProviderLaunchConfigSchema
>;
export type ProviderLaunchConfigInput = z.infer<
  typeof ProviderLaunchConfigInputSchema
>;

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
export type WorkspaceOrigin = z.infer<typeof WorkspaceOriginSchema>;
export type SessionSummary = z.infer<typeof SessionSummarySchema>;
export type CatalogDiagnostic = z.infer<typeof CatalogDiagnosticSchema>;
export type CatalogProviderStatus = z.infer<
  typeof CatalogProviderStatusSchema
>;
export type CatalogSnapshot = z.infer<typeof CatalogSnapshotSchema>;
export type CatalogQuery = z.infer<typeof CatalogQuerySchema>;

export const ShellFamilySchema = z.enum([
  'pwsh',
  'powershell',
  'cmd',
  'zsh',
  'bash',
  'fish',
  'other'
]);
export const TerminalProfileKindSchema = z.enum(['detected', 'custom']);
export const TerminalProfileIdSchema = StableIdSchema;

const TerminalArgumentSchema = z.string().max(4_096);
const TerminalArgumentsSchema = z.array(TerminalArgumentSchema).max(16);

export const TerminalProfileSchema = z.strictObject({
  id: TerminalProfileIdSchema,
  kind: TerminalProfileKindSchema,
  name: z.string().trim().min(1).max(80),
  shellFamily: ShellFamilySchema,
  executablePath: z.string().min(1).max(32_768),
  args: TerminalArgumentsSchema,
  available: z.boolean(),
  recommended: z.boolean()
});

export const TerminalProfileListSchema = z.array(TerminalProfileSchema).max(64);

export const CustomTerminalProfileInputSchema = z.strictObject({
  name: z.string().trim().min(1).max(80),
  shellFamily: ShellFamilySchema,
  executablePath: z.string().trim().min(1).max(32_768),
  args: TerminalArgumentsSchema
});

export type ShellFamily = z.infer<typeof ShellFamilySchema>;
export type TerminalProfileKind = z.infer<typeof TerminalProfileKindSchema>;
export type TerminalProfile = z.infer<typeof TerminalProfileSchema>;
export type CustomTerminalProfileInput = z.infer<
  typeof CustomTerminalProfileInputSchema
>;

const TerminalDimensionsFields = {
  cols: z.number().int().min(20).max(500),
  rows: z.number().int().min(5).max(300)
};

const LaunchRequestBaseFields = {
  terminalProfileId: StableIdSchema,
  ...TerminalDimensionsFields
};

export const LaunchPrepareRequestSchema = z.discriminatedUnion('strategy', [
  z.strictObject({
    strategy: z.literal('new'),
    workspaceId: StableIdSchema,
    provider: ProviderIdSchema,
    ...LaunchRequestBaseFields
  }),
  z.strictObject({
    strategy: z.literal('resume'),
    sessionId: StableIdSchema,
    ...LaunchRequestBaseFields
  })
]);

export const LaunchPreviewSchema = z.strictObject({
  launchToken: z.uuid(),
  launchHash: StableIdSchema,
  strategy: z.enum(['new', 'resume']),
  sessionId: StableIdSchema.nullable(),
  provider: ProviderIdSchema,
  executablePath: z.string().min(1).max(32_768),
  args: z.array(TerminalArgumentSchema).max(64),
  command: ProviderLaunchConfigSchema.shape.command.default(null),
  workingDirectory: z.string().min(1).max(32_768),
  environmentNames: z.array(z.string().min(1).max(256)).max(256),
  terminalProfile: TerminalProfileSchema,
  warnings: z.array(z.string().trim().min(1).max(512)).max(10),
  createdAt: z.iso.datetime(),
  expiresAt: z.iso.datetime()
});

export type LaunchPrepareRequest = z.infer<typeof LaunchPrepareRequestSchema>;
export type LaunchPreview = z.infer<typeof LaunchPreviewSchema>;

export const RuntimeStateSchema = z.enum([
  'launching',
  'running',
  'completed',
  'failed',
  'runtime_lost',
  'launch_failed'
]);
export const RuntimeErrorCodeSchema = z.enum([
  'PTY_SPAWN_FAILED',
  'PTY_RUNTIME_FAILED',
  'PTY_RUNTIME_LOST'
]);
export const RuntimeStrategySchema = z.enum(['new', 'resume']);
export const RuntimeReconciliationStateSchema = z.enum([
  'not_required',
  'pending',
  'linked',
  'ambiguous',
  'unresolved'
]);
const RuntimeIdSchema = z.uuid();

export const RuntimeSummarySchema = z.strictObject({
  id: RuntimeIdSchema,
  strategy: RuntimeStrategySchema,
  sessionId: StableIdSchema.nullable(),
  nativeSessionId: z.string().trim().min(1).max(256).nullable(),
  reconciliationState: RuntimeReconciliationStateSchema,
  provider: ProviderIdSchema,
  workspaceId: StableIdSchema,
  terminalProfileId: StableIdSchema,
  launchHash: StableIdSchema,
  state: RuntimeStateSchema,
  pid: z.number().int().positive().nullable(),
  createdAt: z.iso.datetime(),
  startedAt: z.iso.datetime().nullable(),
  endedAt: z.iso.datetime().nullable(),
  exitCode: z.number().int().nullable(),
  errorCode: RuntimeErrorCodeSchema.nullable()
}).superRefine((runtime, context) => {
  if (runtime.sessionId !== null && runtime.nativeSessionId === null) {
    context.addIssue({
      code: 'custom',
      path: ['nativeSessionId'],
      message: 'A linked runtime requires its native session identity.'
    });
  }
  if (runtime.strategy === 'resume' && runtime.nativeSessionId === null) {
    context.addIssue({
      code: 'custom',
      path: ['nativeSessionId'],
      message: 'A resume runtime requires its native session identity.'
    });
  }
  if (
    runtime.strategy === 'resume' &&
    runtime.reconciliationState !== 'not_required'
  ) {
    context.addIssue({
      code: 'custom',
      path: ['reconciliationState'],
      message: 'A resume runtime does not require identity reconciliation.'
    });
  }
  if (
    runtime.strategy === 'new' &&
    runtime.reconciliationState === 'not_required'
  ) {
    context.addIssue({
      code: 'custom',
      path: ['reconciliationState'],
      message: 'A new runtime requires an explicit reconciliation result.'
    });
  }
  if (
    runtime.strategy === 'new' &&
    runtime.reconciliationState === 'linked' &&
    runtime.nativeSessionId === null
  ) {
    context.addIssue({
      code: 'custom',
      path: ['nativeSessionId'],
      message: 'A linked runtime requires its native session identity.'
    });
  }
  if (
    runtime.strategy === 'new' &&
    runtime.reconciliationState !== 'linked' &&
    (runtime.sessionId !== null || runtime.nativeSessionId !== null)
  ) {
    context.addIssue({
      code: 'custom',
      path: ['reconciliationState'],
      message: 'An unlinked new runtime cannot carry session identity.'
    });
  }
});

export const RuntimeListSchema = z.array(RuntimeSummarySchema).max(1_000);
export const RuntimeIdRequestSchema = z.strictObject({
  runtimeId: RuntimeIdSchema
});
export const RuntimeStartRequestSchema = z.strictObject({
  launchToken: z.uuid()
});
export const RuntimeWriteRequestSchema = z.strictObject({
  runtimeId: RuntimeIdSchema,
  data: z.string().min(1).max(65_536)
});
export const RuntimeResizeRequestSchema = z.strictObject({
  runtimeId: RuntimeIdSchema,
  ...TerminalDimensionsFields
});
export const RuntimeAttachmentSchema = z.strictObject({
  runtime: RuntimeSummarySchema,
  snapshot: z.string().max(1_048_576)
});
export const RuntimeCommandResultSchema = z.strictObject({
  accepted: z.literal(true)
});

export const RuntimeEventSchema = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('output'),
    runtimeId: RuntimeIdSchema,
    data: z.string().min(1).max(65_536)
  }),
  z.strictObject({
    type: z.literal('state'),
    runtimeId: RuntimeIdSchema,
    runtime: RuntimeSummarySchema
  })
]);

export type RuntimeState = z.infer<typeof RuntimeStateSchema>;
export type RuntimeReconciliationState = z.infer<
  typeof RuntimeReconciliationStateSchema
>;
export type RuntimeErrorCode = z.infer<typeof RuntimeErrorCodeSchema>;
export type RuntimeStrategy = z.infer<typeof RuntimeStrategySchema>;
export type RuntimeSummary = z.infer<typeof RuntimeSummarySchema>;
export type RuntimeIdRequest = z.infer<typeof RuntimeIdRequestSchema>;
export type RuntimeStartRequest = z.infer<typeof RuntimeStartRequestSchema>;
export type RuntimeWriteRequest = z.infer<typeof RuntimeWriteRequestSchema>;
export type RuntimeResizeRequest = z.infer<typeof RuntimeResizeRequestSchema>;
export type RuntimeAttachment = z.infer<typeof RuntimeAttachmentSchema>;
export type RuntimeEvent = z.infer<typeof RuntimeEventSchema>;

export const IPC_CHANNELS = {
  systemInfo: 'lumora:system:info',
  providerScan: 'lumora:providers:scan',
  catalogGet: 'lumora:catalog:get',
  catalogRefresh: 'lumora:catalog:refresh',
  workspaceChoose: 'lumora:workspace:choose',
  terminalProfilesGet: 'lumora:terminal:profiles:get',
  terminalProfileSave: 'lumora:terminal:profiles:save',
  terminalProfileDelete: 'lumora:terminal:profiles:delete',
  providerLaunchConfigsGet: 'lumora:terminal:provider-launch-configs:get',
  providerLaunchConfigSave: 'lumora:terminal:provider-launch-configs:save',
  launchPrepare: 'lumora:terminal:launch:prepare',
  runtimeStart: 'lumora:terminal:runtime:start',
  runtimeList: 'lumora:terminal:runtime:list',
  runtimeAttach: 'lumora:terminal:runtime:attach',
  runtimeWrite: 'lumora:terminal:runtime:write',
  runtimeResize: 'lumora:terminal:runtime:resize',
  runtimeTerminate: 'lumora:terminal:runtime:terminate',
  runtimeEvent: 'lumora:terminal:runtime:event'
} as const;

export interface LumoraApi {
  getSystemInfo(): Promise<SystemInfo>;
  scanProviders(): Promise<ProviderScanResult>;
  getCatalog(query?: CatalogQuery): Promise<CatalogSnapshot>;
  refreshCatalog(query?: CatalogQuery): Promise<CatalogSnapshot>;
  chooseWorkspace(): Promise<CatalogSnapshot | null>;
  getTerminalProfiles(): Promise<TerminalProfile[]>;
  saveTerminalProfile(
    input: CustomTerminalProfileInput
  ): Promise<TerminalProfile[]>;
  deleteTerminalProfile(profileId: string): Promise<TerminalProfile[]>;
  getProviderLaunchConfigs(): Promise<ProviderLaunchConfig[]>;
  saveProviderLaunchConfig(
    input: ProviderLaunchConfigInput
  ): Promise<ProviderLaunchConfig[]>;
  prepareLaunch(input: LaunchPrepareRequest): Promise<LaunchPreview>;
  startRuntime(launchToken: string): Promise<RuntimeSummary>;
  listRuntimes(): Promise<RuntimeSummary[]>;
  attachRuntime(runtimeId: string): Promise<RuntimeAttachment>;
  writeRuntime(input: RuntimeWriteRequest): Promise<void>;
  resizeRuntime(input: RuntimeResizeRequest): Promise<void>;
  terminateRuntime(runtimeId: string): Promise<RuntimeSummary>;
  onRuntimeEvent(listener: (event: RuntimeEvent) => void): () => void;
}
