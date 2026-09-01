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
import type {
  DiagnosticExportResult,
  DiagnosticStorageSettings,
  DiagnosticSummary
} from './diagnostics';
import {
  StructuredAgentRuntimeSummarySchema,
  type StructuredAgentAction,
  type StructuredAgentEvent,
  type StructuredAgentLaunchRequest,
  type StructuredAgentRuntimeSnapshot,
  type StructuredAgentRuntimeSummary
} from './agent/contracts';
import type {
  StructuredProviderCapabilityReport,
  StructuredProviderPreference
} from './agent/provider-capabilities';
export * from './session-transfer';
export * from './diagnostics';
export * from './agent/contracts';
export * from './agent/provider-capabilities';

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

export const StableApplicationVersionSchema = z
  .string()
  .regex(/^v?\d+\.\d+\.\d+$/)
  .transform((value) => value.replace(/^v/, ''));

export const ApplicationReleaseMetadataSchema = z.strictObject({
  version: StableApplicationVersionSchema,
  publishedAt: z.iso.datetime(),
  summary: z.string().max(600),
  url: z.string().url().refine((value) => {
    const parsed = new URL(value);
    return parsed.protocol === 'https:' &&
      parsed.hostname === 'github.com' &&
      parsed.username === '' &&
      parsed.password === '' &&
      parsed.search === '' &&
      parsed.hash === '' &&
      /^\/HAYASAKA7\/Lumora\/releases\/tag\/[^/]+$/.test(parsed.pathname);
  }, 'The release URL must point to the Lumora GitHub repository.')
});

export const ApplicationReleaseStatusSchema = z.discriminatedUnion('state', [
  z.strictObject({
    state: z.literal('current'),
    installedVersion: z.string().min(1),
    latestVersion: StableApplicationVersionSchema
  }),
  z.strictObject({
    state: z.literal('update_available'),
    installedVersion: z.string().min(1),
    release: ApplicationReleaseMetadataSchema
  }),
  z.strictObject({
    state: z.literal('unavailable'),
    installedVersion: z.string().min(1)
  })
]);

export const ApplicationAboutInfoSchema = z.strictObject({
  productName: z.literal('Lumora'),
  developer: z.literal('HAYASAKA7'),
  system: SystemInfoSchema
});

export type ApplicationReleaseMetadata = z.infer<
  typeof ApplicationReleaseMetadataSchema
>;
export type ApplicationReleaseStatus = z.infer<
  typeof ApplicationReleaseStatusSchema
>;
export type ApplicationAboutInfo = z.infer<typeof ApplicationAboutInfoSchema>;

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
export type ExternalOpenResult = z.infer<typeof ExternalOpenResultSchema>;

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
  'kimi',
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

export const WorkspaceVisibilityModeSchema = z.enum([
  'workspace_only',
  'workspace_and_sessions'
]);

export const WorkspaceVisibilityPolicySchema = z.strictObject({
  workspaceId: StableIdSchema,
  mode: WorkspaceVisibilityModeSchema,
  updatedAt: z.iso.datetime()
});

export const WorkspaceVisibilityPolicyListSchema = z
  .array(WorkspaceVisibilityPolicySchema)
  .max(25_000);

export const WorkspaceVisibilitySetRequestSchema = z.strictObject({
  workspaceId: StableIdSchema,
  mode: WorkspaceVisibilityModeSchema
});

export const WorkspaceVisibilityRestoreRequestSchema = z.strictObject({
  workspaceIds: z.array(StableIdSchema).min(1).max(25_000)
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
export type WorkspaceVisibilityMode = z.infer<
  typeof WorkspaceVisibilityModeSchema
>;
export type WorkspaceVisibilityPolicy = z.infer<
  typeof WorkspaceVisibilityPolicySchema
>;
export type WorkspaceVisibilitySetRequest = z.infer<
  typeof WorkspaceVisibilitySetRequestSchema
>;
export type WorkspaceVisibilityRestoreRequest = z.infer<
  typeof WorkspaceVisibilityRestoreRequestSchema
>;
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

export const FontFamilyNameSchema = z.string()
  .trim()
  .min(1)
  .max(128)
  .refine(
    (value) => !/[\u0000-\u001f\u007f]/u.test(value),
    'Font family names must not contain control characters.'
  );

export const AppearanceColorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/u);

export const AppearanceSettingsSchema = z.strictObject({
  theme: AppearanceThemeSchema,
  themePresetId: z.string()
    .min(1)
    .max(64)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u)
    .nullable(),
  lightTerminalInLightMode: z.boolean(),
  interfaceFontFamily: FontFamilyNameSchema.nullable(),
  terminalFontFamily: FontFamilyNameSchema.nullable(),
  userMessageColor: AppearanceColorSchema.nullable().default(null),
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
  themePresetId: null,
  lightTerminalInLightMode: false,
  interfaceFontFamily: null,
  terminalFontFamily: null,
  userMessageColor: null,
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

const LocaleTagSchema = z.string().trim().min(2).max(64).refine(
  (value) => {
    try {
      return Intl.getCanonicalLocales(value).length === 1;
    } catch {
      return false;
    }
  },
  { message: 'Expected a valid BCP47 language tag.' }
);

export const LanguagePreferenceSchema = z.union([
  z.literal('system'),
  LocaleTagSchema
]);
export const LocaleDirectionSchema = z.enum(['ltr', 'rtl']);
export const LocaleManifestSchema = z.strictObject({
  schemaVersion: z.literal(1),
  catalogVersion: z.number().int().positive(),
  locale: LocaleTagSchema,
  displayName: z.string().trim().min(1).max(128),
  direction: LocaleDirectionSchema
});
export const LocaleSummarySchema = z.strictObject({
  locale: LocaleTagSchema,
  displayName: z.string().trim().min(1).max(128),
  direction: LocaleDirectionSchema,
  sources: z.array(z.enum(['bundled', 'user'])).min(1).max(2),
  catalogVersion: z.number().int().positive()
});
export const LocaleWarningSchema = z.strictObject({
  code: z.enum([
    'catalog-version-mismatch',
    'invalid-user-pack',
    'unsupported-schema',
    'unknown-message-key'
  ]),
  locale: LocaleTagSchema.nullable(),
  path: z.string().min(1).max(1024).nullable(),
  message: z.string().trim().min(1).max(2048)
});

const LocalizationMessageKeySchema = z.string().trim().min(3).max(512).refine(
  (value) => {
    const segments = value.split('.');
    return segments.length >= 2 && segments.every((segment) =>
      /^[a-z][a-z0-9-]*$/.test(segment) &&
      segment !== '__proto__' &&
      segment !== 'prototype' &&
      segment !== 'constructor'
    );
  },
  { message: 'Expected a safe semantic localization key.' }
);
const LocalizationMessagesSchema = z.record(
  LocalizationMessageKeySchema,
  z.string().max(16_384)
).superRefine((messages, context) => {
  if (Object.keys(messages).length > 10_000) {
    context.addIssue({
      code: 'custom',
      message: 'A localization snapshot cannot contain more than 10,000 messages.'
    });
  }
});

export const LocalizationSnapshotSchema = z.strictObject({
  revision: z.number().int().nonnegative(),
  preference: LanguagePreferenceSchema,
  locale: LocaleTagSchema,
  formattingLocale: LocaleTagSchema,
  direction: LocaleDirectionSchema,
  availableLocales: z.array(LocaleSummarySchema).min(1).max(64),
  messages: LocalizationMessagesSchema,
  warnings: z.array(LocaleWarningSchema).max(64)
});
export const LocaleReloadResultSchema = z.strictObject({
  snapshot: LocalizationSnapshotSchema,
  loadedUserPacks: z.number().int().nonnegative().max(64),
  rejectedUserPacks: z.number().int().nonnegative().max(64)
});
export const LocalizationFolderOpenResultSchema = z.strictObject({
  opened: z.literal(true)
});
export const ModsSettingsSchema = z.strictObject({
  rootPath: z.string().min(1).max(32_768),
  localesPath: z.string().min(1).max(32_768),
  fontsPath: z.string().min(1).max(32_768),
  themesPath: z.string().min(1).max(32_768),
  usesDefault: z.boolean()
});
export const ModsRootChooseResultSchema = z.strictObject({
  canceled: z.boolean(),
  settings: ModsSettingsSchema
});

export const FontPresetIdSchema = z.string()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u);

export const FontPresetSchema = z.strictObject({
  id: FontPresetIdSchema,
  displayName: z.string().trim().min(1).max(80).refine(
    (value) => !/[\u0000-\u001f\u007f]/u.test(value),
    'Font preset names must not contain control characters.'
  ),
  interfaceFontFamily: FontFamilyNameSchema.nullable(),
  terminalFontFamily: FontFamilyNameSchema.nullable()
}).refine(
  (value) => value.interfaceFontFamily !== null || value.terminalFontFamily !== null,
  'A font preset must select at least one font family.'
);

export const FontPresetListSchema = z.strictObject({
  presets: z.array(FontPresetSchema).max(64),
  rejectedCount: z.number().int().min(0).max(1_000_000)
});

export const ThemePresetIdSchema = z.string()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u);

export const ThemeColorSchema = AppearanceColorSchema;

export const ThemePaletteSchema = z.strictObject({
  accent: ThemeColorSchema,
  onAccent: ThemeColorSchema,
  background: ThemeColorSchema,
  sidebar: ThemeColorSchema,
  sidebarText: ThemeColorSchema,
  surface: ThemeColorSchema,
  surfaceRaised: ThemeColorSchema,
  control: ThemeColorSchema,
  text: ThemeColorSchema,
  textMuted: ThemeColorSchema,
  border: ThemeColorSchema,
  success: ThemeColorSchema,
  warning: ThemeColorSchema,
  danger: ThemeColorSchema
});

function relativeLuminance(color: string): number {
  const components = [1, 3, 5].map((offset) =>
    Number.parseInt(color.slice(offset, offset + 2), 16) / 255
  ).map((component) => component <= 0.04045
    ? component / 12.92
    : ((component + 0.055) / 1.055) ** 2.4);
  return 0.2126 * (components[0] ?? 0) +
    0.7152 * (components[1] ?? 0) +
    0.0722 * (components[2] ?? 0);
}

function themeContrast(foreground: string, background: string): number {
  const lighter = Math.max(
    relativeLuminance(foreground),
    relativeLuminance(background)
  );
  const darker = Math.min(
    relativeLuminance(foreground),
    relativeLuminance(background)
  );
  return (lighter + 0.05) / (darker + 0.05);
}

export const ThemePresetSchema = z.strictObject({
  id: ThemePresetIdSchema,
  displayName: z.string().trim().min(1).max(80).refine(
    (value) => !/[\u0000-\u001f\u007f]/u.test(value),
    'Theme names must not contain control characters.'
  ),
  baseTheme: AppearanceThemeSchema,
  palette: ThemePaletteSchema
}).superRefine((theme, context) => {
  const checks = [
    ['text', theme.palette.text, theme.palette.surface, 4.5],
    ['muted text', theme.palette.textMuted, theme.palette.surface, 3],
    ['sidebar text', theme.palette.sidebarText, theme.palette.sidebar, 4.5],
    ['accent text', theme.palette.onAccent, theme.palette.accent, 4.5]
  ] as const;
  for (const [label, foreground, background, minimum] of checks) {
    if (themeContrast(foreground, background) < minimum) {
      context.addIssue({
        code: 'custom',
        path: ['palette'],
        message: `Theme ${label} contrast must be at least ${minimum}:1.`
      });
    }
  }
});

export const ThemePresetListSchema = z.strictObject({
  presets: z.array(ThemePresetSchema).max(64),
  rejectedCount: z.number().int().min(0).max(1_000_000)
});

export type LanguagePreference = z.infer<typeof LanguagePreferenceSchema>;
export type LocaleDirection = z.infer<typeof LocaleDirectionSchema>;
export type LocaleManifest = z.infer<typeof LocaleManifestSchema>;
export type LocaleSummary = z.infer<typeof LocaleSummarySchema>;
export type LocaleWarning = z.infer<typeof LocaleWarningSchema>;
export type LocalizationSnapshot = z.infer<typeof LocalizationSnapshotSchema>;
export type LocaleReloadResult = z.infer<typeof LocaleReloadResultSchema>;
export type LocalizationFolderOpenResult = z.infer<
  typeof LocalizationFolderOpenResultSchema
>;
export type ModsSettings = z.infer<typeof ModsSettingsSchema>;
export type ModsRootChooseResult = z.infer<typeof ModsRootChooseResultSchema>;
export type FontPreset = z.infer<typeof FontPresetSchema>;
export type FontPresetList = z.infer<typeof FontPresetListSchema>;
export type ThemePreset = z.infer<typeof ThemePresetSchema>;
export type ThemePresetList = z.infer<typeof ThemePresetListSchema>;

export const GeneralSettingsSchema = z.strictObject({
  version: z.literal(13),
  languagePreference: LanguagePreferenceSchema,
  showInformationalNotices: z.boolean(),
  showUnavailableWorkspaces: z.boolean(),
  showUnusableSessions: z.boolean(),
  autoTrustWorkspaces: z.boolean(),
  startMaximized: z.boolean(),
  checkProviderUpdatesAutomatically: z.boolean(),
  autoExpandSidebar: z.boolean(),
  windowCloseBehavior: z.enum(['quit', 'hide_to_tray']),
  remoteWindowCloseBehavior: z.enum(['keep_connected', 'disconnect']),
  warnBeforeApplicationQuit: z.boolean(),
  warnBeforeRemoteDisconnect: z.boolean(),
  crossAgentWorkflowEnabled: z.boolean(),
  crossAgentHandoffRetentionDays: z.number().int().min(1).max(365),
  enabledProviders: EnabledProviderIdsSchema,
  appearance: AppearanceSettingsSchema
});
export const GeneralSettingsChangedSchema = z.null();

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
  action: z.enum(['keep_running', 'disconnect']),
  suppressFutureWarning: z.boolean()
});
export const RemoteWindowCloseResultSchema = z.strictObject({
  closed: z.boolean()
});

export const ApplicationQuitRequestSchema = z.strictObject({
  localActiveAgentCount: z.number().int().nonnegative(),
  remoteActiveAgentCount: z.number().int().nonnegative(),
  totalActiveAgentCount: z.number().int().nonnegative()
}).superRefine((request, context) => {
  if (
    request.totalActiveAgentCount !==
      request.localActiveAgentCount + request.remoteActiveAgentCount
  ) {
    context.addIssue({
      code: 'custom',
      path: ['totalActiveAgentCount'],
      message: 'The total active-agent count must match its local and remote counts.'
    });
  }
});
export const ApplicationQuitResolutionSchema = z.strictObject({
  action: z.enum(['cancel', 'exit']),
  suppressFutureWarning: z.boolean()
});
export const ApplicationQuitResultSchema = z.strictObject({
  accepted: z.boolean()
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
export type ApplicationQuitRequest = z.infer<
  typeof ApplicationQuitRequestSchema
>;
export type ApplicationQuitResolution = z.infer<
  typeof ApplicationQuitResolutionSchema
>;

export type GeneralSettings = z.infer<typeof GeneralSettingsSchema>;

export const DEFAULT_GENERAL_SETTINGS: GeneralSettings = {
  version: 13,
  languagePreference: 'system',
  showInformationalNotices: true,
  showUnavailableWorkspaces: true,
  showUnusableSessions: true,
  autoTrustWorkspaces: false,
  startMaximized: true,
  checkProviderUpdatesAutomatically: true,
  autoExpandSidebar: true,
  windowCloseBehavior: 'quit',
  remoteWindowCloseBehavior: 'keep_connected',
  warnBeforeApplicationQuit: true,
  warnBeforeRemoteDisconnect: true,
  crossAgentWorkflowEnabled: false,
  crossAgentHandoffRetentionDays: 30,
  enabledProviders: [...PROVIDER_IDS],
  appearance: { ...DEFAULT_APPEARANCE_SETTINGS }
};

const VersionElevenAppearanceSettingsSchema = AppearanceSettingsSchema.omit({
  themePresetId: true
});

const VersionTwelveGeneralSettingsSchema = GeneralSettingsSchema.omit({
  version: true,
  autoTrustWorkspaces: true
}).extend({
  version: z.literal(12)
});

const VersionElevenGeneralSettingsSchema = VersionTwelveGeneralSettingsSchema.omit({
  version: true,
  appearance: true
}).extend({
  version: z.literal(11),
  appearance: VersionElevenAppearanceSettingsSchema
});

const VersionTenAppearanceSettingsSchema = VersionElevenAppearanceSettingsSchema.omit({
  interfaceFontFamily: true,
  terminalFontFamily: true
});

const VersionTenGeneralSettingsSchema = VersionTwelveGeneralSettingsSchema.omit({
  version: true,
  appearance: true
}).extend({
  version: z.literal(10),
  appearance: VersionTenAppearanceSettingsSchema
});

const VersionNineGeneralSettingsSchema = VersionTenGeneralSettingsSchema.omit({
  version: true,
  languagePreference: true
}).extend({ version: z.literal(9) });

const VersionEightGeneralSettingsSchema = VersionNineGeneralSettingsSchema.omit({
  version: true,
  warnBeforeApplicationQuit: true,
  warnBeforeRemoteDisconnect: true
}).extend({ version: z.literal(8) });

const VersionSevenGeneralSettingsSchema = z.strictObject({
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
  appearance: VersionTenAppearanceSettingsSchema
});

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
  appearance: VersionTenAppearanceSettingsSchema
});

const VersionFiveAppearanceSettingsSchema = VersionTenAppearanceSettingsSchema
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

  const versionTwelve = VersionTwelveGeneralSettingsSchema.safeParse(value);
  if (versionTwelve.success) {
    return GeneralSettingsSchema.parse({
      ...versionTwelve.data,
      version: 13,
      autoTrustWorkspaces: false
    });
  }

  const versionEleven = VersionElevenGeneralSettingsSchema.safeParse(value);
  if (versionEleven.success) {
    return GeneralSettingsSchema.parse({
      ...versionEleven.data,
      version: 13,
      autoTrustWorkspaces: false,
      appearance: {
        ...DEFAULT_APPEARANCE_SETTINGS,
        ...versionEleven.data.appearance
      }
    });
  }

  const versionTen = VersionTenGeneralSettingsSchema.safeParse(value);
  if (versionTen.success) {
    return GeneralSettingsSchema.parse({
      ...versionTen.data,
      version: 13,
      autoTrustWorkspaces: false,
      appearance: {
        ...DEFAULT_APPEARANCE_SETTINGS,
        ...versionTen.data.appearance
      }
    });
  }

  const versionNine = VersionNineGeneralSettingsSchema.safeParse(value);
  if (versionNine.success) {
    return GeneralSettingsSchema.parse({
      ...versionNine.data,
      version: 13,
      autoTrustWorkspaces: false,
      languagePreference: 'system',
      appearance: {
        ...DEFAULT_APPEARANCE_SETTINGS,
        ...versionNine.data.appearance
      }
    });
  }

  const versionEight = VersionEightGeneralSettingsSchema.safeParse(value);
  if (versionEight.success) {
    return GeneralSettingsSchema.parse({
      ...versionEight.data,
      version: 13,
      autoTrustWorkspaces: false,
      languagePreference: 'system',
      warnBeforeApplicationQuit: true,
      warnBeforeRemoteDisconnect: true,
      appearance: {
        ...DEFAULT_APPEARANCE_SETTINGS,
        ...versionEight.data.appearance
      }
    });
  }

  const versionSeven = VersionSevenGeneralSettingsSchema.safeParse(value);
  if (versionSeven.success) {
    return GeneralSettingsSchema.parse({
      ...DEFAULT_GENERAL_SETTINGS,
      ...versionSeven.data,
      version: 13,
      showUnavailableWorkspaces: true,
      showUnusableSessions: true,
      appearance: {
        ...DEFAULT_APPEARANCE_SETTINGS,
        ...versionSeven.data.appearance
      }
    });
  }

  const versionSix = VersionSixGeneralSettingsSchema.safeParse(value);
  if (versionSix.success) {
    return GeneralSettingsSchema.parse({
      ...DEFAULT_GENERAL_SETTINGS,
      ...versionSix.data,
      version: 13,
      remoteWindowCloseBehavior: 'keep_connected',
      showUnavailableWorkspaces: true,
      showUnusableSessions: true,
      appearance: {
        ...DEFAULT_APPEARANCE_SETTINGS,
        ...versionSix.data.appearance
      }
    });
  }

  const versionFive = VersionFiveGeneralSettingsSchema.safeParse(value);
  if (versionFive.success) {
    return GeneralSettingsSchema.parse({
      ...DEFAULT_GENERAL_SETTINGS,
      ...versionFive.data,
      version: 13,
      remoteWindowCloseBehavior: 'keep_connected',
      showUnavailableWorkspaces: true,
      showUnusableSessions: true,
      appearance: {
        ...DEFAULT_APPEARANCE_SETTINGS,
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
      version: 13
    });
  }

  const versionThree = VersionThreeGeneralSettingsSchema.safeParse(value);
  if (versionThree.success) {
    return GeneralSettingsSchema.parse({
      ...DEFAULT_GENERAL_SETTINGS,
      ...versionThree.data,
      version: 13
    });
  }

  const versionTwo = VersionTwoGeneralSettingsSchema.safeParse(value);
  if (versionTwo.success) {
    return GeneralSettingsSchema.parse({
      ...DEFAULT_GENERAL_SETTINGS,
      ...versionTwo.data,
      version: 13
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
const DEFAULT_OPEN_REMOTE = controlShortcut('Digit5');
const DEFAULT_OPEN_SETTINGS = controlShortcut('Comma');
const FORMER_DEFAULT_OPEN_SETTINGS = controlShortcut('Digit5');
const FORMER_DEFAULT_OPEN_SETTINGS_ALIAS = controlShortcut('Comma');

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
  openSettings: KeyboardShortcutChordSchema.default(FORMER_DEFAULT_OPEN_SETTINGS),
  openSettingsAlias: KeyboardShortcutChordSchema.default(
    FORMER_DEFAULT_OPEN_SETTINGS_ALIAS
  )
});

const VersionTwoKeyboardSettingsSchema = z.strictObject({
  version: z.literal(2),
  terminalSwitcher: KeyboardShortcutChordSchema,
  openTerminals: KeyboardShortcutChordSchema.default(DEFAULT_OPEN_TERMINALS),
  toggleSidebar: KeyboardShortcutChordSchema.default(DEFAULT_TOGGLE_SIDEBAR),
  openHome: KeyboardShortcutChordSchema.default(DEFAULT_OPEN_HOME),
  openWorkspaces: KeyboardShortcutChordSchema.default(DEFAULT_OPEN_WORKSPACES),
  openSessions: KeyboardShortcutChordSchema.default(DEFAULT_OPEN_SESSIONS),
  openProfiles: KeyboardShortcutChordSchema.default(DEFAULT_OPEN_PROFILES),
  openSettings: KeyboardShortcutChordSchema.default(FORMER_DEFAULT_OPEN_SETTINGS),
  openSettingsAlias: KeyboardShortcutChordSchema.default(
    FORMER_DEFAULT_OPEN_SETTINGS_ALIAS
  )
});

export const KeyboardSettingsSchema = z.strictObject({
  version: z.literal(3),
  terminalSwitcher: KeyboardShortcutChordSchema,
  openTerminals: KeyboardShortcutChordSchema.default(DEFAULT_OPEN_TERMINALS),
  toggleSidebar: KeyboardShortcutChordSchema.default(DEFAULT_TOGGLE_SIDEBAR),
  openHome: KeyboardShortcutChordSchema.default(DEFAULT_OPEN_HOME),
  openWorkspaces: KeyboardShortcutChordSchema.default(DEFAULT_OPEN_WORKSPACES),
  openSessions: KeyboardShortcutChordSchema.default(DEFAULT_OPEN_SESSIONS),
  openProfiles: KeyboardShortcutChordSchema.default(DEFAULT_OPEN_PROFILES),
  openRemote: KeyboardShortcutChordSchema.default(DEFAULT_OPEN_REMOTE),
  openSettings: KeyboardShortcutChordSchema.default(DEFAULT_OPEN_SETTINGS)
});

export type KeyboardSettings = z.infer<typeof KeyboardSettingsSchema>;

export const DEFAULT_KEYBOARD_SETTINGS = {
  version: 3,
  terminalSwitcher: DEFAULT_TERMINAL_SWITCHER,
  openTerminals: DEFAULT_OPEN_TERMINALS,
  toggleSidebar: DEFAULT_TOGGLE_SIDEBAR,
  openHome: DEFAULT_OPEN_HOME,
  openWorkspaces: DEFAULT_OPEN_WORKSPACES,
  openSessions: DEFAULT_OPEN_SESSIONS,
  openProfiles: DEFAULT_OPEN_PROFILES,
  openRemote: DEFAULT_OPEN_REMOTE,
  openSettings: DEFAULT_OPEN_SETTINGS
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

  const versionTwo = VersionTwoKeyboardSettingsSchema.safeParse(value);
  if (versionTwo.success) return migrateLegacyKeyboardSettings(versionTwo.data);

  const versionOne = VersionOneKeyboardSettingsSchema.safeParse(value);
  if (!versionOne.success) {
    return KeyboardSettingsSchema.parse(DEFAULT_KEYBOARD_SETTINGS);
  }

  return migrateLegacyKeyboardSettings(versionOne.data, {
    openTerminals: shortcutChordEquals(
      versionOne.data.openTerminals,
      FORMER_DEFAULT_OPEN_TERMINALS
    )
      ? DEFAULT_OPEN_TERMINALS
      : versionOne.data.openTerminals
  });
}

function migrateLegacyKeyboardSettings(
  legacy:
    | z.infer<typeof VersionOneKeyboardSettingsSchema>
    | z.infer<typeof VersionTwoKeyboardSettingsSchema>,
  overrides: Partial<Pick<KeyboardSettings, 'openTerminals'>> = {}
): KeyboardSettings {
  const primaryCustomized = !shortcutChordEquals(
    legacy.openSettings,
    FORMER_DEFAULT_OPEN_SETTINGS
  );
  const aliasCustomized = !shortcutChordEquals(
    legacy.openSettingsAlias,
    FORMER_DEFAULT_OPEN_SETTINGS_ALIAS
  );
  const candidate = primaryCustomized
    ? legacy.openSettings
    : aliasCustomized
      ? legacy.openSettingsAlias
      : DEFAULT_OPEN_SETTINGS;
  const openSettings = shortcutChordEquals(candidate, DEFAULT_OPEN_REMOTE)
    ? DEFAULT_OPEN_SETTINGS
    : candidate;

  return KeyboardSettingsSchema.parse({
    version: 3,
    terminalSwitcher: legacy.terminalSwitcher,
    openTerminals: overrides.openTerminals ?? legacy.openTerminals,
    toggleSidebar: legacy.toggleSidebar,
    openHome: legacy.openHome,
    openWorkspaces: legacy.openWorkspaces,
    openSessions: legacy.openSessions,
    openProfiles: legacy.openProfiles,
    openRemote: DEFAULT_OPEN_REMOTE,
    openSettings
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

export const AgentInteractionRouteSchema = z.enum([
  'automatic',
  'unified',
  'pty'
]);

const LaunchRequestBaseFields = {
  interactionRoute: AgentInteractionRouteSchema.default('automatic'),
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

// This is the caller-facing shape. Schema defaults (including interactionRoute)
// are applied at the IPC/service boundary before a launch is prepared.
export type LaunchPrepareRequest = z.input<typeof LaunchPrepareRequestSchema>;
export type LaunchPreview = z.infer<typeof LaunchPreviewSchema>;
export type AgentInteractionRoute = z.infer<typeof AgentInteractionRouteSchema>;

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
export const AgentLaunchRouteReasonSchema = z.enum([
  'verified',
  'disabled',
  'unavailable',
  'incompatible',
  'failed',
  'timed_out',
  'unsupported_launch',
  'structured_failed',
  'explicit_pty'
]);
export const AgentRuntimeStartResultSchema = z.discriminatedUnion('mode', [
  z.strictObject({
    mode: z.literal('pty'),
    routeReason: AgentLaunchRouteReasonSchema,
    runtime: RuntimeSummarySchema
  }),
  z.strictObject({
    mode: z.literal('structured'),
    routeReason: z.literal('verified'),
    runtime: StructuredAgentRuntimeSummarySchema
  })
]);
export const RuntimeIdRequestSchema = z.strictObject({
  runtimeId: RuntimeIdSchema
});
export const RuntimeStartRequestSchema = z.strictObject({
  launchToken: z.uuid()
});
export const AgentRuntimeStartRequestSchema = z.strictObject({
  launchToken: z.uuid(),
  operationId: z.uuid()
});
export const AgentRuntimeCancelRequestSchema = z.strictObject({
  operationId: z.uuid()
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
export type AgentRuntimeStartResult = z.infer<
  typeof AgentRuntimeStartResultSchema
>;
export type RuntimeIdRequest = z.infer<typeof RuntimeIdRequestSchema>;
export type RuntimeStartRequest = z.infer<typeof RuntimeStartRequestSchema>;
export type AgentRuntimeStartRequest = z.infer<
  typeof AgentRuntimeStartRequestSchema
>;
export type AgentRuntimeCancelRequest = z.infer<
  typeof AgentRuntimeCancelRequestSchema
>;
export type RuntimeWriteRequest = z.infer<typeof RuntimeWriteRequestSchema>;
export type RuntimeResizeRequest = z.infer<typeof RuntimeResizeRequestSchema>;
export type RuntimeAttachment = z.infer<typeof RuntimeAttachmentSchema>;
export type RuntimeEvent = z.infer<typeof RuntimeEventSchema>;

export const ClipboardTextSchema = z.string().max(4_194_304);

export const TerminalClipboardReadRequestSchema = RuntimeIdRequestSchema;
export const TerminalClipboardReadResultSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('empty') }),
  z.strictObject({ kind: z.literal('text'), text: ClipboardTextSchema }),
  z.strictObject({
    kind: z.literal('image'),
    pasteText: z.string().min(1).max(8_192)
  })
]);

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
export type TerminalClipboardReadRequest = z.infer<
  typeof TerminalClipboardReadRequestSchema
>;
export type TerminalClipboardReadResult = z.infer<
  typeof TerminalClipboardReadResultSchema
>;

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
  background: AppearanceBackgroundStateSchema,
  themePreset: ThemePresetSchema.nullable()
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
  applicationQuitRequest: 'lumora:application:quit-request',
  applicationQuitResolve: 'lumora:application:quit-resolve',
  remoteTargetWindowOpen: 'lumora:targets:window:open',
  systemInfo: 'lumora:system:info',
  applicationAboutGet: 'lumora:application:about:get',
  applicationReleaseStatusGet: 'lumora:application:release:status:get',
  applicationProjectOpen: 'lumora:application:project:open',
  applicationReleaseOpen: 'lumora:application:release:open',
  startupPresentationClaim: 'lumora:system:startup-presentation:claim',
  startupPresentationComplete: 'lumora:system:startup-presentation:complete',
  diagnosticSummaryGet: 'lumora:diagnostics:summary:get',
  diagnosticBundleExport: 'lumora:diagnostics:bundle:export',
  diagnosticStorageGet: 'lumora:diagnostics:storage:get',
  diagnosticJournalDirectoryChoose: 'lumora:diagnostics:journal-directory:choose',
  diagnosticJournalDirectoryReset: 'lumora:diagnostics:journal-directory:reset',
  diagnosticExportDirectoryChoose: 'lumora:diagnostics:export-directory:choose',
  diagnosticExportDirectoryReset: 'lumora:diagnostics:export-directory:reset',
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
  workspaceVisibilityGet: 'lumora:workspace-visibility:get',
  workspaceVisibilitySet: 'lumora:workspace-visibility:set',
  workspaceVisibilityRestore: 'lumora:workspace-visibility:restore',
  workspaceVisibilityRestoreAll: 'lumora:workspace-visibility:restore-all',
  trayResumeSession: 'lumora:tray:resume-session',
  clipboardTextRead: 'lumora:clipboard:text:read',
  clipboardTextWrite: 'lumora:clipboard:text:write',
  terminalClipboardRead: 'lumora:clipboard:terminal:read',
  appearancePresentationGet: 'lumora:appearance:presentation:get',
  appearanceBackgroundGet: 'lumora:appearance:background:get',
  appearanceBackgroundChoose: 'lumora:appearance:background:choose',
  appearanceBackgroundRemove: 'lumora:appearance:background:remove',
  localizationSnapshotGet: 'lumora:localization:snapshot:get',
  localizationReload: 'lumora:localization:reload',
  localizationUserFolderOpen: 'lumora:localization:user-folder:open',
  localizationChanged: 'lumora:localization:changed',
  modsSettingsGet: 'lumora:mods:settings:get',
  modsRootChoose: 'lumora:mods:root:choose',
  modsRootReset: 'lumora:mods:root:reset',
  modsRootOpen: 'lumora:mods:root:open',
  fontPresetsGet: 'lumora:mods:fonts:get',
  fontPresetFolderOpen: 'lumora:mods:fonts:folder:open',
  themePresetsGet: 'lumora:mods:themes:get',
  themePresetFolderOpen: 'lumora:mods:themes:folder:open',
  terminalProfilesGet: 'lumora:terminal:profiles:get',
  terminalProfileSave: 'lumora:terminal:profiles:save',
  terminalProfileDelete: 'lumora:terminal:profiles:delete',
  providerLaunchConfigsGet: 'lumora:terminal:provider-launch-configs:get',
  providerLaunchConfigSave: 'lumora:terminal:provider-launch-configs:save',
  launchSettingsLayersGet: 'lumora:terminal:launch-settings:get',
  launchSettingsLayerSave: 'lumora:terminal:launch-settings:save',
  generalSettingsGet: 'lumora:terminal:general-settings:get',
  generalSettingsSave: 'lumora:terminal:general-settings:save',
  generalSettingsChanged: 'lumora:terminal:general-settings:changed',
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
  agentRuntimeStart: 'lumora:agent:runtime:start-prepared',
  agentRuntimeCancelStart: 'lumora:agent:runtime:cancel-start',
  structuredCapabilityScan: 'lumora:agent:capabilities:scan',
  structuredPreferencesGet: 'lumora:agent:preferences:get',
  structuredPreferenceSave: 'lumora:agent:preferences:save',
  structuredRuntimeLaunch: 'lumora:agent:runtime:launch',
  structuredRuntimeList: 'lumora:agent:runtime:list',
  structuredRuntimeSnapshot: 'lumora:agent:runtime:snapshot',
  structuredRuntimeAction: 'lumora:agent:runtime:action',
  structuredRuntimeReconnect: 'lumora:agent:runtime:reconnect',
  structuredRuntimeClose: 'lumora:agent:runtime:close',
  structuredRuntimeEvent: 'lumora:agent:runtime:event',
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
  getLocalizationSnapshot(): Promise<LocalizationSnapshot>;
  reloadLocalization(): Promise<LocaleReloadResult>;
  openUserLocaleFolder(): Promise<void>;
  getModsSettings(): Promise<ModsSettings>;
  chooseModsRoot(): Promise<ModsRootChooseResult>;
  resetModsRoot(): Promise<ModsSettings>;
  openModsRoot(): Promise<void>;
  getFontPresets(): Promise<FontPresetList>;
  openFontPresetFolder(): Promise<void>;
  getThemePresets(): Promise<ThemePresetList>;
  openThemePresetFolder(): Promise<void>;
  onLocalizationChanged(
    listener: (snapshot: LocalizationSnapshot) => void
  ): () => void;
  onApplicationQuitRequest(
    listener: (request: ApplicationQuitRequest) => void
  ): () => void;
  resolveApplicationQuit(
    resolution: ApplicationQuitResolution
  ): Promise<boolean>;
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
  getDiagnosticSummary(): Promise<DiagnosticSummary>;
  exportDiagnosticBundle(): Promise<DiagnosticExportResult>;
  getDiagnosticStorageSettings(): Promise<DiagnosticStorageSettings>;
  chooseDiagnosticJournalDirectory(): Promise<DiagnosticStorageSettings>;
  resetDiagnosticJournalDirectory(): Promise<DiagnosticStorageSettings>;
  chooseDiagnosticExportDirectory(): Promise<DiagnosticStorageSettings>;
  resetDiagnosticExportDirectory(): Promise<DiagnosticStorageSettings>;
  getSystemInfo(): Promise<SystemInfo>;
  getApplicationAboutInfo(): Promise<ApplicationAboutInfo>;
  getApplicationReleaseStatus(): Promise<ApplicationReleaseStatus>;
  openLumoraProjectPage(): Promise<ExternalOpenResult>;
  openApplicationReleasePage(): Promise<ExternalOpenResult>;
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
  getWorkspaceVisibilityPolicies(): Promise<WorkspaceVisibilityPolicy[]>;
  setWorkspaceVisibilityPolicy(
    input: WorkspaceVisibilitySetRequest
  ): Promise<WorkspaceVisibilityPolicy[]>;
  restoreWorkspaceVisibility(
    input: WorkspaceVisibilityRestoreRequest
  ): Promise<WorkspaceVisibilityPolicy[]>;
  restoreAllWorkspaceVisibility(): Promise<WorkspaceVisibilityPolicy[]>;
  onTrayResumeSessionRequested(
    listener: (sessionId: string) => void
  ): () => void;
  readClipboardText(): Promise<string>;
  readTerminalClipboard(runtimeId: string): Promise<TerminalClipboardReadResult>;
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
  onGeneralSettingsChanged(listener: () => void): () => void;
  getKeyboardSettings(): Promise<KeyboardSettings>;
  saveKeyboardSettings(input: KeyboardSettings): Promise<KeyboardSettings>;
  prepareLaunch(input: LaunchPrepareRequest): Promise<LaunchPreview>;
  getWorkspaceTrustDecisions(): Promise<WorkspaceTrustDecision[]>;
  trustWorkspaceForLaunch(
    launchToken: string
  ): Promise<WorkspaceTrustDecision>;
  revokeWorkspaceTrust(workspaceId: string): Promise<WorkspaceTrustDecision[]>;
  startRuntime(launchToken: string): Promise<RuntimeSummary>;
  startAgentRuntime(
    launchToken: string,
    operationId: string
  ): Promise<AgentRuntimeStartResult>;
  cancelAgentRuntimeStart(operationId: string): Promise<void>;
  listRuntimes(): Promise<RuntimeSummary[]>;
  attachRuntime(runtimeId: string): Promise<RuntimeAttachment>;
  writeRuntime(input: RuntimeWriteRequest): Promise<void>;
  resizeRuntime(input: RuntimeResizeRequest): Promise<void>;
  terminateRuntime(runtimeId: string): Promise<RuntimeSummary>;
  openTerminalLink(url: string): Promise<void>;
  onRuntimeEvent(listener: (event: RuntimeEvent) => void): () => void;
  scanStructuredProviderCapabilities(
    fresh?: boolean
  ): Promise<StructuredProviderCapabilityReport[]>;
  getStructuredProviderPreferences(): Promise<StructuredProviderPreference[]>;
  saveStructuredProviderPreference(
    input: StructuredProviderPreference
  ): Promise<StructuredProviderPreference[]>;
  launchStructuredRuntime(
    request: StructuredAgentLaunchRequest
  ): Promise<StructuredAgentRuntimeSummary>;
  listStructuredRuntimes(): Promise<StructuredAgentRuntimeSummary[]>;
  getStructuredRuntimeSnapshot(
    connectionId: string
  ): Promise<StructuredAgentRuntimeSnapshot>;
  dispatchStructuredAgentAction(action: StructuredAgentAction): Promise<void>;
  reconnectStructuredRuntime(
    connectionId: string
  ): Promise<StructuredAgentRuntimeSummary>;
  closeStructuredRuntime(
    connectionId: string
  ): Promise<StructuredAgentRuntimeSummary>;
  onStructuredAgentEvent(
    listener: (event: StructuredAgentEvent) => void
  ): () => void;
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
