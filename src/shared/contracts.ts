import { z } from 'zod';

export const PlatformSchema = z.enum(['win32', 'darwin', 'linux']);

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

export const GeneralSettingsSchema = z.strictObject({
  version: z.literal(1),
  showInformationalNotices: z.boolean()
});

export type GeneralSettings = z.infer<typeof GeneralSettingsSchema>;

export const DEFAULT_GENERAL_SETTINGS = {
  version: 1,
  showInformationalNotices: true
} as const satisfies GeneralSettings;

const controlShortcut = (code: string): KeyboardShortcutChord => ({
  code,
  control: true,
  alt: false,
  shift: false,
  meta: false
});

const DEFAULT_TERMINAL_SWITCHER = controlShortcut('Tab');
const DEFAULT_OPEN_TERMINALS = controlShortcut('KeyT');
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

export const KeyboardSettingsSchema = z.strictObject({
  version: z.literal(1),
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
  version: 1,
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

const TerminalDimensionsFields = {
  cols: z.number().int().min(20).max(500),
  rows: z.number().int().min(5).max(300)
};

const LaunchRequestBaseFields = {
  terminalProfileId: StableIdSchema.nullable().default(null),
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

export const ClipboardWriteResultSchema = z.strictObject({
  accepted: z.literal(true)
});

export type ClipboardText = z.infer<typeof ClipboardTextSchema>;

export const IPC_CHANNELS = {
  systemInfo: 'lumora:system:info',
  startupPresentationClaim: 'lumora:system:startup-presentation:claim',
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
  clipboardTextRead: 'lumora:clipboard:text:read',
  clipboardTextWrite: 'lumora:clipboard:text:write',
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
  runtimeEvent: 'lumora:terminal:runtime:event'
} as const;

export interface LumoraApi {
  getSystemInfo(): Promise<SystemInfo>;
  claimStartupPresentation(): Promise<boolean>;
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
  readClipboardText(): Promise<string>;
  writeClipboardText(text: string): Promise<void>;
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
  onRuntimeEvent(listener: (event: RuntimeEvent) => void): () => void;
}
