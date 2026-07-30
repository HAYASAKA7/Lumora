import { z } from 'zod';

const TRANSFER_PROVIDER_IDS = [
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

const TransferProviderIdSchema = z.enum(TRANSFER_PROVIDER_IDS);
const TransferPlatformSchema = z.enum(['win32', 'darwin', 'linux']);
const StableIdSchema = z.string().regex(/^[a-f0-9]{64}$/);
const BoundedMessageSchema = z.string().trim().min(1).max(512);
const CountSchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const ByteCountSchema = CountSchema;

function uniqueValues(
  values: readonly string[],
  context: z.RefinementCtx,
  path: PropertyKey[] = []
): void {
  if (new Set(values).size !== values.length) {
    context.addIssue({
      code: 'custom',
      path,
      message: 'Values must be unique.'
    });
  }
}

const ProviderListSchema = z
  .array(TransferProviderIdSchema)
  .min(1)
  .max(TRANSFER_PROVIDER_IDS.length)
  .superRefine((providers, context) => uniqueValues(providers, context));

export const TransferOperationTokenSchema = z.uuid();
export const TransferSessionIdSchema = StableIdSchema;
export const TransferProtectionSchema = z.discriminatedUnion('encrypted', [
  z.strictObject({ encrypted: z.literal(false) }),
  z.strictObject({
    encrypted: z.literal(true),
    password: z.string().min(1).max(1_024)
  })
]);

export const SessionExportPrepareRequestSchema = z
  .strictObject({
    sessionIds: z.array(TransferSessionIdSchema).min(1).max(25_000)
  })
  .superRefine((value, context) => {
    uniqueValues(value.sessionIds, context, ['sessionIds']);
  });

export const TransferSupportSchema = z.enum([
  'supported',
  'experimental',
  'provider_not_installed',
  'provider_disabled',
  'route_unverified',
  'provider_version_unsupported'
]);

export const TransferSkipReasonSchema = z.enum([
  'running',
  'duplicate',
  'provider_not_installed',
  'provider_disabled',
  'route_unverified',
  'workspace_unresolved',
  'source_unavailable',
  'source_changed'
]);

export const SessionTransferRouteCapabilitySchema = z.strictObject({
  sourcePlatform: TransferPlatformSchema,
  destinationPlatform: TransferPlatformSchema,
  support: TransferSupportSchema
});

export const SessionTransferCapabilitySchema = z.strictObject({
  provider: TransferProviderIdSchema,
  displayName: z.string().trim().min(1).max(80),
  exportSupport: TransferSupportSchema,
  routes: z.array(SessionTransferRouteCapabilitySchema).max(9),
  installGuidance: BoundedMessageSchema.nullable()
});

export const SessionTransferCapabilityListSchema = z
  .array(SessionTransferCapabilitySchema)
  .max(TRANSFER_PROVIDER_IDS.length)
  .superRefine((capabilities, context) =>
    uniqueValues(
      capabilities.map((capability) => capability.provider),
      context
    )
  );

export const SessionTransferPlannedSessionSchema = z.strictObject({
  sessionId: TransferSessionIdSchema,
  nativeSessionId: z.string().trim().min(1).max(256),
  provider: TransferProviderIdSchema,
  title: z.string().trim().min(1).max(256),
  workspaceId: StableIdSchema,
  estimatedBytes: ByteCountSchema
});

export const SessionTransferSkippedSessionSchema = z.strictObject({
  sessionId: TransferSessionIdSchema,
  provider: TransferProviderIdSchema,
  reason: TransferSkipReasonSchema,
  message: BoundedMessageSchema
});

export const SessionExportPlanSchema = z.strictObject({
  planToken: TransferOperationTokenSchema,
  sessions: z.array(SessionTransferPlannedSessionSchema).max(25_000),
  skipped: z.array(SessionTransferSkippedSessionSchema).max(25_000),
  estimatedBytes: ByteCountSchema,
  expiresAt: z.iso.datetime()
});

export const SessionExportExecuteRequestSchema = z.strictObject({
  planToken: TransferOperationTokenSchema,
  protection: TransferProtectionSchema
});

export const SessionTransferArchiveSelectionSchema = z.strictObject({
  selectionToken: TransferOperationTokenSchema,
  fileName: z.string().trim().min(1).max(512),
  encrypted: z.boolean()
});

export const SessionImportInspectRequestSchema = z.strictObject({
  selectionToken: TransferOperationTokenSchema,
  password: z.string().min(1).max(1_024).optional()
});

export const SessionImportProviderInspectionSchema = z.strictObject({
  provider: TransferProviderIdSchema,
  displayName: z.string().trim().min(1).max(80),
  sessionCount: CountSchema,
  support: TransferSupportSchema,
  installGuidance: BoundedMessageSchema.nullable()
});

export const SessionImportWorkspaceInspectionSchema = z.strictObject({
  sourceWorkspaceKey: z.string().trim().min(1).max(512),
  displayName: z.string().trim().min(1).max(256),
  originalPath: z.string().min(1).max(32_768),
  sessionCount: CountSchema,
  suggestedWorkspaceId: StableIdSchema.nullable(),
  confidence: z.enum(['high', 'ambiguous', 'none'])
});

export const SessionImportInspectionSchema = z.strictObject({
  inspectionToken: TransferOperationTokenSchema,
  archiveName: z.string().trim().min(1).max(512),
  encrypted: z.boolean(),
  sourcePlatform: TransferPlatformSchema,
  providers: z
    .array(SessionImportProviderInspectionSchema)
    .max(TRANSFER_PROVIDER_IDS.length),
  workspaces: z.array(SessionImportWorkspaceInspectionSchema).max(25_000),
  sessionCount: CountSchema.max(25_000),
  expiresAt: z.iso.datetime()
});

export const SessionWorkspaceMappingSchema = z.discriminatedUnion('action', [
  z.strictObject({
    sourceWorkspaceKey: z.string().trim().min(1).max(512),
    action: z.literal('map'),
    destinationWorkspaceId: StableIdSchema
  }),
  z.strictObject({
    sourceWorkspaceKey: z.string().trim().min(1).max(512),
    action: z.literal('skip')
  })
]);

export const SessionImportPlanRequestSchema = z
  .strictObject({
    inspectionToken: TransferOperationTokenSchema,
    providers: ProviderListSchema,
    workspaceMappings: z.array(SessionWorkspaceMappingSchema).max(25_000)
  })
  .superRefine((request, context) => {
    uniqueValues(
      request.workspaceMappings.map((mapping) => mapping.sourceWorkspaceKey),
      context,
      ['workspaceMappings']
    );
  });

export const SessionImportPlanSchema = z.strictObject({
  planToken: TransferOperationTokenSchema,
  ready: z.array(SessionTransferPlannedSessionSchema).max(25_000),
  skipped: z.array(SessionTransferSkippedSessionSchema).max(25_000),
  providers: ProviderListSchema,
  expiresAt: z.iso.datetime()
});

export const SessionImportExecuteRequestSchema = z.strictObject({
  planToken: TransferOperationTokenSchema
});

export const SessionTransferDirectionSchema = z.enum(['export', 'import']);
export const SessionTransferProgressPhaseSchema = z.enum([
  'preparing',
  'authenticating',
  'reading',
  'writing',
  'verifying',
  'cleaning_up',
  'completed',
  'cancelled'
]);

export const SessionTransferProgressEventSchema = z
  .strictObject({
    operationId: TransferOperationTokenSchema,
    direction: SessionTransferDirectionSchema,
    phase: SessionTransferProgressPhaseSchema,
    completed: CountSchema,
    total: CountSchema,
    message: BoundedMessageSchema
  })
  .superRefine((event, context) => {
    if (event.completed > event.total) {
      context.addIssue({
        code: 'custom',
        path: ['completed'],
        message: 'Completed work cannot exceed total work.'
      });
    }
  });

export const SessionTransferResultItemSchema = z.strictObject({
  sessionId: TransferSessionIdSchema.nullable(),
  provider: TransferProviderIdSchema,
  status: z.enum(['exported', 'imported', 'skipped', 'failed']),
  reason: TransferSkipReasonSchema.nullable(),
  message: BoundedMessageSchema
});

export const SessionTransferResultSchema = z.strictObject({
  operationId: TransferOperationTokenSchema,
  direction: SessionTransferDirectionSchema,
  completedAt: z.iso.datetime(),
  status: z.enum(['completed', 'partial', 'cancelled', 'failed']),
  importedCount: CountSchema,
  exportedCount: CountSchema,
  skippedCount: CountSchema,
  failedCount: CountSchema,
  providers: ProviderListSchema,
  items: z.array(SessionTransferResultItemSchema).max(25_000)
});

export const TransferHistoryEntrySchema = z.strictObject({
  id: TransferOperationTokenSchema,
  direction: SessionTransferDirectionSchema,
  completedAt: z.iso.datetime(),
  importedCount: CountSchema,
  exportedCount: CountSchema,
  skippedCount: CountSchema,
  providers: ProviderListSchema
});

export const TransferHistoryListSchema = z
  .array(TransferHistoryEntrySchema)
  .max(25);

export const TransferOperationCancelRequestSchema = z.strictObject({
  operationId: TransferOperationTokenSchema
});

export const TransferOperationCancelResultSchema = z.strictObject({
  accepted: z.literal(true)
});

export type TransferOperationToken = z.infer<typeof TransferOperationTokenSchema>;
export type TransferProtection = z.infer<typeof TransferProtectionSchema>;
export type TransferSupport = z.infer<typeof TransferSupportSchema>;
export function isUsableTransferSupport(support: TransferSupport): boolean {
  return support === 'supported' || support === 'experimental';
}
export type TransferSkipReason = z.infer<typeof TransferSkipReasonSchema>;
export type SessionTransferCapability = z.infer<
  typeof SessionTransferCapabilitySchema
>;
export type SessionExportPrepareRequest = z.infer<
  typeof SessionExportPrepareRequestSchema
>;
export type SessionExportPlan = z.infer<typeof SessionExportPlanSchema>;
export type SessionExportExecuteRequest = z.infer<
  typeof SessionExportExecuteRequestSchema
>;
export type SessionTransferArchiveSelection = z.infer<
  typeof SessionTransferArchiveSelectionSchema
>;
export type SessionImportInspectRequest = z.infer<
  typeof SessionImportInspectRequestSchema
>;
export type SessionImportInspection = z.infer<
  typeof SessionImportInspectionSchema
>;
export type SessionWorkspaceMapping = z.infer<
  typeof SessionWorkspaceMappingSchema
>;
export type SessionImportPlanRequest = z.infer<
  typeof SessionImportPlanRequestSchema
>;
export type SessionImportPlan = z.infer<typeof SessionImportPlanSchema>;
export type SessionImportExecuteRequest = z.infer<
  typeof SessionImportExecuteRequestSchema
>;
export type SessionTransferProgressEvent = z.infer<
  typeof SessionTransferProgressEventSchema
>;
export type SessionTransferResult = z.infer<
  typeof SessionTransferResultSchema
>;
export type TransferHistoryEntry = z.infer<
  typeof TransferHistoryEntrySchema
>;
export type TransferOperationCancelRequest = z.infer<
  typeof TransferOperationCancelRequestSchema
>;
