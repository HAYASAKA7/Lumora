import { z } from 'zod';

import type {
  SessionExportExecuteRequest,
  SessionExportPlan,
  SessionExportPrepareRequest,
  SessionImportExecuteRequest,
  SessionImportInspectRequest,
  SessionImportInspection,
  SessionImportPlan,
  SessionImportPlanRequest,
  SessionTransferArchiveSelection,
  SessionTransferCapability,
  SessionTransferProgressEvent,
  SessionTransferResult,
  TransferHistoryEntry
} from './session-transfer';
export * from './session-transfer';

export const PlatformSchema = z.enum(['win32', 'darwin', 'linux']);

export const LOCAL_EXECUTION_TARGET_ID = 'local' as const;
export const RemoteExecutionTargetIdSchema = z.uuid();
export const ExecutionTargetIdSchema = z.union([
  z.literal(LOCAL_EXECUTION_TARGET_ID),
  RemoteExecutionTargetIdSchema
]);
export const ExecutionTargetPlatformSchema = z.union([
  PlatformSchema,
  z.literal('unknown')
]);
export const ExecutionTargetArchitectureSchema = z.enum([
  'x64',
  'arm64',
  'unknown'
]);
export const ExecutionTargetCapabilitySchema = z.enum([
  'provider-scan',
  'provider-lifecycle',
  'session-scan',
  'pty',
  'persistent-runtime'
]);

export const ExecutionTargetSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    id: z.literal(LOCAL_EXECUTION_TARGET_ID),
    kind: z.literal('local'),
    displayName: z.string().trim().min(1).max(120),
    platform: PlatformSchema,
    architecture: z.string().trim().min(1).max(32),
    connectionState: z.literal('local'),
    helperVersion: z.null(),
    protocolVersion: z.null(),
    capabilities: z.array(ExecutionTargetCapabilitySchema).max(5),
    lastConnectedAt: z.null(),
    lastScannedAt: z.iso.datetime().nullable()
  }),
  z.strictObject({
    id: RemoteExecutionTargetIdSchema,
    kind: z.literal('remote'),
    displayName: z.string().trim().min(1).max(120),
    platform: ExecutionTargetPlatformSchema,
    architecture: ExecutionTargetArchitectureSchema,
    connectionState: z.enum([
      'offline',
      'connecting',
      'authenticating',
      'helper-missing',
      'helper-incompatible',
      'ready',
      'reconnecting',
      'error'
    ]),
    helperVersion: z.string().trim().min(1).max(64).nullable(),
    protocolVersion: z.number().int().nonnegative().nullable(),
    capabilities: z.array(ExecutionTargetCapabilitySchema).max(5),
    lastConnectedAt: z.iso.datetime().nullable(),
    lastScannedAt: z.iso.datetime().nullable()
  })
]);

export const LumoraWindowContextSchema = z.discriminatedUnion('mode', [
  z.strictObject({
    mode: z.literal('local'),
    executionTargetId: z.literal(LOCAL_EXECUTION_TARGET_ID)
  }),
  z.strictObject({
    mode: z.literal('remote'),
    executionTargetId: RemoteExecutionTargetIdSchema
  })
]);

export const RemoteAuthenticationProfileSchema = z.discriminatedUnion('method', [
  z.strictObject({ method: z.literal('password') }),
  z.strictObject({
    method: z.literal('private-key'),
    privateKeyPath: z.string().trim().min(1).max(4096)
  }),
  z.strictObject({ method: z.literal('agent') })
]);

const RemoteProfileDisplayNameSchema = z.string().trim().min(1).max(120);
const RemoteProfileHostSchema = z.string().trim().min(1).max(253);
const RemoteProfileUsernameSchema = z.string().trim().min(1).max(128);
const SshConfigHostSchema = z.string().trim().min(1).max(253).regex(/^\S+$/);

export const RemoteConnectionProfileInputSchema = z.discriminatedUnion('route', [
  z.strictObject({
    displayName: RemoteProfileDisplayNameSchema,
    route: z.literal('direct'),
    host: RemoteProfileHostSchema,
    port: z.number().int().min(1).max(65535),
    username: RemoteProfileUsernameSchema,
    authentication: RemoteAuthenticationProfileSchema
  }),
  z.strictObject({
    displayName: RemoteProfileDisplayNameSchema,
    route: z.literal('ssh-config'),
    sshConfigHost: SshConfigHostSchema,
    authentication: RemoteAuthenticationProfileSchema
  })
]);

export const SshHostFingerprintSchema = z.string().regex(
  /^SHA256:[A-Za-z0-9+/]{43}$/
);

export const RemoteConnectionProfileSchema = z.strictObject({
  executionTargetId: RemoteExecutionTargetIdSchema,
  displayName: RemoteProfileDisplayNameSchema,
  route: z.enum(['direct', 'ssh-config']),
  host: RemoteProfileHostSchema.nullable(),
  port: z.number().int().min(1).max(65535).nullable(),
  username: RemoteProfileUsernameSchema.nullable(),
  sshConfigHost: SshConfigHostSchema.nullable(),
  authentication: RemoteAuthenticationProfileSchema,
  verifiedHostFingerprint: SshHostFingerprintSchema.nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime()
}).superRefine((profile, context) => {
  const direct = profile.route === 'direct';
  const directFieldsPresent =
    profile.host !== null && profile.port !== null && profile.username !== null;
  if (direct !== directFieldsPresent || direct === (profile.sshConfigHost !== null)) {
    context.addIssue({
      code: 'custom',
      message: 'Remote profile route fields are inconsistent.'
    });
  }
});

export const RemoteTargetCredentialsSchema = z.discriminatedUnion('method', [
  z.strictObject({
    method: z.literal('password'),
    password: z.string().min(1).max(4096)
  }),
  z.strictObject({
    method: z.literal('private-key'),
    passphrase: z.string().max(4096).nullable()
  }),
  z.strictObject({ method: z.literal('agent') })
]);

export const RemoteTargetConnectRequestSchema = z.discriminatedUnion('mode', [
  z.strictObject({
    executionTargetId: RemoteExecutionTargetIdSchema,
    mode: z.literal('manual'),
    credentials: RemoteTargetCredentialsSchema,
    rememberCredential: z.boolean()
  }),
  z.strictObject({
    executionTargetId: RemoteExecutionTargetIdSchema,
    mode: z.literal('automatic')
  }),
  z.strictObject({
    executionTargetId: RemoteExecutionTargetIdSchema,
    mode: z.literal('remembered')
  })
]);

export const RemoteCredentialStatusSchema = z.strictObject({
  executionTargetId: RemoteExecutionTargetIdSchema,
  storageState: z.enum([
    'available',
    'unavailable',
    'temporarily-unavailable'
  ]),
  credentialState: z.enum(['none', 'remembered', 'needs-attention']),
  autoConnect: z.boolean()
});

export const RemoteAutoConnectPreferenceRequestSchema = z.strictObject({
  executionTargetId: RemoteExecutionTargetIdSchema,
  autoConnect: z.boolean()
});

export const RemoteExecutionTargetSchema = z.strictObject({
  id: RemoteExecutionTargetIdSchema,
  kind: z.literal('remote'),
  displayName: z.string().trim().min(1).max(120),
  platform: ExecutionTargetPlatformSchema,
  architecture: ExecutionTargetArchitectureSchema,
  connectionState: z.enum([
    'offline', 'connecting', 'authenticating', 'helper-missing',
    'helper-incompatible', 'ready', 'reconnecting', 'error'
  ]),
  helperVersion: z.string().trim().min(1).max(64).nullable(),
  protocolVersion: z.number().int().nonnegative().nullable(),
  capabilities: z.array(ExecutionTargetCapabilitySchema).max(4),
  lastConnectedAt: z.iso.datetime().nullable(),
  lastScannedAt: z.iso.datetime().nullable()
});

export const RemoteTargetSummarySchema = z.strictObject({
  target: RemoteExecutionTargetSchema,
  profile: RemoteConnectionProfileSchema
}).superRefine((summary, context) => {
  if (summary.target.id !== summary.profile.executionTargetId) {
    context.addIssue({
      code: 'custom',
      message: 'Remote target and profile identifiers do not match.'
    });
  }
});
export const RemoteTargetListSchema = z.array(RemoteTargetSummarySchema);
export const RemoteTargetIdRequestSchema = z.strictObject({
  executionTargetId: RemoteExecutionTargetIdSchema
});
export const RemoteTargetUpdateRequestSchema = z.strictObject({
  executionTargetId: RemoteExecutionTargetIdSchema,
  profile: RemoteConnectionProfileInputSchema
});
export const RemoteHostKeyObservationSchema = z.strictObject({
  executionTargetId: RemoteExecutionTargetIdSchema,
  fingerprint: SshHostFingerprintSchema
});
export const RemoteHostTrustRequestSchema = RemoteHostKeyObservationSchema;
export const RemoteTargetConnectionDetailsSchema = z.strictObject({
  target: RemoteExecutionTargetSchema,
  profile: RemoteConnectionProfileSchema,
  homeDirectory: z.string().trim().min(1).max(4096),
  defaultShell: z.string().trim().min(1).max(4096)
});
export const RemoteHelperInstallDetailsSchema = z.strictObject({
  status: z.enum(['missing', 'invalid']),
  helperVersion: z.string().trim().min(1).max(64),
  installLocation: z.string().trim().min(1).max(4096),
  requiresConfirmation: z.literal(true)
});
export const RemoteTargetRemovalResultSchema = z.strictObject({
  removed: z.literal(true)
});
export const RemoteTargetWindowOpenResultSchema = z.strictObject({
  opened: z.literal(true),
  executionTargetId: RemoteExecutionTargetIdSchema
});

export type RemoteExecutionTargetId = z.infer<
  typeof RemoteExecutionTargetIdSchema
>;
export type ExecutionTargetId = z.infer<typeof ExecutionTargetIdSchema>;
export type ExecutionTarget = z.infer<typeof ExecutionTargetSchema>;
export type LumoraWindowContext = z.infer<typeof LumoraWindowContextSchema>;
export type RemoteAuthenticationProfile = z.infer<
  typeof RemoteAuthenticationProfileSchema
>;
export type RemoteConnectionProfileInput = z.infer<
  typeof RemoteConnectionProfileInputSchema
>;
export type RemoteConnectionProfile = z.infer<
  typeof RemoteConnectionProfileSchema
>;
export type RemoteTargetCredentials = z.infer<
  typeof RemoteTargetCredentialsSchema
>;
export type RemoteTargetConnectRequest = z.infer<
  typeof RemoteTargetConnectRequestSchema
>;
export type RemoteCredentialStatus = z.infer<
  typeof RemoteCredentialStatusSchema
>;
export type RemoteAutoConnectPreferenceRequest = z.infer<
  typeof RemoteAutoConnectPreferenceRequestSchema
>;
export type RemoteExecutionTarget = z.infer<typeof RemoteExecutionTargetSchema>;
export type RemoteTargetSummary = z.infer<typeof RemoteTargetSummarySchema>;
export type RemoteTargetUpdateRequest = z.infer<
  typeof RemoteTargetUpdateRequestSchema
>;
export type RemoteHostKeyObservation = z.infer<
  typeof RemoteHostKeyObservationSchema
>;
export type RemoteTargetConnectionDetails = z.infer<
  typeof RemoteTargetConnectionDetailsSchema
>;
export type RemoteHelperInstallDetails = z.infer<
  typeof RemoteHelperInstallDetailsSchema
>;

export const SystemInfoSchema = z.strictObject({
  platform: PlatformSchema,
  arch: z.string().min(1),
  appVersion: z.string().min(1)
});

export type SystemInfo = z.infer<typeof SystemInfoSchema>;

export const DeveloperToolStatusSchema = z.discriminatedUnion('state', [
  z.strictObject({
    state: z.literal('ready'),
    executablePath: z.string().min(1),
    version: z.string().min(1)
  }),
  z.strictObject({
    state: z.literal('not_found'),
    executablePath: z.null(),
    version: z.null()
  }),
  z.strictObject({
    state: z.literal('probe_failed'),
    executablePath: z.string().min(1),
    version: z.null()
  })
]);

export const DeveloperEnvironmentScanResultSchema = z.strictObject({
  checkedAt: z.iso.datetime(),
  node: DeveloperToolStatusSchema,
  npm: DeveloperToolStatusSchema
});

export const ExternalOpenResultSchema = z.strictObject({
  opened: z.literal(true)
});

const ExternalHttpUrlSchema = z
  .string()
  .min(1)
  .max(2_048)
  .transform((value, context) => {
    let parsed: URL;
    try {
      parsed = new URL(value);
    } catch {
      context.addIssue({
        code: 'custom',
        message: 'The external link must be an absolute URL.'
      });
      return z.NEVER;
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      context.addIssue({
        code: 'custom',
        message: 'Only HTTP(S) external links are allowed.'
      });
      return z.NEVER;
    }
    if (parsed.username.length > 0 || parsed.password.length > 0) {
      context.addIssue({
        code: 'custom',
        message: 'External links cannot contain credentials.'
      });
      return z.NEVER;
    }
    return parsed.href;
  });

export const TerminalLinkOpenRequestSchema = z.strictObject({
  url: ExternalHttpUrlSchema
});

export type DeveloperToolStatus = z.infer<typeof DeveloperToolStatusSchema>;
export type DeveloperEnvironmentScanResult = z.infer<
  typeof DeveloperEnvironmentScanResultSchema
>;

export const PROVIDER_IDS = [
  'codex',
  'claude',
  'gemini',
  'antigravity',
  'opencode',
  'cursor',
  'copilot',
  'qwen',
  'amp',
  'crush',
  'goose',
  'aider'
] as const;
export const ProviderIdSchema = z.enum(PROVIDER_IDS);
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
  providers: z.array(ProviderInstallationSchema).max(PROVIDER_IDS.length)
});

const ProviderUpdateComparableFields = {
  ...providerFields,
  installedVersion: z.string().min(1),
  latestVersion: z.string().min(1),
  issue: z.null()
};

const ProviderUpdateIssueSchema = z.strictObject({
  code: z.enum([
    'PROVIDER_NOT_READY',
    'PROVIDER_VERSION_INVALID',
    'PROVIDER_RELEASE_UNAVAILABLE'
  ]),
  ...issueFields
});

export const ProviderUpdateStatusSchema = z.discriminatedUnion('state', [
  z.strictObject({
    ...ProviderUpdateComparableFields,
    state: z.literal('up_to_date')
  }),
  z.strictObject({
    ...ProviderUpdateComparableFields,
    state: z.literal('update_available')
  }),
  z.strictObject({
    ...providerFields,
    state: z.literal('unavailable'),
    installedVersion: z.string().min(1).nullable(),
    latestVersion: z.string().min(1).nullable(),
    issue: ProviderUpdateIssueSchema
  })
]);

export const ProviderUpdateCheckResultSchema = z.strictObject({
  checkedAt: z.iso.datetime(),
  providers: z.array(ProviderUpdateStatusSchema).max(PROVIDER_IDS.length)
});

export const ProviderUpdateRequestSchema = z.strictObject({
  provider: ProviderIdSchema
});

export const ProviderUpdateResultSchema = z.strictObject({
  provider: ProviderIdSchema,
  completedAt: z.iso.datetime(),
  installation: ProviderInstallationSchema
});

export type ProviderId = z.infer<typeof ProviderIdSchema>;
export type ProviderInstallation = z.infer<
  typeof ProviderInstallationSchema
>;
export type ProviderScanResult = z.infer<typeof ProviderScanResultSchema>;
export type ProviderUpdateStatus = z.infer<
  typeof ProviderUpdateStatusSchema
>;
export type ProviderUpdateCheckResult = z.infer<
  typeof ProviderUpdateCheckResultSchema
>;
export type ProviderUpdateRequest = z.infer<
  typeof ProviderUpdateRequestSchema
>;
export type ProviderUpdateResult = z.infer<typeof ProviderUpdateResultSchema>;

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
  .max(PROVIDER_IDS.length);

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
export const LifetimeTokenCountSchema = z
  .number()
  .int()
  .nonnegative()
  .max(Number.MAX_SAFE_INTEGER);

export const ProviderCountsSchema = z.partialRecord(
  ProviderIdSchema,
  z.number().int().nonnegative()
);

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

export const WorkspaceTrustDecisionSchema = z.strictObject({
  workspaceId: StableIdSchema,
  canonicalPath: WorkspaceSummarySchema.shape.canonicalPath,
  trustedAt: z.iso.datetime()
});

export const WorkspaceTrustDecisionListSchema = z
  .array(WorkspaceTrustDecisionSchema)
  .max(50_000);

export const WorkspaceTrustGrantRequestSchema = z.strictObject({
  launchToken: z.uuid()
});

export const WorkspaceTrustRevokeRequestSchema = z.strictObject({
  workspaceId: StableIdSchema
});

export const SessionSummarySchema = z.strictObject({
  id: StableIdSchema,
  nativeId: z.string().trim().min(1).max(256),
  provider: ProviderIdSchema,
  workspaceId: StableIdSchema,
  title: z.string().trim().min(1).max(256),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  lifetimeTokens: LifetimeTokenCountSchema.nullable(),
  lifecycle: SessionLifecycleSchema,
  sourceFreshness: SessionSourceFreshnessSchema
});

export const CatalogDiagnosticCodeSchema = z.enum([
  'CATALOG_PROVIDER_UNAVAILABLE',
  'CATALOG_PROVIDER_INCOMPATIBLE',
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

export const CatalogProviderFacetSchema = z.strictObject({
  provider: ProviderIdSchema,
  sessionCount: z.number().int().positive()
});

export const CatalogSnapshotSchema = z.strictObject({
  refreshedAt: z.iso.datetime(),
  workspaces: z.array(WorkspaceSummarySchema).max(25_000),
  sessions: z.array(SessionSummarySchema).max(25_000),
  providerStatus: z.array(CatalogProviderStatusSchema).max(PROVIDER_IDS.length),
  providerFacets: z.array(CatalogProviderFacetSchema).max(PROVIDER_IDS.length),
  diagnostics: z.array(CatalogDiagnosticSchema).max(100)
});

export const CatalogQuerySchema = z.strictObject({
  text: z.string().trim().max(120),
  provider: ProviderIdSchema.nullable()
});

export type WorkspaceSummary = z.infer<typeof WorkspaceSummarySchema>;
export type WorkspaceOrigin = z.infer<typeof WorkspaceOriginSchema>;
export type WorkspaceTrustDecision = z.infer<
  typeof WorkspaceTrustDecisionSchema
>;
export type SessionSummary = z.infer<typeof SessionSummarySchema>;
export type CatalogDiagnostic = z.infer<typeof CatalogDiagnosticSchema>;
export type CatalogProviderStatus = z.infer<
  typeof CatalogProviderStatusSchema
>;
export type CatalogProviderFacet = z.infer<
  typeof CatalogProviderFacetSchema
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
const LaunchArgumentSchema = z.string().max(16_384);

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

const ProviderCommandOverridesSchema = z.partialRecord(
  ProviderIdSchema,
  ProviderLaunchCommandSchema.nullable()
);

export const LaunchSettingsValueSchema = z.strictObject({
  terminalProfileId: TerminalProfileIdSchema.nullable().optional(),
  providerCommands: ProviderCommandOverridesSchema.optional()
});

export const LaunchSettingsScopeSchema = z.enum([
  'global',
  'provider',
  'workspace',
  'session'
]);

const LaunchSettingsLayerInputBaseSchema = z.discriminatedUnion('scope', [
  z.strictObject({
    scope: z.literal('global'),
    targetId: z.literal('global'),
    settings: LaunchSettingsValueSchema
  }),
  z.strictObject({
    scope: z.literal('provider'),
    targetId: ProviderIdSchema,
    settings: LaunchSettingsValueSchema
  }),
  z.strictObject({
    scope: z.literal('workspace'),
    targetId: StableIdSchema,
    settings: LaunchSettingsValueSchema
  }),
  z.strictObject({
    scope: z.literal('session'),
    targetId: StableIdSchema,
    settings: LaunchSettingsValueSchema
  })
]);

function validateProviderLayer(
  layer: {
    scope: string;
    targetId: string;
    settings: z.infer<typeof LaunchSettingsValueSchema>;
  },
  context: z.RefinementCtx
): void {
  if (layer.scope !== 'provider' || layer.settings.providerCommands === undefined) {
    return;
  }
  for (const provider of Object.keys(layer.settings.providerCommands)) {
    if (provider === layer.targetId) continue;
    context.addIssue({
      code: 'custom',
      path: ['settings', 'providerCommands', provider],
      message: 'Provider layers can only configure their own provider.'
    });
  }
}

export const LaunchSettingsLayerInputSchema = LaunchSettingsLayerInputBaseSchema
  .superRefine(validateProviderLayer);

const LaunchSettingsLayerBaseSchema = z.discriminatedUnion('scope', [
  z.strictObject({
    scope: z.literal('global'),
    targetId: z.literal('global'),
    settings: LaunchSettingsValueSchema,
    updatedAt: z.iso.datetime()
  }),
  z.strictObject({
    scope: z.literal('provider'),
    targetId: ProviderIdSchema,
    settings: LaunchSettingsValueSchema,
    updatedAt: z.iso.datetime()
  }),
  z.strictObject({
    scope: z.literal('workspace'),
    targetId: StableIdSchema,
    settings: LaunchSettingsValueSchema,
    updatedAt: z.iso.datetime()
  }),
  z.strictObject({
    scope: z.literal('session'),
    targetId: StableIdSchema,
    settings: LaunchSettingsValueSchema,
    updatedAt: z.iso.datetime()
  })
]);

export const LaunchSettingsLayerSchema = LaunchSettingsLayerBaseSchema
  .superRefine(validateProviderLayer);
export const LaunchSettingsLayerListSchema = z
  .array(LaunchSettingsLayerSchema)
  .max(50_000);

export const LaunchSettingSourceSchema = z.strictObject({
  scope: z.enum([
    'default',
    'global',
    'provider',
    'workspace',
    'session',
    'launch'
  ]),
  targetId: z.string().min(1).nullable()
});

export const ResolvedLaunchSettingSchema = z.strictObject({
  field: z.enum(['providerCommand', 'terminalProfile']),
  value: z.string().nullable(),
  winningSource: LaunchSettingSourceSchema,
  shadowed: z
    .array(
      z.strictObject({
        value: z.string().nullable(),
        source: LaunchSettingSourceSchema
      })
    )
    .max(8),
  mergeStrategy: z.literal('replace'),
  warnings: z.array(z.string().trim().min(1).max(512)).max(8),
  sensitive: z.literal(false)
});

export type LaunchSettingsScope = z.infer<typeof LaunchSettingsScopeSchema>;
export type LaunchSettingsValue = z.infer<typeof LaunchSettingsValueSchema>;
export type LaunchSettingsLayerInput = z.infer<
  typeof LaunchSettingsLayerInputSchema
>;
export type LaunchSettingsLayer = z.infer<typeof LaunchSettingsLayerSchema>;
export type LaunchSettingSource = z.infer<typeof LaunchSettingSourceSchema>;
export type ResolvedLaunchSetting = z.infer<
  typeof ResolvedLaunchSettingSchema
>;

const MODIFIER_KEY_CODES = new Set([
  'AltLeft',
  'AltRight',
  'ControlLeft',
  'ControlRight',
  'MetaLeft',
  'MetaRight',
  'ShiftLeft',
  'ShiftRight'
]);

export const KeyboardShortcutChordSchema = z.strictObject({
  code: z.string().trim().min(1).max(64).refine(
    (code) => !MODIFIER_KEY_CODES.has(code),
    'A shortcut requires a non-modifier key.'
  ),
  control: z.boolean(),
  alt: z.boolean(),
  shift: z.boolean(),
  meta: z.boolean()
}).superRefine((chord, context) => {
  if (!chord.control && !chord.alt && !chord.meta) {
    context.addIssue({
      code: 'custom',
      path: ['control'],
      message: 'A shortcut requires Control, Alt, or Meta.'
    });
  }
});

export type KeyboardShortcutChord = z.infer<
  typeof KeyboardShortcutChordSchema
>;

export const EnabledProviderIdsSchema = z
  .array(ProviderIdSchema)
  .min(1)
  .max(PROVIDER_IDS.length)
  .superRefine((providers, context) => {
    if (new Set(providers).size !== providers.length) {
      context.addIssue({
        code: 'custom',
        message: 'Enabled providers must be unique.'
      });
    }
  })
  .transform((providers) =>
    PROVIDER_IDS.filter((provider) => providers.includes(provider))
  );

export const AppearanceThemeSchema = z.enum(['lumora', 'light', 'dark']);
export const AppearanceBackgroundFitSchema = z.enum([
  'cover',
  'contain',
  'original'
]);
export const AppearanceBackgroundPositionSchema = z.enum([
  'center',
  'top',
  'bottom',
  'left',
  'right',
  'top-left',
  'top-right',
  'bottom-left',
  'bottom-right'
]);

export const AppearanceSettingsSchema = z.strictObject({
  theme: AppearanceThemeSchema,
  lightTerminalInLightMode: z.boolean(),
  backgroundEnabled: z.boolean(),
  backgroundOpacity: z.number().min(0).max(1),
  backgroundBrightness: z.number().min(0.5).max(1.5),
  backgroundBlur: z.number().min(0).max(24),
  surfaceMosaic: z.number().min(0).max(24),
  surfaceOpacity: z.number().min(0).max(1),
  terminalOpacity: z.number().min(0).max(1),
  backgroundFit: AppearanceBackgroundFitSchema,
  backgroundPosition: AppearanceBackgroundPositionSchema
});

export type AppearanceSettings = z.infer<typeof AppearanceSettingsSchema>;

export const DEFAULT_APPEARANCE_SETTINGS = {
  theme: 'lumora',
  lightTerminalInLightMode: false,
  backgroundEnabled: false,
  backgroundOpacity: 0.55,
  backgroundBrightness: 1,
  backgroundBlur: 2,
  surfaceMosaic: 0,
  surfaceOpacity: 0.92,
  terminalOpacity: 0.94,
  backgroundFit: 'cover',
  backgroundPosition: 'center'
} as const satisfies AppearanceSettings;

export const GeneralSettingsSchema = z.strictObject({
  version: z.literal(7),
  showInformationalNotices: z.boolean(),
  startMaximized: z.boolean(),
  checkProviderUpdatesAutomatically: z.boolean(),
  autoExpandSidebar: z.boolean(),
  windowCloseBehavior: z.enum(['quit', 'hide_to_tray']),
  remoteWindowCloseBehavior: z.enum(['keep_connected', 'disconnect']),
  crossAgentWorkflowEnabled: z.boolean(),
  crossAgentHandoffRetentionDays: z.number().int().min(1).max(365),
  enabledProviders: EnabledProviderIdsSchema,
  appearance: AppearanceSettingsSchema
});

export const RemoteProviderPreferencesSchema = z.strictObject({
  enabledProviders: EnabledProviderIdsSchema
});

export const RemoteDiscoverySnapshotSchema = z.strictObject({
  executionTargetId: RemoteExecutionTargetIdSchema,
  scannedAt: z.iso.datetime(),
  environment: DeveloperEnvironmentScanResultSchema,
  providers: ProviderScanResultSchema
});

export const RemoteSessionMetadataSchema = z.strictObject({
  provider: ProviderIdSchema,
  nativeId: z.string().trim().min(1).max(256),
  workspacePath: z.string().min(1).max(32_768),
  title: z.string().trim().min(1).max(256),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  lifetimeTokens: LifetimeTokenCountSchema.nullable()
});

export const RemoteSessionProviderStatusSchema = z.strictObject({
  provider: ProviderIdSchema,
  status: z.enum(['ready', 'unavailable', 'unsupported', 'failed']),
  sessionCount: z.number().int().nonnegative(),
  invalidCount: z.number().int().nonnegative()
});

export const RemoteSessionCatalogSchema = z.strictObject({
  executionTargetId: RemoteExecutionTargetIdSchema,
  scannedAt: z.iso.datetime(),
  sessions: z.array(RemoteSessionMetadataSchema).max(25_000),
  providers: z.array(RemoteSessionProviderStatusSchema).max(PROVIDER_IDS.length),
  snapshot: CatalogSnapshotSchema
});

export const RemoteLifecycleScanStateSchema = z.enum([
  'idle', 'refreshing', 'ready', 'error'
]);
export const RemoteLifecycleSnapshotSchema = z.strictObject({
  summary: RemoteTargetSummarySchema,
  generation: z.number().int().nonnegative(),
  discovery: RemoteDiscoverySnapshotSchema.nullable(),
  catalog: RemoteSessionCatalogSchema.nullable(),
  discoveryState: RemoteLifecycleScanStateSchema,
  catalogState: RemoteLifecycleScanStateSchema,
  activeTerminalCount: z.number().int().nonnegative()
}).superRefine((snapshot, context) => {
  for (const [key, value] of [
    ['discovery', snapshot.discovery],
    ['catalog', snapshot.catalog]
  ] as const) {
    if (
      value !== null &&
      value.executionTargetId !== snapshot.summary.target.id
    ) {
      context.addIssue({
        code: 'custom',
        path: [key, 'executionTargetId'],
        message: 'Remote lifecycle data belongs to another target.'
      });
    }
  }
});
export const RemoteLifecycleEventSchema = z.strictObject({
  executionTargetId: RemoteExecutionTargetIdSchema,
  snapshot: RemoteLifecycleSnapshotSchema
}).superRefine((event, context) => {
  if (event.executionTargetId !== event.snapshot.summary.target.id) {
    context.addIssue({
      code: 'custom',
      path: ['executionTargetId'],
      message: 'Remote lifecycle event target does not match its snapshot.'
    });
  }
});
export const RemoteLifecycleListSchema = z.array(RemoteLifecycleSnapshotSchema);

export const RemoteWindowCloseRequestSchema = z.strictObject({
  executionTargetId: RemoteExecutionTargetIdSchema,
  activeTerminalCount: z.number().int().nonnegative()
});
export const RemoteWindowCloseResolutionSchema = z.strictObject({
  action: z.enum(['keep_running', 'disconnect'])
});
export const RemoteWindowCloseResultSchema = z.strictObject({
  closed: z.boolean()
});

export type RemoteProviderPreferences = z.infer<
  typeof RemoteProviderPreferencesSchema
>;
export type RemoteDiscoverySnapshot = z.infer<
  typeof RemoteDiscoverySnapshotSchema
>;
export type RemoteSessionMetadata = z.infer<
  typeof RemoteSessionMetadataSchema
>;
export type RemoteSessionProviderStatus = z.infer<
  typeof RemoteSessionProviderStatusSchema
>;
export type RemoteSessionCatalog = z.infer<
  typeof RemoteSessionCatalogSchema
>;
export type RemoteLifecycleScanState = z.infer<
  typeof RemoteLifecycleScanStateSchema
>;
export type RemoteLifecycleSnapshot = z.infer<
  typeof RemoteLifecycleSnapshotSchema
>;
export type RemoteLifecycleEvent = z.infer<typeof RemoteLifecycleEventSchema>;
export type RemoteWindowCloseRequest = z.infer<
  typeof RemoteWindowCloseRequestSchema
>;
export type RemoteWindowCloseResolution = z.infer<
  typeof RemoteWindowCloseResolutionSchema
>;

export type GeneralSettings = z.infer<typeof GeneralSettingsSchema>;

export const DEFAULT_GENERAL_SETTINGS: GeneralSettings = {
  version: 7,
  showInformationalNotices: true,
  startMaximized: true,
  checkProviderUpdatesAutomatically: true,
  autoExpandSidebar: true,
  windowCloseBehavior: 'quit',
  remoteWindowCloseBehavior: 'keep_connected',
  crossAgentWorkflowEnabled: false,
  crossAgentHandoffRetentionDays: 30,
  enabledProviders: [...PROVIDER_IDS],
  appearance: { ...DEFAULT_APPEARANCE_SETTINGS }
};

const VersionSixGeneralSettingsSchema = z.strictObject({
  version: z.literal(6),
  showInformationalNotices: z.boolean(),
  startMaximized: z.boolean(),
  checkProviderUpdatesAutomatically: z.boolean(),
  autoExpandSidebar: z.boolean(),
  windowCloseBehavior: z.enum(['quit', 'hide_to_tray']),
  crossAgentWorkflowEnabled: z.boolean(),
  crossAgentHandoffRetentionDays: z.number().int().min(1).max(365),
  enabledProviders: EnabledProviderIdsSchema,
  appearance: AppearanceSettingsSchema
});

const VersionFiveAppearanceSettingsSchema = AppearanceSettingsSchema
  .omit({ surfaceMosaic: true })
  .extend({ theme: z.enum(['system', 'lumora', 'light', 'dark']) });

const VersionFiveGeneralSettingsSchema = z.strictObject({
  version: z.literal(5),
  showInformationalNotices: z.boolean(),
  startMaximized: z.boolean(),
  checkProviderUpdatesAutomatically: z.boolean(),
  autoExpandSidebar: z.boolean(),
  windowCloseBehavior: z.enum(['quit', 'hide_to_tray']),
  crossAgentWorkflowEnabled: z.boolean(),
  crossAgentHandoffRetentionDays: z.number().int().min(1).max(365),
  enabledProviders: EnabledProviderIdsSchema,
  appearance: VersionFiveAppearanceSettingsSchema
});

const VersionFourGeneralSettingsSchema = z.strictObject({
  version: z.literal(4),
  showInformationalNotices: z.boolean(),
  startMaximized: z.boolean(),
  checkProviderUpdatesAutomatically: z.boolean(),
  autoExpandSidebar: z.boolean(),
  windowCloseBehavior: z.enum(['quit', 'hide_to_tray']),
  crossAgentWorkflowEnabled: z.boolean(),
  crossAgentHandoffRetentionDays: z.number().int().min(1).max(365),
  enabledProviders: EnabledProviderIdsSchema
});

const VersionThreeGeneralSettingsSchema = z.strictObject({
  version: z.literal(3),
  showInformationalNotices: z.boolean(),
  startMaximized: z.boolean(),
  checkProviderUpdatesAutomatically: z.boolean(),
  autoExpandSidebar: z.boolean(),
  crossAgentWorkflowEnabled: z.boolean(),
  crossAgentHandoffRetentionDays: z.number().int().min(1).max(365),
  enabledProviders: EnabledProviderIdsSchema
});

const VersionTwoGeneralSettingsSchema = z.strictObject({
  version: z.literal(2),
  showInformationalNotices: z.boolean(),
  startMaximized: z.boolean(),
  checkProviderUpdatesAutomatically: z.boolean(),
  autoExpandSidebar: z.boolean(),
  enabledProviders: EnabledProviderIdsSchema
});

const LegacyGeneralSettingsSchema = z.strictObject({
  version: z.literal(1),
  showInformationalNotices: z.boolean()
});

export function parseStoredGeneralSettings(value: unknown): GeneralSettings {
  const current = GeneralSettingsSchema.safeParse(value);
  if (current.success) return current.data;

  const versionSix = VersionSixGeneralSettingsSchema.safeParse(value);
  if (versionSix.success) {
    return GeneralSettingsSchema.parse({
      ...versionSix.data,
      version: 7,
      remoteWindowCloseBehavior: 'keep_connected'
    });
  }

  const versionFive = VersionFiveGeneralSettingsSchema.safeParse(value);
  if (versionFive.success) {
    return GeneralSettingsSchema.parse({
      ...versionFive.data,
      version: 7,
      remoteWindowCloseBehavior: 'keep_connected',
      appearance: {
        ...versionFive.data.appearance,
        theme: versionFive.data.appearance.theme === 'system'
          ? 'lumora'
          : versionFive.data.appearance.theme,
        surfaceMosaic: 0
      }
    });
  }

  const versionFour = VersionFourGeneralSettingsSchema.safeParse(value);
  if (versionFour.success) {
    return GeneralSettingsSchema.parse({
      ...DEFAULT_GENERAL_SETTINGS,
      ...versionFour.data,
      version: 7
    });
  }

  const versionThree = VersionThreeGeneralSettingsSchema.safeParse(value);
  if (versionThree.success) {
    return GeneralSettingsSchema.parse({
      ...DEFAULT_GENERAL_SETTINGS,
      ...versionThree.data,
      version: 7
    });
  }

  const versionTwo = VersionTwoGeneralSettingsSchema.safeParse(value);
  if (versionTwo.success) {
    return GeneralSettingsSchema.parse({
      ...DEFAULT_GENERAL_SETTINGS,
      ...versionTwo.data,
      version: 7
    });
  }

  const legacy = LegacyGeneralSettingsSchema.safeParse(value);
  return legacy.success
    ? GeneralSettingsSchema.parse({
        ...DEFAULT_GENERAL_SETTINGS,
        showInformationalNotices: legacy.data.showInformationalNotices
      })
    : GeneralSettingsSchema.parse(DEFAULT_GENERAL_SETTINGS);
}

const controlShortcut = (code: string): KeyboardShortcutChord => ({
  code,
  control: true,
  alt: false,
  shift: false,
  meta: false
});

const DEFAULT_TERMINAL_SWITCHER = controlShortcut('Tab');
const FORMER_DEFAULT_OPEN_TERMINALS = controlShortcut('KeyT');
const DEFAULT_OPEN_TERMINALS = {
  ...FORMER_DEFAULT_OPEN_TERMINALS,
  shift: true
};
const DEFAULT_TOGGLE_SIDEBAR = {
  ...controlShortcut('KeyL'),
  shift: true
};
const DEFAULT_OPEN_HOME = controlShortcut('Digit1');
const DEFAULT_OPEN_WORKSPACES = controlShortcut('Digit2');
const DEFAULT_OPEN_SESSIONS = controlShortcut('Digit3');
const DEFAULT_OPEN_PROFILES = controlShortcut('Digit4');
const DEFAULT_OPEN_SETTINGS = controlShortcut('Digit5');
const DEFAULT_OPEN_SETTINGS_ALIAS = controlShortcut('Comma');

const VersionOneKeyboardSettingsSchema = z.strictObject({
  version: z.literal(1),
  terminalSwitcher: KeyboardShortcutChordSchema,
  openTerminals: KeyboardShortcutChordSchema.default(
    FORMER_DEFAULT_OPEN_TERMINALS
  ),
  toggleSidebar: KeyboardShortcutChordSchema.default(DEFAULT_TOGGLE_SIDEBAR),
  openHome: KeyboardShortcutChordSchema.default(DEFAULT_OPEN_HOME),
  openWorkspaces: KeyboardShortcutChordSchema.default(DEFAULT_OPEN_WORKSPACES),
  openSessions: KeyboardShortcutChordSchema.default(DEFAULT_OPEN_SESSIONS),
  openProfiles: KeyboardShortcutChordSchema.default(DEFAULT_OPEN_PROFILES),
  openSettings: KeyboardShortcutChordSchema.default(DEFAULT_OPEN_SETTINGS),
  openSettingsAlias: KeyboardShortcutChordSchema.default(
    DEFAULT_OPEN_SETTINGS_ALIAS
  )
});

export const KeyboardSettingsSchema = z.strictObject({
  version: z.literal(2),
  terminalSwitcher: KeyboardShortcutChordSchema,
  openTerminals: KeyboardShortcutChordSchema.default(DEFAULT_OPEN_TERMINALS),
  toggleSidebar: KeyboardShortcutChordSchema.default(DEFAULT_TOGGLE_SIDEBAR),
  openHome: KeyboardShortcutChordSchema.default(DEFAULT_OPEN_HOME),
  openWorkspaces: KeyboardShortcutChordSchema.default(DEFAULT_OPEN_WORKSPACES),
  openSessions: KeyboardShortcutChordSchema.default(DEFAULT_OPEN_SESSIONS),
  openProfiles: KeyboardShortcutChordSchema.default(DEFAULT_OPEN_PROFILES),
  openSettings: KeyboardShortcutChordSchema.default(DEFAULT_OPEN_SETTINGS),
  openSettingsAlias: KeyboardShortcutChordSchema.default(
    DEFAULT_OPEN_SETTINGS_ALIAS
  )
});

export type KeyboardSettings = z.infer<typeof KeyboardSettingsSchema>;

export const DEFAULT_KEYBOARD_SETTINGS = {
  version: 2,
  terminalSwitcher: DEFAULT_TERMINAL_SWITCHER,
  openTerminals: DEFAULT_OPEN_TERMINALS,
  toggleSidebar: DEFAULT_TOGGLE_SIDEBAR,
  openHome: DEFAULT_OPEN_HOME,
  openWorkspaces: DEFAULT_OPEN_WORKSPACES,
  openSessions: DEFAULT_OPEN_SESSIONS,
  openProfiles: DEFAULT_OPEN_PROFILES,
  openSettings: DEFAULT_OPEN_SETTINGS,
  openSettingsAlias: DEFAULT_OPEN_SETTINGS_ALIAS
} as const satisfies KeyboardSettings;

function shortcutChordEquals(
  left: KeyboardShortcutChord,
  right: KeyboardShortcutChord
): boolean {
  return left.code === right.code &&
    left.control === right.control &&
    left.alt === right.alt &&
    left.shift === right.shift &&
    left.meta === right.meta;
}

export function parseKeyboardSettings(value: unknown): KeyboardSettings {
  const current = KeyboardSettingsSchema.safeParse(value);
  if (current.success) return current.data;

  const versionOne = VersionOneKeyboardSettingsSchema.safeParse(value);
  if (!versionOne.success) {
    return KeyboardSettingsSchema.parse(DEFAULT_KEYBOARD_SETTINGS);
  }

  return KeyboardSettingsSchema.parse({
    ...versionOne.data,
    version: 2,
    openTerminals: shortcutChordEquals(
      versionOne.data.openTerminals,
      FORMER_DEFAULT_OPEN_TERMINALS
    )
      ? DEFAULT_OPEN_TERMINALS
      : versionOne.data.openTerminals
  });
}

const TerminalDimensionsFields = {
  cols: z.number().int().min(20).max(500),
  rows: z.number().int().min(5).max(300)
};

const StartPromptSchema = z.string().max(4_096).refine(
  (prompt) => !/[\0\r\n]/.test(prompt),
  'The start prompt is invalid.'
).transform((prompt) => prompt.trim().length === 0 ? '' : prompt);

const LaunchRequestBaseFields = {
  terminalProfileId: StableIdSchema.nullable().default(null),
  startPrompt: StartPromptSchema.optional().default(''),
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
    provider: ProviderIdSchema.optional(),
    ...LaunchRequestBaseFields
  }),
  z.strictObject({
    strategy: z.literal('fork'),
    sessionId: StableIdSchema,
    ...LaunchRequestBaseFields
  })
]);

export const LaunchPreviewSchema = z.strictObject({
  launchToken: z.uuid(),
  launchHash: StableIdSchema,
  strategy: z.enum(['new', 'resume', 'fork']),
  sessionId: StableIdSchema.nullable(),
  provider: ProviderIdSchema,
  executablePath: z.string().min(1).max(32_768),
  args: z.array(LaunchArgumentSchema).max(64),
  command: ProviderLaunchConfigSchema.shape.command.default(null),
  workingDirectory: z.string().min(1).max(32_768),
  workspaceTrusted: z.boolean(),
  environmentNames: z.array(z.string().min(1).max(256)).max(256),
  terminalProfile: TerminalProfileSchema,
  configuration: z.array(ResolvedLaunchSettingSchema).length(2),
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
export const RuntimeStrategySchema = z.enum(['new', 'resume', 'fork']);
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
  displayName: z.string().trim().min(1).max(256),
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
    runtime.strategy !== 'resume' &&
    runtime.reconciliationState === 'not_required'
  ) {
    context.addIssue({
      code: 'custom',
      path: ['reconciliationState'],
      message: 'A new or fork runtime requires an explicit reconciliation result.'
    });
  }
  if (
    runtime.strategy !== 'resume' &&
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
    runtime.strategy !== 'resume' &&
    runtime.reconciliationState !== 'linked' &&
    (runtime.sessionId !== null || runtime.nativeSessionId !== null)
  ) {
    context.addIssue({
      code: 'custom',
      path: ['reconciliationState'],
      message: 'An unlinked new or fork runtime cannot carry session identity.'
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
  snapshot: z.string().max(1_048_576),
  outputSequence: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
});
export const RuntimeCommandResultSchema = z.strictObject({
  accepted: z.literal(true)
});

export const RuntimeEventSchema = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('output'),
    runtimeId: RuntimeIdSchema,
    sequence: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
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

export const ClipboardTextSchema = z.string().max(4_194_304);

export const StartupPresentationClaimSchema = z.boolean();

export const StartupPresentationCompletionSchema = z.strictObject({
  acknowledged: z.literal(true)
});

export const TrayResumeSessionRequestSchema = z.strictObject({
  sessionId: StableIdSchema
});

export type TrayResumeSessionRequest = z.infer<
  typeof TrayResumeSessionRequestSchema
>;

export const ClipboardWriteResultSchema = z.strictObject({
  accepted: z.literal(true)
});

export type ClipboardText = z.infer<typeof ClipboardTextSchema>;

export const AppearanceBackgroundStateSchema = z.discriminatedUnion(
  'available',
  [
    z.strictObject({ available: z.literal(false), revision: z.null() }),
    z.strictObject({
      available: z.literal(true),
      revision: z.string().regex(/^\d+-\d+$/).max(64)
    })
  ]
);

export type AppearanceBackgroundState = z.infer<
  typeof AppearanceBackgroundStateSchema
>;

export const AppearancePresentationSchema = z.strictObject({
  appearance: AppearanceSettingsSchema,
  background: AppearanceBackgroundStateSchema
});

export type AppearancePresentation = z.infer<
  typeof AppearancePresentationSchema
>;

export const IPC_CHANNELS = {
  targetWindowContextGet: 'lumora:targets:window-context:get',
  remoteTargetList: 'lumora:targets:list',
  remoteTargetCreate: 'lumora:targets:create',
  remoteTargetUpdate: 'lumora:targets:update',
  remoteTargetRemove: 'lumora:targets:remove',
  remoteTargetObserveHost: 'lumora:targets:host:observe',
  remoteTargetTrustHost: 'lumora:targets:host:trust',
  remoteTargetConnect: 'lumora:targets:connect',
  remoteCredentialStatus: 'lumora:targets:credential:status',
  remoteCredentialForget: 'lumora:targets:credential:forget',
  remoteAutoConnectPreferenceSave: 'lumora:targets:auto-connect:save',
  remoteTargetDisconnect: 'lumora:targets:disconnect',
  remoteTargetHelperDetails: 'lumora:targets:helper:details',
  remoteTargetHelperInstall: 'lumora:targets:helper:install',
  remoteProviderPreferencesGet: 'lumora:targets:providers:get',
  remoteProviderPreferencesSave: 'lumora:targets:providers:save',
  remoteDiscoveryScan: 'lumora:targets:discovery:scan',
  remoteSessionScan: 'lumora:targets:sessions:scan',
  remoteLifecycleList: 'lumora:targets:lifecycle:list',
  remoteLifecycleEvent: 'lumora:targets:lifecycle:event',
  remoteWindowCloseRequest: 'lumora:targets:window:close-request',
  remoteWindowCloseResolve: 'lumora:targets:window:close-resolve',
  remoteTargetWindowOpen: 'lumora:targets:window:open',
  systemInfo: 'lumora:system:info',
  startupPresentationClaim: 'lumora:system:startup-presentation:claim',
  startupPresentationComplete: 'lumora:system:startup-presentation:complete',
  environmentScan: 'lumora:environment:scan',
  nodeDownloadOpen: 'lumora:environment:node-download:open',
  providerScan: 'lumora:providers:scan',
  providerUpdatesCheck: 'lumora:providers:updates:check',
  providerUpdateRun: 'lumora:providers:update:run',
  providerInstallRun: 'lumora:providers:install:run',
  providerInstallGuideOpen: 'lumora:providers:install-guide:open',
  catalogGet: 'lumora:catalog:get',
  catalogRefresh: 'lumora:catalog:refresh',
  workspaceChoose: 'lumora:workspace:choose',
  trayResumeSession: 'lumora:tray:resume-session',
  clipboardTextRead: 'lumora:clipboard:text:read',
  clipboardTextWrite: 'lumora:clipboard:text:write',
  appearancePresentationGet: 'lumora:appearance:presentation:get',
  appearanceBackgroundGet: 'lumora:appearance:background:get',
  appearanceBackgroundChoose: 'lumora:appearance:background:choose',
  appearanceBackgroundRemove: 'lumora:appearance:background:remove',
  terminalProfilesGet: 'lumora:terminal:profiles:get',
  terminalProfileSave: 'lumora:terminal:profiles:save',
  terminalProfileDelete: 'lumora:terminal:profiles:delete',
  providerLaunchConfigsGet: 'lumora:terminal:provider-launch-configs:get',
  providerLaunchConfigSave: 'lumora:terminal:provider-launch-configs:save',
  launchSettingsLayersGet: 'lumora:terminal:launch-settings:get',
  launchSettingsLayerSave: 'lumora:terminal:launch-settings:save',
  generalSettingsGet: 'lumora:terminal:general-settings:get',
  generalSettingsSave: 'lumora:terminal:general-settings:save',
  keyboardSettingsGet: 'lumora:terminal:keyboard-settings:get',
  keyboardSettingsSave: 'lumora:terminal:keyboard-settings:save',
  launchPrepare: 'lumora:terminal:launch:prepare',
  workspaceTrustGet: 'lumora:terminal:workspace-trust:get',
  workspaceTrustGrant: 'lumora:terminal:workspace-trust:grant',
  workspaceTrustRevoke: 'lumora:terminal:workspace-trust:revoke',
  runtimeStart: 'lumora:terminal:runtime:start',
  runtimeList: 'lumora:terminal:runtime:list',
  runtimeAttach: 'lumora:terminal:runtime:attach',
  runtimeWrite: 'lumora:terminal:runtime:write',
  runtimeResize: 'lumora:terminal:runtime:resize',
  runtimeTerminate: 'lumora:terminal:runtime:terminate',
  terminalLinkOpen: 'lumora:terminal:link:open',
  runtimeEvent: 'lumora:terminal:runtime:event',
  transferCapabilitiesGet: 'lumora:transfer:capabilities:get',
  transferExportPrepare: 'lumora:transfer:export:prepare',
  transferExportExecute: 'lumora:transfer:export:execute',
  transferImportChoose: 'lumora:transfer:import:choose',
  transferImportInspect: 'lumora:transfer:import:inspect',
  transferImportPlan: 'lumora:transfer:import:plan',
  transferImportExecute: 'lumora:transfer:import:execute',
  transferWorkspaceChoose: 'lumora:transfer:workspace:choose',
  transferHistoryGet: 'lumora:transfer:history:get',
  transferOperationCancel: 'lumora:transfer:operation:cancel',
  transferEvent: 'lumora:transfer:event'
} as const;

export interface LumoraApi {
  getWindowContext(): Promise<LumoraWindowContext>;
  listRemoteTargets(): Promise<RemoteTargetSummary[]>;
  listRemoteLifecycleSnapshots(): Promise<RemoteLifecycleSnapshot[]>;
  onRemoteLifecycleEvent(
    listener: (event: RemoteLifecycleEvent) => void
  ): () => void;
  onRemoteWindowCloseRequest(
    listener: (request: RemoteWindowCloseRequest) => void
  ): () => void;
  resolveRemoteWindowClose(
    resolution: RemoteWindowCloseResolution
  ): Promise<boolean>;
  createRemoteTarget(
    input: RemoteConnectionProfileInput
  ): Promise<RemoteTargetSummary>;
  updateRemoteTarget(
    executionTargetId: RemoteExecutionTargetId,
    input: RemoteConnectionProfileInput
  ): Promise<RemoteTargetSummary>;
  removeRemoteTarget(executionTargetId: RemoteExecutionTargetId): Promise<void>;
  observeRemoteHost(
    executionTargetId: RemoteExecutionTargetId
  ): Promise<RemoteHostKeyObservation>;
  trustRemoteHost(input: RemoteHostKeyObservation): Promise<RemoteTargetSummary>;
  connectRemoteTarget(
    input: RemoteTargetConnectRequest
  ): Promise<RemoteTargetConnectionDetails>;
  getRemoteCredentialStatus(
    executionTargetId: RemoteExecutionTargetId
  ): Promise<RemoteCredentialStatus>;
  setRemoteAutoConnect(
    executionTargetId: RemoteExecutionTargetId,
    enabled: boolean
  ): Promise<RemoteCredentialStatus>;
  forgetRemoteCredential(
    executionTargetId: RemoteExecutionTargetId
  ): Promise<RemoteCredentialStatus>;
  disconnectRemoteTarget(
    executionTargetId: RemoteExecutionTargetId
  ): Promise<RemoteTargetSummary>;
  getRemoteHelperInstallDetails(): Promise<RemoteHelperInstallDetails>;
  installRemoteHelper(): Promise<RemoteTargetConnectionDetails>;
  getRemoteProviderPreferences(): Promise<RemoteProviderPreferences>;
  saveRemoteProviderPreferences(
    preferences: RemoteProviderPreferences
  ): Promise<RemoteProviderPreferences>;
  scanRemoteDiscovery(): Promise<RemoteDiscoverySnapshot>;
  scanRemoteSessions(): Promise<RemoteSessionCatalog>;
  openRemoteTargetWindow(
    executionTargetId: RemoteExecutionTargetId
  ): Promise<void>;
  getAppearancePresentation(): Promise<AppearancePresentation>;
  getSystemInfo(): Promise<SystemInfo>;
  claimStartupPresentation(): Promise<boolean>;
  completeStartupPresentation(): Promise<void>;
  scanDeveloperEnvironment(): Promise<DeveloperEnvironmentScanResult>;
  openNodeDownloadPage(): Promise<void>;
  scanProviders(): Promise<ProviderScanResult>;
  checkProviderUpdates(): Promise<ProviderUpdateCheckResult>;
  installProvider(provider: ProviderId): Promise<ProviderUpdateResult>;
  openProviderInstallGuide(provider: ProviderId): Promise<void>;
  updateProvider(provider: ProviderId): Promise<ProviderUpdateResult>;
  getCatalog(query?: CatalogQuery): Promise<CatalogSnapshot>;
  refreshCatalog(query?: CatalogQuery): Promise<CatalogSnapshot>;
  chooseWorkspace(): Promise<CatalogSnapshot | null>;
  onTrayResumeSessionRequested(
    listener: (sessionId: string) => void
  ): () => void;
  readClipboardText(): Promise<string>;
  writeClipboardText(text: string): Promise<void>;
  getAppearanceBackground(): Promise<AppearanceBackgroundState>;
  chooseAppearanceBackground(): Promise<AppearanceBackgroundState>;
  removeAppearanceBackground(): Promise<AppearanceBackgroundState>;
  getTerminalProfiles(): Promise<TerminalProfile[]>;
  saveTerminalProfile(
    input: CustomTerminalProfileInput
  ): Promise<TerminalProfile[]>;
  deleteTerminalProfile(profileId: string): Promise<TerminalProfile[]>;
  getProviderLaunchConfigs(): Promise<ProviderLaunchConfig[]>;
  saveProviderLaunchConfig(
    input: ProviderLaunchConfigInput
  ): Promise<ProviderLaunchConfig[]>;
  getLaunchSettingsLayers(): Promise<LaunchSettingsLayer[]>;
  saveLaunchSettingsLayer(
    input: LaunchSettingsLayerInput
  ): Promise<LaunchSettingsLayer[]>;
  getGeneralSettings(): Promise<GeneralSettings>;
  saveGeneralSettings(input: GeneralSettings): Promise<GeneralSettings>;
  getKeyboardSettings(): Promise<KeyboardSettings>;
  saveKeyboardSettings(input: KeyboardSettings): Promise<KeyboardSettings>;
  prepareLaunch(input: LaunchPrepareRequest): Promise<LaunchPreview>;
  getWorkspaceTrustDecisions(): Promise<WorkspaceTrustDecision[]>;
  trustWorkspaceForLaunch(
    launchToken: string
  ): Promise<WorkspaceTrustDecision>;
  revokeWorkspaceTrust(workspaceId: string): Promise<WorkspaceTrustDecision[]>;
  startRuntime(launchToken: string): Promise<RuntimeSummary>;
  listRuntimes(): Promise<RuntimeSummary[]>;
  attachRuntime(runtimeId: string): Promise<RuntimeAttachment>;
  writeRuntime(input: RuntimeWriteRequest): Promise<void>;
  resizeRuntime(input: RuntimeResizeRequest): Promise<void>;
  terminateRuntime(runtimeId: string): Promise<RuntimeSummary>;
  openTerminalLink(url: string): Promise<void>;
  onRuntimeEvent(listener: (event: RuntimeEvent) => void): () => void;
  getTransferCapabilities(): Promise<SessionTransferCapability[]>;
  prepareSessionExport(
    input: SessionExportPrepareRequest
  ): Promise<SessionExportPlan>;
  executeSessionExport(
    input: SessionExportExecuteRequest
  ): Promise<SessionTransferResult | null>;
  chooseSessionImportArchive(): Promise<
    SessionTransferArchiveSelection | null
  >;
  inspectSessionImport(
    input: SessionImportInspectRequest
  ): Promise<SessionImportInspection>;
  planSessionImport(input: SessionImportPlanRequest): Promise<SessionImportPlan>;
  executeSessionImport(
    input: SessionImportExecuteRequest
  ): Promise<SessionTransferResult>;
  chooseTransferWorkspace(): Promise<WorkspaceSummary | null>;
  getTransferHistory(): Promise<TransferHistoryEntry[]>;
  cancelTransferOperation(operationId: string): Promise<void>;
  onTransferEvent(
    listener: (event: SessionTransferProgressEvent) => void
  ): () => void;
}
