import { z } from 'zod';

export const STRUCTURED_AGENT_PROVIDER_IDS = [
  'codex',
  'claude',
  'gemini',
  'opencode',
  'cursor',
  'copilot',
  'qwen',
  'kimi',
  'goose'
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
  payload: z.strictObject({
    text: z.string().max(65_536),
    // Set when the message carried images; the text may then be empty.
    imageCount: z.number().int().min(1).max(16).optional(),
    /**
     * Sent into a turn already under way, rather than starting it. A turn's
     * first message is its prompt; a follow-up is added beneath it, while an
     * unflagged repeat of the prompt simply restates it.
     */
    followUp: z.boolean().optional()
  }).refine(
    (payload) => payload.text.length > 0 || payload.imageCount !== undefined,
    'A user message needs text or images.'
  )
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

/**
 * A question an agent puts to the user during a turn: Codex asking for input,
 * Claude's AskUserQuestion, or a form an MCP server needs filled in. Answers
 * travel back to the agent in the respond action only; the transcript records
 * that a question was answered, never what the answer was, so a secret stays
 * out of the session history.
 */
export const STRUCTURED_QUESTIONS_PER_REQUEST = 8;
export const STRUCTURED_QUESTION_OPTIONS = 16;

const StructuredQuestionOptionSchema = z.strictObject({
  label: z.string().trim().min(1).max(512),
  description: z.string().trim().max(2_048).nullable()
});

export const StructuredQuestionSchema = z.strictObject({
  id: OpaqueIdSchema,
  header: z.string().trim().max(128).nullable(),
  prompt: z.string().trim().min(1).max(4_096),
  answer: z.enum(['choice', 'text', 'number', 'boolean']),
  options: z.array(StructuredQuestionOptionSchema).max(STRUCTURED_QUESTION_OPTIONS),
  multiSelect: z.boolean(),
  /** A choice that also takes a typed answer of the user's own. */
  allowOther: z.boolean(),
  secret: z.boolean(),
  required: z.boolean()
}).refine(
  (question) => question.answer !== 'choice' || question.options.length > 0,
  'A choice needs options.'
);

const QuestionRequestedEventSchema = z.strictObject({
  ...EventEnvelopeFields,
  kind: z.literal('question.requested'),
  payload: z.strictObject({
    requestId: OpaqueIdSchema,
    source: z.enum(['agent', 'mcp']),
    serverName: z.string().trim().min(1).max(256).nullable(),
    message: z.string().trim().min(1).max(8_192).nullable(),
    /** An MCP server that needs the user to visit a page, such as a sign-in. */
    link: z.string().trim().min(1).max(4_096).nullable(),
    questions: z.array(StructuredQuestionSchema).max(STRUCTURED_QUESTIONS_PER_REQUEST)
  }).refine(
    (payload) => payload.questions.length > 0 || payload.link !== null,
    'A question needs something to answer or a link to open.'
  )
});

const QuestionResolvedEventSchema = z.strictObject({
  ...EventEnvelopeFields,
  kind: z.literal('question.resolved'),
  payload: z.strictObject({
    requestId: OpaqueIdSchema,
    outcome: z.enum(['answered', 'declined', 'cancelled'])
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
    message: z.string().trim().min(1).max(512).nullable(),
    /**
     * False for a started turn that cannot take a message while it runs, such
     * as a review or a compaction; a message then waits for it to end.
     */
    steerable: z.boolean().optional()
  })
});

/**
 * What went wrong, in terms every agent shares, so the renderer can say it in
 * the user's language. The provider's own words stay in `message`.
 */
export const StructuredAgentErrorKindSchema = z.enum([
  'usage_limit',
  'rate_limit',
  'context_full',
  'overloaded',
  'connection',
  'sign_in',
  'account',
  'rejected',
  'other'
]);

const RuntimeErrorEventSchema = z.strictObject({
  ...EventEnvelopeFields,
  kind: z.literal('runtime.error'),
  payload: z.strictObject({
    code: z.string().regex(/^[A-Z][A-Z0-9_]{2,63}$/),
    message: z.string().trim().min(1).max(512),
    retryable: z.boolean(),
    errorKind: StructuredAgentErrorKindSchema.optional(),
    /**
     * The provider's own words, when it gave any. Shown beneath the kind; left
     * out rather than filled with Lumora's English when the provider said nothing.
     */
    providerMessage: z.string().trim().min(1).max(1_024).nullable().optional(),
    /** The provider is trying again: which attempt this is, of how many. */
    attempt: z.strictObject({
      current: z.number().int().positive().max(1_000),
      max: z.number().int().positive().max(1_000)
    }).nullable().optional(),
    /** When a limit lifts, in seconds since the epoch. */
    resetsAt: z.number().int().nonnegative().nullable().optional()
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
  QuestionRequestedEventSchema,
  QuestionResolvedEventSchema,
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
  text: z.string().max(131_072),
  attachmentTokens: z.array(OpaqueIdSchema).max(16).default([])
}).refine(
  (action) => action.text.trim().length > 0 || action.attachmentTokens.length > 0,
  'A prompt needs text or an image.'
);

const ApprovalRespondActionSchema = z.strictObject({
  kind: z.literal('approval.respond'),
  connectionId: OpaqueIdSchema,
  approvalId: OpaqueIdSchema,
  decision: StructuredAgentApprovalDecisionSchema
});

const QuestionRespondActionSchema = z.strictObject({
  kind: z.literal('question.respond'),
  connectionId: OpaqueIdSchema,
  requestId: OpaqueIdSchema,
  outcome: z.enum(['answer', 'decline']),
  /** Keyed by question id: the chosen labels, or the one typed value. */
  answers: z.record(
    z.string().min(1).max(256),
    z.array(z.string().max(8_192)).max(STRUCTURED_QUESTION_OPTIONS)
  ).refine(
    (answers) => Object.keys(answers).length <= STRUCTURED_QUESTIONS_PER_REQUEST,
    'Too many answers.'
  ).default({})
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

/**
 * Images a Unified UI message can carry. The renderer scales and encodes them
 * before sending: the longest side fits within the dimension limit, and a
 * large photo is sent as JPEG so it stays within the smallest per-image limit
 * among the agents (Claude's 5 MB).
 */
export const STRUCTURED_IMAGE_MAX_BYTES = 5 * 1024 * 1024;
export const STRUCTURED_IMAGE_MAX_DIMENSION = 2_048;
export const STRUCTURED_IMAGES_PER_MESSAGE = 8;
export const STRUCTURED_IMAGE_MIME_TYPES = ['image/png', 'image/jpeg'] as const;

export const StructuredImageMimeTypeSchema = z.enum(STRUCTURED_IMAGE_MIME_TYPES);

export const StructuredImageStageRequestSchema = z.strictObject({
  connectionId: OpaqueIdSchema,
  mimeType: StructuredImageMimeTypeSchema,
  data: z.instanceof(Uint8Array).refine(
    (data) => data.byteLength > 0 && data.byteLength <= STRUCTURED_IMAGE_MAX_BYTES,
    'The image is empty or too large.'
  )
});

export const StructuredImageStageResultSchema = z.strictObject({
  token: OpaqueIdSchema,
  width: z.number().int().positive().max(STRUCTURED_IMAGE_MAX_DIMENSION),
  height: z.number().int().positive().max(STRUCTURED_IMAGE_MAX_DIMENSION),
  bytes: z.number().int().positive().max(STRUCTURED_IMAGE_MAX_BYTES)
});

export type StructuredImageMimeType = z.infer<typeof StructuredImageMimeTypeSchema>;
export type StructuredImageStageRequest = z.infer<typeof StructuredImageStageRequestSchema>;
export type StructuredImageStageResult = z.infer<typeof StructuredImageStageResultSchema>;

/**
 * Files a Unified UI message points the agent at. Lumora sends the path
 * rather than the bytes: every agent reads files with its own tools, and a
 * path costs nothing until the agent opens it. Whether it can open a file at
 * all is its own business, and its workspace rules decide.
 */
export const STRUCTURED_FILES_PER_MESSAGE = 8;

export const StructuredFileReferenceSchema = z.strictObject({
  name: z.string().min(1).max(255),
  path: z.string().min(1).max(4_096)
});

export const StructuredFileChooseRequestSchema = z.strictObject({
  connectionId: OpaqueIdSchema
});

export const StructuredFileChooseResultSchema = z.strictObject({
  files: z.array(StructuredFileReferenceSchema).max(STRUCTURED_FILES_PER_MESSAGE)
});

export type StructuredFileReference = z.infer<typeof StructuredFileReferenceSchema>;
export type StructuredFileChooseRequest = z.infer<typeof StructuredFileChooseRequestSchema>;
export type StructuredFileChooseResult = z.infer<typeof StructuredFileChooseResultSchema>;
export type StructuredQuestion = z.infer<typeof StructuredQuestionSchema>;
export type StructuredAgentErrorKind = z.infer<typeof StructuredAgentErrorKindSchema>;

export const StructuredAgentActionSchema = z.discriminatedUnion('kind', [
  PromptSubmitActionSchema,
  ApprovalRespondActionSchema,
  QuestionRespondActionSchema,
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
  }).nullable(),
  /** Whether this session's agent takes images in a prompt. */
  acceptsImages: z.boolean().optional(),
  /**
   * Whether a message sent while a turn runs goes into that turn. Without it,
   * Lumora holds the message and sends it when the turn ends.
   */
  canSteer: z.boolean().optional()
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
