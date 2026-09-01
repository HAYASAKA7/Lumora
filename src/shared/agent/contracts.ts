import { z } from 'zod';

export const STRUCTURED_AGENT_PROVIDER_IDS = [
  'codex',
  'claude',
  'gemini'
] as const;

export const StructuredAgentProviderIdSchema = z.enum(
  STRUCTURED_AGENT_PROVIDER_IDS
);

const OpaqueIdSchema = z.string()
  .trim()
  .min(1)
  .max(256)
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/);
const DisplayTextSchema = z.string().trim().min(1).max(512);
const EventTextSchema = z.string().min(1).max(65_536);

const EventEnvelopeFields = {
  connectionId: OpaqueIdSchema,
  providerId: StructuredAgentProviderIdSchema,
  nativeSessionId: OpaqueIdSchema.nullable(),
  turnId: OpaqueIdSchema,
  eventId: OpaqueIdSchema,
  parentEventId: OpaqueIdSchema.nullable(),
  sequence: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  generation: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  timestamp: z.iso.datetime()
};

const RuntimeStatusEventSchema = z.strictObject({
  ...EventEnvelopeFields,
  kind: z.literal('runtime.status'),
  payload: z.strictObject({
    state: z.enum(['starting', 'ready', 'reconnecting', 'closed', 'failed']),
    message: z.string().trim().min(1).max(512).nullable()
  })
});

const RuntimeMetadataEventSchema = z.strictObject({
  ...EventEnvelopeFields,
  kind: z.literal('runtime.metadata'),
  payload: z.strictObject({
    catalogSessionId: OpaqueIdSchema,
    title: DisplayTextSchema
  })
});

const RuntimeCommandsEventSchema = z.strictObject({
  ...EventEnvelopeFields,
  kind: z.literal('runtime.commands'),
  payload: z.strictObject({
    count: z.number().int().nonnegative().max(256)
  })
});

const UserMessageEventSchema = z.strictObject({
  ...EventEnvelopeFields,
  kind: z.literal('user.message'),
  payload: z.strictObject({ text: EventTextSchema })
});

const AssistantDeltaEventSchema = z.strictObject({
  ...EventEnvelopeFields,
  kind: z.literal('assistant.delta'),
  payload: z.strictObject({ text: EventTextSchema })
});

const AssistantMessageEventSchema = z.strictObject({
  ...EventEnvelopeFields,
  kind: z.literal('assistant.message'),
  payload: z.strictObject({ text: EventTextSchema })
});

const ReasoningSummaryEventSchema = z.strictObject({
  ...EventEnvelopeFields,
  kind: z.literal('reasoning.summary'),
  payload: z.strictObject({ text: EventTextSchema })
});

const ActivityStartedPayloadSchema = z.strictObject({
  activityId: OpaqueIdSchema,
  title: DisplayTextSchema,
  detail: z.string().trim().min(1).max(4_096).nullable().default(null)
});

const ActivityUpdatePayloadSchema = z.strictObject({
  activityId: OpaqueIdSchema,
  title: DisplayTextSchema.optional(),
  status: z.enum(['running', 'completed', 'failed', 'cancelled']),
  detail: z.string().max(65_536).nullable()
});

const ToolStartedEventSchema = z.strictObject({
  ...EventEnvelopeFields,
  kind: z.literal('tool.started'),
  payload: ActivityStartedPayloadSchema
});

const ToolUpdatedEventSchema = z.strictObject({
  ...EventEnvelopeFields,
  kind: z.literal('tool.updated'),
  payload: ActivityUpdatePayloadSchema
});

const CommandStartedEventSchema = z.strictObject({
  ...EventEnvelopeFields,
  kind: z.literal('command.started'),
  payload: ActivityStartedPayloadSchema
});

const CommandUpdatedEventSchema = z.strictObject({
  ...EventEnvelopeFields,
  kind: z.literal('command.updated'),
  payload: ActivityUpdatePayloadSchema
});

const FileChangedEventSchema = z.strictObject({
  ...EventEnvelopeFields,
  kind: z.literal('file.changed'),
  payload: z.strictObject({
    activityId: OpaqueIdSchema,
    title: DisplayTextSchema,
    pathLabel: z.string().trim().min(1).max(4_096),
    change: z.enum(['created', 'updated', 'deleted', 'moved'])
  })
});

export const StructuredAgentDiffFileSchema = z.strictObject({
  pathLabel: z.string().trim().min(1).max(4_096),
  oldPathLabel: z.string().trim().min(1).max(4_096).nullable(),
  additions: z.number().int().nonnegative().max(1_000_000),
  deletions: z.number().int().nonnegative().max(1_000_000),
  patch: z.string().min(1).max(262_144)
});

const DiffUpdatedEventSchema = z.strictObject({
  ...EventEnvelopeFields,
  kind: z.literal('diff.updated'),
  payload: z.strictObject({
    diffId: OpaqueIdSchema,
    files: z.array(StructuredAgentDiffFileSchema).min(1).max(64)
  })
});

export const StructuredAgentApprovalDecisionSchema = z.enum([
  'allow_once',
  'allow_session',
  'deny'
]);

const ApprovalRequestedEventSchema = z.strictObject({
  ...EventEnvelopeFields,
  kind: z.literal('approval.requested'),
  payload: z.strictObject({
    approvalId: OpaqueIdSchema,
    title: DisplayTextSchema,
    detail: z.string().trim().min(1).max(8_192),
    choices: z.array(StructuredAgentApprovalDecisionSchema).min(1).max(3)
  })
});

const ApprovalResolvedEventSchema = z.strictObject({
  ...EventEnvelopeFields,
  kind: z.literal('approval.resolved'),
  payload: z.strictObject({
    approvalId: OpaqueIdSchema,
    decision: StructuredAgentApprovalDecisionSchema
  })
});

const PlanUpdatedEventSchema = z.strictObject({
  ...EventEnvelopeFields,
  kind: z.literal('plan.updated'),
  payload: z.strictObject({
    items: z.array(z.strictObject({
      id: OpaqueIdSchema,
      text: z.string().trim().min(1).max(2_048),
      status: z.enum(['pending', 'in_progress', 'completed'])
    })).max(100)
  })
});

const UsageUpdatedEventSchema = z.strictObject({
  ...EventEnvelopeFields,
  kind: z.literal('usage.updated'),
  payload: z.strictObject({
    inputTokens: z.number().int().nonnegative().nullable(),
    cachedInputTokens: z.number().int().nonnegative().nullable(),
    outputTokens: z.number().int().nonnegative().nullable(),
    totalTokens: z.number().int().nonnegative().nullable()
  })
});

const AccountUsageUpdatedEventSchema = z.strictObject({
  ...EventEnvelopeFields,
  kind: z.literal('account.usage.updated'),
  payload: z.strictObject({
    plan: z.string().trim().min(1).max(128).nullable(),
    windows: z.array(z.strictObject({
      kind: z.enum(['primary', 'secondary']),
      usedPercent: z.number().nonnegative(),
      windowDurationMinutes: z.number().nonnegative().nullable(),
      resetsAt: z.number().nonnegative().nullable()
    })).max(2)
  })
});

const TurnStatusEventSchema = z.strictObject({
  ...EventEnvelopeFields,
  kind: z.enum(['turn.started', 'turn.completed']),
  payload: z.strictObject({
    state: z.enum(['running', 'completed', 'failed', 'cancelled']),
    message: z.string().trim().min(1).max(512).nullable()
  })
});

const RuntimeErrorEventSchema = z.strictObject({
  ...EventEnvelopeFields,
  kind: z.literal('runtime.error'),
  payload: z.strictObject({
    code: z.string().regex(/^[A-Z][A-Z0-9_]{2,63}$/),
    message: z.string().trim().min(1).max(512),
    retryable: z.boolean()
  })
});

export const StructuredAgentEventSchema = z.discriminatedUnion('kind', [
  RuntimeStatusEventSchema,
  RuntimeMetadataEventSchema,
  RuntimeCommandsEventSchema,
  UserMessageEventSchema,
  AssistantDeltaEventSchema,
  AssistantMessageEventSchema,
  ReasoningSummaryEventSchema,
  ToolStartedEventSchema,
  ToolUpdatedEventSchema,
  CommandStartedEventSchema,
  CommandUpdatedEventSchema,
  FileChangedEventSchema,
  DiffUpdatedEventSchema,
  ApprovalRequestedEventSchema,
  ApprovalResolvedEventSchema,
  PlanUpdatedEventSchema,
  UsageUpdatedEventSchema,
  AccountUsageUpdatedEventSchema,
  TurnStatusEventSchema,
  RuntimeErrorEventSchema
]).superRefine((event, context) => {
  if (
    event.nativeSessionId === null &&
    (event.kind !== 'runtime.status' || event.payload.state !== 'starting')
  ) {
    context.addIssue({
      code: 'custom',
      path: ['nativeSessionId'],
      message: 'Only a starting runtime status may precede native session identity.'
    });
  }
});

const PromptSubmitActionSchema = z.strictObject({
  kind: z.literal('prompt.submit'),
  connectionId: OpaqueIdSchema,
  text: z.string().min(1).max(131_072),
  attachmentTokens: z.array(OpaqueIdSchema).max(16).default([])
});

const ApprovalRespondActionSchema = z.strictObject({
  kind: z.literal('approval.respond'),
  connectionId: OpaqueIdSchema,
  approvalId: OpaqueIdSchema,
  decision: StructuredAgentApprovalDecisionSchema
});

const CancelTurnActionSchema = z.strictObject({
  kind: z.literal('turn.cancel'),
  connectionId: OpaqueIdSchema
});

const ExecuteCommandActionSchema = z.strictObject({
  kind: z.literal('command.execute'),
  connectionId: OpaqueIdSchema,
  commandId: OpaqueIdSchema,
  argument: z.string().max(131_072).default('')
});

const RefreshSessionDetailsActionSchema = z.strictObject({
  kind: z.literal('session.details.refresh'),
  connectionId: OpaqueIdSchema
});

export const StructuredAgentActionSchema = z.discriminatedUnion('kind', [
  PromptSubmitActionSchema,
  ApprovalRespondActionSchema,
  CancelTurnActionSchema,
  ExecuteCommandActionSchema,
  RefreshSessionDetailsActionSchema
]);

const StartPromptSchema = z.string().max(131_072).default('');

export const StructuredAgentLaunchRequestSchema = z.discriminatedUnion(
  'strategy',
  [
    z.strictObject({
      strategy: z.literal('new'),
      providerId: StructuredAgentProviderIdSchema,
      workspaceId: OpaqueIdSchema,
      startPrompt: StartPromptSchema
    }),
    z.strictObject({
      strategy: z.literal('resume'),
      providerId: StructuredAgentProviderIdSchema,
      sessionId: OpaqueIdSchema,
      startPrompt: StartPromptSchema
    })
  ]
);

export const StructuredAgentHistoryBoundarySchema = z.strictObject({
  kind: z.enum(['provider_limit', 'connection_start', 'unavailable']),
  message: z.string().trim().min(1).max(512)
});

export const StructuredAgentHistoryPageSchema = z.strictObject({
  nativeSessionId: OpaqueIdSchema,
  events: z.array(StructuredAgentEventSchema).max(500),
  nextCursor: OpaqueIdSchema.nullable(),
  boundary: StructuredAgentHistoryBoundarySchema.nullable().default(null)
});

export const StructuredAgentRuntimeSummarySchema = z.strictObject({
  connectionId: OpaqueIdSchema,
  providerId: StructuredAgentProviderIdSchema,
  nativeSessionId: OpaqueIdSchema.nullable(),
  catalogSessionId: OpaqueIdSchema.nullable(),
  workspaceId: OpaqueIdSchema,
  title: DisplayTextSchema,
  state: z.enum([
    'starting',
    'ready',
    'reconnecting',
    'closing',
    'closed',
    'failed'
  ]),
  generation: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  error: z.strictObject({
    code: z.string().regex(/^[A-Z][A-Z0-9_]{2,63}$/),
    message: z.string().trim().min(1).max(512),
    retryable: z.boolean()
  }).nullable()
});

export const StructuredAgentCommandSchema = z.strictObject({
  id: OpaqueIdSchema,
  name: z.string().trim().regex(/^\/[A-Za-z0-9][A-Za-z0-9:_-]{0,127}$/),
  description: z.string().trim().min(1).max(512),
  descriptionKey: z.string().trim().regex(/^[a-z0-9][a-z0-9.-]{2,255}$/).optional(),
  inputHint: z.string().trim().min(1).max(256).nullable(),
  choices: z.array(z.strictObject({
    value: z.string().trim().min(1).max(512),
    label: DisplayTextSchema,
    labelKey: z.string().trim().regex(/^[a-z0-9][a-z0-9.-]{2,255}$/).optional(),
    description: z.string().trim().min(1).max(512).nullable().default(null)
  })).max(256).optional(),
  selectedValue: z.string().trim().min(1).max(512).optional(),
  selectionBehavior: z.enum(['execute', 'continue']).optional()
}).superRefine((command, context) => {
  if (
    command.selectedValue !== undefined &&
    !command.choices?.some(({ value }) => value === command.selectedValue)
  ) {
    context.addIssue({
      code: 'custom',
      path: ['selectedValue'],
      message: 'The selected command value must be one of its choices.'
    });
  }
});

export const StructuredAgentRuntimeSnapshotSchema = z.strictObject({
  runtime: StructuredAgentRuntimeSummarySchema,
  events: z.array(StructuredAgentEventSchema).max(500),
  commands: z.array(StructuredAgentCommandSchema).max(256).optional(),
  boundary: StructuredAgentHistoryBoundarySchema.nullable()
});

export const StructuredAgentConnectionRequestSchema = z.strictObject({
  connectionId: OpaqueIdSchema
});

export const StructuredAgentCapabilityScanRequestSchema = z.strictObject({
  fresh: z.boolean().default(false)
});

export const StructuredAgentRuntimeListSchema = z.array(
  StructuredAgentRuntimeSummarySchema
).max(100);

export const StructuredAgentCommandResultSchema = z.strictObject({
  accepted: z.literal(true)
});

export type StructuredAgentProviderId = z.infer<
  typeof StructuredAgentProviderIdSchema
>;
export type StructuredAgentApprovalDecision = z.infer<
  typeof StructuredAgentApprovalDecisionSchema
>;
export type StructuredAgentEvent = z.infer<typeof StructuredAgentEventSchema>;
export type StructuredAgentAction = z.infer<typeof StructuredAgentActionSchema>;
export type StructuredAgentCommand = z.infer<typeof StructuredAgentCommandSchema>;
export type StructuredAgentDiffFile = z.infer<typeof StructuredAgentDiffFileSchema>;
export type StructuredAgentLaunchRequest = z.infer<
  typeof StructuredAgentLaunchRequestSchema
>;
export type StructuredAgentHistoryPage = z.infer<
  typeof StructuredAgentHistoryPageSchema
>;
export type StructuredAgentRuntimeSummary = z.infer<
  typeof StructuredAgentRuntimeSummarySchema
>;
export type StructuredAgentRuntimeSnapshot = z.infer<
  typeof StructuredAgentRuntimeSnapshotSchema
>;
export type StructuredAgentConnectionRequest = z.infer<
  typeof StructuredAgentConnectionRequestSchema
>;
export type StructuredAgentCapabilityScanRequest = z.infer<
  typeof StructuredAgentCapabilityScanRequestSchema
>;
