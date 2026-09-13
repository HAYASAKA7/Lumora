import { randomUUID } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { win32 } from 'node:path';

import { z } from 'zod';

import {
  STRUCTURED_QUESTION_OPTIONS,
  STRUCTURED_QUESTIONS_PER_REQUEST,
  type StructuredAgentAction,
  type StructuredAgentCommand,
  type StructuredAgentDiffFile,
  type StructuredQuestion
} from '../../../shared/agent/contracts';
import type { StructuredAgentEventDraft } from '../runtime/event-sequencer';
import { createFullTextUnifiedDiff } from '../diff/unified-diff';
import type {
  StructuredAgentAdapter,
  StructuredAgentAdapterContext
} from './structured-agent-adapter';
import {
  mcpFormContent,
  mcpFormQuestions,
  type McpQuestionForm
} from './structured-questions';
import {
  claudeErrorKind,
  epochSeconds,
  httpStatusErrorKind,
  providerWords
} from './structured-errors';

export interface ClaudeQueryLike extends AsyncIterable<unknown> {
  interrupt(): Promise<unknown>;
  setModel(model?: string): Promise<void>;
  supportedCommands(): Promise<Array<{
    name: string;
    description: string;
    argumentHint: string;
    aliases?: string[];
  }>>;
  supportedModels(): Promise<Array<{
    value: string;
    displayName: string;
    description: string;
    resolvedModel?: string;
  }>>;
  close(): void;
}

export interface ClaudePermissionOptions {
  toolUseID: string;
  requestId: string;
  title?: string;
  displayName?: string;
  description?: string;
  decisionReason?: string;
  suggestions?: unknown[];
  /** Aborted when Claude no longer needs the answer, such as a cancelled turn. */
  signal?: AbortSignal;
}

export type ClaudeCanUseTool = (
  toolName: string,
  input: Record<string, unknown>,
  options: ClaudePermissionOptions
) => Promise<unknown>;

/** An MCP server asking, through Claude, for a form or a visit to a page. */
export interface ClaudeElicitationRequest {
  serverName: string;
  message: string;
  mode?: 'form' | 'url';
  url?: string;
  requestedSchema?: Record<string, unknown>;
}

export type ClaudeElicitationReply =
  | { action: 'accept'; content?: Record<string, unknown> }
  | { action: 'decline' | 'cancel' };

export type ClaudeElicitationHandler = (
  request: ClaudeElicitationRequest,
  options: { signal: AbortSignal }
) => Promise<ClaudeElicitationReply>;

export interface ClaudeStructuredQueryFactoryOptions {
  executablePath: string;
  workingDirectory: string;
  resumeSessionId: string | null;
  newSessionId: string | null;
  settingSources: readonly ['user', 'project', 'local'];
  input: AsyncIterable<unknown>;
  canUseTool: ClaudeCanUseTool;
  onElicitation: ClaudeElicitationHandler;
}

export type ClaudeStructuredQueryFactory = (
  options: ClaudeStructuredQueryFactoryOptions
) => ClaudeQueryLike;

export type ClaudeHistoryLoader = (
  nativeSessionId: string,
  workingDirectory: string
) => Promise<readonly unknown[]>;

export interface CreateClaudeStructuredAdapterOptions {
  createQuery?: ClaudeStructuredQueryFactory;
  loadHistory?: ClaudeHistoryLoader;
  resolveSdkExecutablePath?: (executablePath: string) => Promise<string>;
  createNativeSessionId?: () => string;
}

type ClaudeExecutablePlatform = 'win32' | 'darwin' | 'linux';
type IsExecutableFile = (path: string) => Promise<boolean>;

async function isExecutableFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

export async function resolveClaudeSdkExecutablePath(
  executablePath: string,
  platform: ClaudeExecutablePlatform = process.platform as ClaudeExecutablePlatform,
  isExecutable: IsExecutableFile = isExecutableFile
): Promise<string> {
  if (platform !== 'win32' || !/\.(?:cmd|bat)$/i.test(executablePath)) {
    return executablePath;
  }
  const nativeExecutable = win32.resolve(
    win32.dirname(executablePath),
    'node_modules',
    '@anthropic-ai',
    'claude-code',
    'bin',
    'claude.exe'
  );
  if (await isExecutable(nativeExecutable)) return nativeExecutable;
  throw new Error('The Claude npm wrapper does not expose a native SDK executable.');
}

interface PendingPermission {
  turnId: string;
  suggestions: unknown[];
  resolve(value: unknown): void;
}

type PendingQuestion =
  | {
    kind: 'ask';
    turnId: string;
    input: Record<string, unknown>;
    /** Lumora's question id to the question text Claude keys its answers by. */
    prompts: ReadonlyMap<string, string>;
    resolve(value: unknown): void;
  }
  | {
    kind: 'elicitation';
    turnId: string;
    form: McpQuestionForm | null;
    resolve(value: unknown): void;
  };

const AskUserQuestionSchema = z.object({
  questions: z.array(z.object({
    question: z.string().trim().min(1),
    header: z.string(),
    options: z.array(z.object({
      label: z.string().trim().min(1),
      description: z.string().optional()
    })).min(1).max(STRUCTURED_QUESTION_OPTIONS),
    multiSelect: z.boolean().optional()
  })).min(1).max(STRUCTURED_QUESTIONS_PER_REQUEST)
});

class AsyncInputQueue implements AsyncIterable<unknown> {
  private readonly values: unknown[] = [];
  private readonly waiters: Array<(result: IteratorResult<unknown>) => void> = [];
  private ended = false;

  push(value: unknown): void {
    if (this.ended) throw new Error('The Claude input stream is closed.');
    const waiter = this.waiters.shift();
    if (waiter !== undefined) waiter({ done: false, value });
    else this.values.push(value);
  }

  end(): void {
    if (this.ended) return;
    this.ended = true;
    for (const waiter of this.waiters.splice(0)) {
      waiter({ done: true, value: undefined });
    }
  }

  [Symbol.asyncIterator](): AsyncIterator<unknown> {
    return {
      next: async () => {
        const value = this.values.shift();
        if (value !== undefined) return { done: false, value };
        if (this.ended) return { done: true, value: undefined };
        return new Promise((resolve) => this.waiters.push(resolve));
      }
    };
  }
}

function bounded(value: string, max = 65_536): string {
  const text = value.slice(0, max);
  return text.length === 0 ? ' ' : text;
}

function object(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null
    ? value as Record<string, unknown>
    : null;
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function contentBlocks(message: unknown): readonly Record<string, unknown>[] {
  const record = object(message);
  const content = record?.content;
  if (typeof content === 'string') return [{ type: 'text', text: content }];
  if (!Array.isArray(content)) return [];
  return content.flatMap((entry) => {
    const parsed = object(entry);
    return parsed === null ? [] : [parsed];
  });
}

function historyEvents(messages: readonly unknown[]): StructuredAgentEventDraft[] {
  return messages.flatMap((value, index) => {
    const entry = object(value);
    const type = stringValue(entry?.type);
    const uuid = stringValue(entry?.uuid) ?? `history-${index}`;
    const turnId = `claude-${uuid}`.slice(0, 256);
    const blocks = contentBlocks(entry?.message);
    if (type !== 'user' && type !== 'assistant') return [];
    return blocks.flatMap((block) => {
      if (block.type !== 'text' || typeof block.text !== 'string' || block.text.length === 0) {
        return [];
      }
      return [{
        turnId,
        parentEventId: null,
        kind: type === 'user' ? 'user.message' as const : 'assistant.message' as const,
        payload: { text: bounded(block.text) }
      }];
    });
  });
}

const defaultFactory: ClaudeStructuredQueryFactory = (options) => {
  throw new Error(`Claude SDK is not loaded for ${options.executablePath}.`);
};

async function loadDefaultDependencies(): Promise<{
  createQuery: ClaudeStructuredQueryFactory;
  loadHistory: ClaudeHistoryLoader;
}> {
  const sdk = await import('@anthropic-ai/claude-agent-sdk');
  return {
    createQuery: (options) => sdk.query({
      prompt: options.input as Parameters<typeof sdk.query>[0]['prompt'],
      options: {
        cwd: options.workingDirectory,
        pathToClaudeCodeExecutable: options.executablePath,
        settingSources: [...options.settingSources],
        includePartialMessages: true,
        permissionMode: 'default',
        canUseTool: options.canUseTool as NonNullable<
          NonNullable<Parameters<typeof sdk.query>[0]['options']>['canUseTool']
        >,
        onElicitation: options.onElicitation as NonNullable<
          NonNullable<Parameters<typeof sdk.query>[0]['options']>['onElicitation']
        >,
        ...(options.resumeSessionId === null
          ? options.newSessionId === null
            ? {}
            : { sessionId: options.newSessionId }
          : { resume: options.resumeSessionId })
      }
    }) as ClaudeQueryLike,
    loadHistory: async (nativeSessionId, workingDirectory) => sdk.getSessionMessages(
      nativeSessionId,
      { dir: workingDirectory, limit: 500 }
    )
  };
}

export function createClaudeStructuredAdapter(
  context: StructuredAgentAdapterContext,
  options: CreateClaudeStructuredAdapterOptions = {}
): StructuredAgentAdapter {
  if (context.providerId !== 'claude') {
    throw new Error('The Claude adapter requires a Claude context.');
  }
  const pendingPermissions = new Map<string, PendingPermission>();
  const pendingQuestions = new Map<string, PendingQuestion>();
  const pendingDiffs = new Map<string, {
    turnId: string;
    files: StructuredAgentDiffFile[];
  }>();
  const turnIdByUserMessageUuid = new Map<string, string>();
  const turnIdByAssistantMessageUuid = new Map<string, string>();
  const pendingResultTurnIds: string[] = [];
  const completedTurnStates = new Map<string, 'completed' | 'failed' | 'cancelled'>();
  const terminalStreamTurnIds = new Map<string, string>();
  let input: AsyncInputQueue | null = null;
  let query: ClaudeQueryLike | null = null;
  let consumePromise: Promise<void> | null = null;
  let queryFactory: ClaudeStructuredQueryFactory | null = null;
  let sdkExecutablePath: string | null = null;
  let queryGeneration = 0;
  let hasStartedQuery = false;
  let nativeSessionId = context.launch.nativeSessionId
    ?? (options.createNativeSessionId ?? randomUUID)();
  let currentTurnId: string | null = null;
  let turnNumber = 0;
  let closed = false;
  let opened = false;
  let initialPromptSent = false;
  let commands: StructuredAgentCommand[] = [];
  let providerCommands: StructuredAgentCommand[] = [];
  let modelChoices: NonNullable<StructuredAgentCommand['choices']> = [];
  let resolvedModels = new Map<string, string>();
  let selectedModel: string | null = null;

  const normalizeCommands = (value: unknown): StructuredAgentCommand[] => {
    if (!Array.isArray(value)) return [];
    return value.slice(0, 256).flatMap((entry) => {
      const command = object(entry);
      if (
        command === null ||
        typeof command.name !== 'string' ||
        !/^[A-Za-z0-9][A-Za-z0-9:_-]{0,127}$/.test(command.name) ||
        typeof command.description !== 'string' ||
        command.description.trim() === ''
      ) return [];
      if (command.name.toLocaleLowerCase() === 'model') return [];
      return [{
        id: `claude:${command.name}`,
        name: `/${command.name}`,
        description: bounded(command.description, 512),
        inputHint: typeof command.argumentHint === 'string' && command.argumentHint.trim() !== ''
          ? bounded(command.argumentHint, 256)
          : null
      }];
    });
  };
  const normalizeModels = (value: unknown): NonNullable<StructuredAgentCommand['choices']> => {
    if (!Array.isArray(value)) return [];
    resolvedModels = new Map();
    return value.slice(0, 256).flatMap((entry) => {
      const model = object(entry);
      if (
        model === null ||
        typeof model.value !== 'string' || model.value.trim() === '' ||
        typeof model.displayName !== 'string' || model.displayName.trim() === ''
      ) return [];
      const modelValue = bounded(model.value.trim(), 512);
      if (typeof model.resolvedModel === 'string' && model.resolvedModel.trim() !== '') {
        resolvedModels.set(modelValue, bounded(model.resolvedModel.trim(), 512));
      }
      return [{
        value: modelValue,
        label: bounded(model.displayName.trim(), 512),
        description: typeof model.description === 'string' && model.description.trim() !== ''
          ? bounded(model.description.trim(), 512)
          : null
      }];
    });
  };
  const publishCommands = (): void => {
    const selectedChoice = modelChoices.find(({ value }) => (
      value === selectedModel ||
      resolvedModels.get(value) === selectedModel
    ));
    commands = [
      ...(modelChoices.length === 0 ? [] : [{
        id: 'model',
        name: '/model',
        description: 'Choose the model for future turns.',
        descriptionKey: 'terminal.unified.commands.model',
        inputHint: '<model>',
        choices: modelChoices,
        selectedValue: selectedChoice?.value ?? modelChoices[0]!.value,
        selectionBehavior: 'execute' as const
      }]),
      ...providerCommands
    ];
    if (opened) context.callbacks.commandsChanged?.(commands);
  };
  const emit = (event: StructuredAgentEventDraft): void => {
    if (opened && !closed) context.callbacks.emit(event);
  };
  const remember = (entries: Map<string, string>, key: string, turnId: string): void => {
    entries.set(key, turnId);
    if (entries.size <= 512) return;
    const oldest = entries.keys().next().value;
    if (oldest !== undefined) entries.delete(oldest);
  };
  const completeTurn = (
    turnId: string,
    state: 'completed' | 'failed' | 'cancelled',
    message: string | null
  ): void => {
    const previousState = completedTurnStates.get(turnId);
    if (
      previousState === state ||
      previousState === 'cancelled' ||
      previousState === 'failed' ||
      (previousState === 'completed' && state !== 'failed')
    ) return;
    completedTurnStates.set(turnId, state);
    settleQuestions(turnId);
    if (completedTurnStates.size > 512) {
      const oldest = completedTurnStates.keys().next().value;
      if (oldest !== undefined) completedTurnStates.delete(oldest);
    }
    emit({
      turnId,
      parentEventId: null,
      kind: 'turn.completed',
      payload: { state, message }
    });
    if (currentTurnId === turnId) currentTurnId = null;
  };
  const isTerminalStopReason = (value: unknown): boolean => (
    value === 'end_turn' ||
    value === 'max_tokens' ||
    value === 'stop_sequence' ||
    value === 'refusal' ||
    value === 'model_context_window_exceeded'
  );
  const resolveMessageTurnId = (message: Record<string, unknown>): string => {
    const userMessageUuid = stringValue(message.user_message_uuid);
    const assistantMessageUuid = stringValue(message.uuid);
    const userTurnId = userMessageUuid === null
      ? undefined
      : turnIdByUserMessageUuid.get(userMessageUuid);
    const assistantTurnId = assistantMessageUuid === null
      ? undefined
      : turnIdByAssistantMessageUuid.get(assistantMessageUuid);
    const turnId = userTurnId
      ?? assistantTurnId
      ?? currentTurnId
      ?? `claude-turn-${Math.max(1, turnNumber)}`;
    if (
      assistantMessageUuid !== null &&
      (message.type === 'stream_event' || message.type === 'assistant')
    ) {
      remember(turnIdByAssistantMessageUuid, assistantMessageUuid, turnId);
    }
    return turnId;
  };

  /**
   * Lets go of a question nobody answered — its turn ended, Claude withdrew it,
   * or the session closed — with the reply that says so.
   */
  const settleQuestion = (requestId: string): void => {
    const pending = pendingQuestions.get(requestId);
    if (pending === undefined) return;
    pendingQuestions.delete(requestId);
    pending.resolve(pending.kind === 'ask'
      ? { behavior: 'deny', message: 'The question was not answered.' }
      : { action: 'cancel' });
    if (closed) return;
    emit({
      turnId: pending.turnId,
      parentEventId: null,
      kind: 'question.resolved',
      payload: { requestId, outcome: 'cancelled' }
    });
  };
  const settleQuestions = (turnId: string | null): void => {
    for (const [requestId, pending] of [...pendingQuestions]) {
      if (turnId === null || pending.turnId === turnId) settleQuestion(requestId);
    }
  };

  /** Claude's AskUserQuestion, shown as questions rather than a permission to allow. */
  const askQuestions = (
    turnId: string,
    permission: ClaudePermissionOptions,
    toolInput: Record<string, unknown>,
    asked: z.infer<typeof AskUserQuestionSchema>
  ): Promise<unknown> => {
    const requestId = `claude-question-${permission.toolUseID}`.slice(0, 256);
    const questions: StructuredQuestion[] = asked.questions.map((question, index) => {
      const header = question.header.trim();
      const described = (description: string | undefined): string | null => {
        const text = description?.trim() ?? '';
        return text === '' ? null : text.slice(0, 2_048);
      };
      return {
        id: `question-${index}`,
        header: header === '' ? null : header.slice(0, 128),
        prompt: question.question.slice(0, 4_096),
        answer: 'choice',
        options: question.options.map((option) => ({
          label: option.label.slice(0, 512),
          description: described(option.description)
        })),
        multiSelect: question.multiSelect === true,
        // Claude offers its own Other beside the choices it lists.
        allowOther: true,
        secret: false,
        required: true
      };
    });
    emit({
      turnId,
      parentEventId: null,
      kind: 'question.requested',
      payload: { requestId, source: 'agent', serverName: null, message: null, link: null, questions }
    });
    return new Promise((resolve) => {
      pendingQuestions.set(requestId, {
        kind: 'ask',
        turnId,
        input: toolInput,
        prompts: new Map(questions.map((question, index) => [
          question.id,
          asked.questions[index]!.question
        ])),
        resolve
      });
      permission.signal?.addEventListener('abort', () => settleQuestion(requestId), { once: true });
    });
  };

  const onElicitation: ClaudeElicitationHandler = async (request, { signal }) => {
    // A form turns into questions and a page to visit becomes a link; a form
    // Lumora cannot show faithfully is declined rather than half-answered.
    const form = request.mode === 'url' ? null : mcpFormQuestions(request.requestedSchema);
    const link = request.mode === 'url' && /^https?:\/\//iu.test(request.url ?? '')
      ? request.url!.slice(0, 4_096)
      : null;
    if (form === null && link === null) return { action: 'decline' };
    const turnId = currentTurnId ?? `claude-turn-${Math.max(1, turnNumber)}`;
    const requestId = `claude-form-${randomUUID()}`;
    const message = request.message.trim();
    emit({
      turnId,
      parentEventId: null,
      kind: 'question.requested',
      payload: {
        requestId,
        source: 'mcp',
        serverName: request.serverName.trim().slice(0, 256) || null,
        message: message === '' ? null : message.slice(0, 8_192),
        link,
        questions: form?.questions ?? []
      }
    });
    return new Promise((resolve) => {
      pendingQuestions.set(requestId, {
        kind: 'elicitation',
        turnId,
        form,
        resolve: resolve as (value: unknown) => void
      });
      signal.addEventListener('abort', () => settleQuestion(requestId), { once: true });
    });
  };

  const canUseTool: ClaudeCanUseTool = async (toolName, toolInput, permission) => {
    const turnId = currentTurnId ?? `claude-turn-${Math.max(1, turnNumber)}`;
    if (toolName === 'AskUserQuestion') {
      const asked = AskUserQuestionSchema.safeParse(toolInput);
      if (asked.success) return askQuestions(turnId, permission, toolInput, asked.data);
    }
    const approvalId = `claude-${permission.toolUseID}`.slice(0, 256);
    const command = stringValue(toolInput.command);
    emit({
      turnId,
      parentEventId: null,
      kind: 'approval.requested',
      payload: {
        approvalId,
        title: bounded(
          permission.title ?? permission.displayName ?? command ?? toolName,
          512
        ),
        detail: bounded(
          permission.description ?? permission.decisionReason ?? `Claude wants to use ${toolName}.`,
          8_192
        ),
        choices: ['allow_once', 'allow_session', 'deny']
      }
    });
    return new Promise((resolve) => {
      pendingPermissions.set(approvalId, {
        turnId,
        suggestions: permission.suggestions ?? [],
        resolve
      });
    });
  };

  const acceptMessage = (value: unknown): void => {
    const message = object(value);
    if (message === null) return;
    const sessionId = stringValue(message.session_id);
    if (message.type === 'system' && message.subtype === 'init' && sessionId !== null) {
      if (nativeSessionId !== null && nativeSessionId !== sessionId) {
        throw new Error('Claude returned a different native session.');
      }
      nativeSessionId = sessionId;
      selectedModel = stringValue(message.model) ?? selectedModel;
      const activeQuery = query;
      void (activeQuery === null
        ? Promise.resolve()
        : Promise.all([
            activeQuery.supportedCommands().catch(() => []),
            activeQuery.supportedModels().catch(() => [])
          ]).then(([commandValue, modelValue]) => {
            if (closed) return;
            providerCommands = normalizeCommands(commandValue);
            modelChoices = normalizeModels(modelValue);
            publishCommands();
          }));
      return;
    }
    if (message.type === 'system' && message.subtype === 'commands_changed') {
      providerCommands = normalizeCommands(message.commands);
      publishCommands();
      return;
    }
    if (sessionId !== null && nativeSessionId !== null && sessionId !== nativeSessionId) return;
    const turnId = resolveMessageTurnId(message);

    if (message.type === 'system' && message.subtype === 'api_retry') {
      // Claude is trying again on its own; say so, and which attempt this is.
      const named = claudeErrorKind(message.error);
      const attempt = typeof message.attempt === 'number' ? Math.floor(message.attempt) : null;
      const max = typeof message.max_retries === 'number' ? Math.floor(message.max_retries) : null;
      emit({
        turnId,
        parentEventId: null,
        kind: 'runtime.error',
        payload: {
          code: 'CLAUDE_API_RETRY',
          message: 'Claude is retrying after an API error.',
          retryable: true,
          errorKind: named === 'other' ? httpStatusErrorKind(message.error_status) : named,
          providerMessage: null,
          attempt: attempt !== null && max !== null && attempt >= 1 && max >= 1
            ? { current: Math.min(attempt, 1_000), max: Math.min(Math.max(attempt, max), 1_000) }
            : null,
          resetsAt: null
        }
      });
      return;
    }

    if (message.type === 'rate_limit_event') {
      const info = object(message.rate_limit_info);
      // Only a refused request is a problem; a warning is not worth interrupting for.
      if (info?.status !== 'rejected') return;
      emit({
        turnId,
        parentEventId: null,
        kind: 'runtime.error',
        payload: {
          code: 'CLAUDE_USAGE_LIMIT',
          message: 'Claude reached a usage limit.',
          retryable: false,
          errorKind: 'usage_limit',
          providerMessage: null,
          attempt: null,
          resetsAt: epochSeconds(info.resetsAt)
        }
      });
      return;
    }

    if (message.type === 'stream_event') {
      const event = object(message.event);
      const delta = object(event?.delta);
      const assistantMessageUuid = stringValue(message.uuid);
      const topLevel = stringValue(message.parent_tool_use_id) === null;
      if (
        event?.type === 'message_delta' &&
        topLevel &&
        isTerminalStopReason(delta?.stop_reason)
      ) {
        if (assistantMessageUuid === null) completeTurn(turnId, 'completed', null);
        else terminalStreamTurnIds.set(assistantMessageUuid, turnId);
        return;
      }
      if (event?.type === 'message_stop' && topLevel) {
        const terminalTurnId = assistantMessageUuid === null
          ? null
          : terminalStreamTurnIds.get(assistantMessageUuid) ?? null;
        if (assistantMessageUuid !== null) terminalStreamTurnIds.delete(assistantMessageUuid);
        if (terminalTurnId !== null) completeTurn(terminalTurnId, 'completed', null);
        return;
      }
      if (event?.type !== 'content_block_delta' || delta === null) return;
      if (delta.type === 'text_delta' && typeof delta.text === 'string' && delta.text.length > 0) {
        emit({
          turnId, parentEventId: null, kind: 'assistant.delta',
          payload: { text: bounded(delta.text) }
        });
      } else if (
        (delta.type === 'thinking_delta' || delta.type === 'signature_delta') &&
        typeof delta.thinking === 'string' && delta.thinking.length > 0
      ) {
        emit({
          turnId, parentEventId: null, kind: 'reasoning.summary',
          payload: { text: bounded(delta.thinking) }
        });
      }
      return;
    }

    if (message.type === 'assistant') {
      for (const block of contentBlocks(message.message)) {
        if (block.type === 'text' && typeof block.text === 'string' && block.text.length > 0) {
          emit({
            turnId, parentEventId: null, kind: 'assistant.message',
            payload: { text: bounded(block.text) }
          });
        } else if (block.type === 'tool_use' && typeof block.id === 'string') {
          const toolName = stringValue(block.name) ?? 'Tool';
          const toolInput = object(block.input);
          if (
            toolName.toLocaleLowerCase() === 'edit' &&
            typeof toolInput?.file_path === 'string' &&
            typeof toolInput.old_string === 'string' &&
            typeof toolInput.new_string === 'string'
          ) {
            pendingDiffs.set(block.id, {
              turnId,
              files: [createFullTextUnifiedDiff(
                bounded(toolInput.file_path, 4_096),
                toolInput.old_string,
                toolInput.new_string
              )]
            });
          }
          emit({
            turnId,
            parentEventId: null,
            kind: 'tool.started',
            payload: {
              activityId: block.id,
              title: bounded(toolName, 512),
              detail: null
            }
          });
        }
      }
      const assistantMessage = object(message.message);
      if (
        stringValue(message.parent_tool_use_id) === null &&
        isTerminalStopReason(assistantMessage?.stop_reason)
      ) {
        completeTurn(turnId, 'completed', null);
      }
      return;
    }

    if (message.type === 'user') {
      for (const block of contentBlocks(message.message)) {
        if (block.type !== 'tool_result' || typeof block.tool_use_id !== 'string') continue;
        emit({
          turnId,
          parentEventId: null,
          kind: 'tool.updated',
          payload: {
            activityId: block.tool_use_id,
            status: block.is_error === true ? 'failed' : 'completed',
            detail: null
          }
        });
        const diff = pendingDiffs.get(block.tool_use_id);
        pendingDiffs.delete(block.tool_use_id);
        if (diff !== undefined && block.is_error !== true) {
          emit({
            turnId: diff.turnId,
            parentEventId: null,
            kind: 'diff.updated',
            payload: {
              diffId: `${diff.turnId}:${block.tool_use_id}`.slice(0, 256),
              files: diff.files
            }
          });
        }
      }
      return;
    }

    if (message.type === 'result') {
      const userMessageUuid = stringValue(message.user_message_uuid);
      const userTurnId = userMessageUuid === null
        ? undefined
        : turnIdByUserMessageUuid.get(userMessageUuid);
      const resultTurnId = userTurnId
        ?? pendingResultTurnIds[0]
        ?? turnId;
      const pendingResultIndex = pendingResultTurnIds.indexOf(resultTurnId);
      if (pendingResultIndex !== -1) pendingResultTurnIds.splice(pendingResultIndex, 1);
      const usage = object(message.usage);
      const inputTokens = typeof usage?.input_tokens === 'number' ? usage.input_tokens : null;
      const cachedInputTokens = typeof usage?.cache_read_input_tokens === 'number'
        ? usage.cache_read_input_tokens
        : null;
      const outputTokens = typeof usage?.output_tokens === 'number' ? usage.output_tokens : null;
      emit({
        turnId: resultTurnId,
        parentEventId: null,
        kind: 'usage.updated',
        payload: {
          inputTokens,
          cachedInputTokens,
          outputTokens,
          totalTokens: inputTokens === null || outputTokens === null
            ? null
            : inputTokens + outputTokens
        }
      });
      // A turn the user stopped is not a failure to report.
      if (message.is_error === true && completedTurnStates.get(resultTurnId) !== 'cancelled') {
        const errors = Array.isArray(message.errors)
          ? message.errors.filter((entry): entry is string => typeof entry === 'string')
          : [];
        const words = providerWords(errors.length > 0 ? errors.join('\n') : message.result);
        emit({
          turnId: resultTurnId,
          parentEventId: null,
          kind: 'runtime.error',
          payload: {
            code: 'CLAUDE_TURN_FAILED',
            message: 'Claude could not complete this turn.',
            retryable: false,
            errorKind: message.subtype === 'error_max_budget_usd'
              ? 'usage_limit'
              : httpStatusErrorKind(message.api_error_status),
            providerMessage: words,
            attempt: null,
            resetsAt: null
          }
        });
      }
      completeTurn(
        resultTurnId,
        message.is_error === true ? 'failed' : 'completed',
        message.is_error === true ? 'Claude could not complete this turn.' : null
      );
    }
  };

  const startQuery = (): ClaudeQueryLike => {
    if (closed) throw new Error('The Claude session is closed.');
    if (query !== null) return query;
    if (queryFactory === null || sdkExecutablePath === null) {
      throw new Error('Claude is not ready.');
    }
    const nextInput = new AsyncInputQueue();
    const resumeSessionId = hasStartedQuery
      ? nativeSessionId
      : context.launch.nativeSessionId;
    const nextQuery = queryFactory({
      executablePath: sdkExecutablePath,
      workingDirectory: context.launch.workingDirectory,
      resumeSessionId,
      newSessionId: resumeSessionId === null ? nativeSessionId : null,
      settingSources: ['user', 'project', 'local'],
      input: nextInput,
      canUseTool,
      onElicitation
    });
    const generation = ++queryGeneration;
    hasStartedQuery = true;
    input = nextInput;
    query = nextQuery;
    const consuming = (async () => {
      let failure: Error | null = null;
      try {
        for await (const message of nextQuery) acceptMessage(message);
      } catch (error) {
        failure = error instanceof Error ? error : new Error('Claude stopped unexpectedly.');
      } finally {
        if (queryGeneration !== generation || query !== nextQuery) return;
        query = null;
        input = null;
        consumePromise = null;
        if (closed) return;
        const interruptedTurnId = currentTurnId;
        if (interruptedTurnId !== null) {
          completeTurn(
            interruptedTurnId,
            'failed',
            'Claude stopped before completing this turn. You can send the prompt again.'
          );
          emit({
            turnId: interruptedTurnId,
            parentEventId: null,
            kind: 'runtime.error',
            payload: {
              code: 'CLAUDE_QUERY_STOPPED',
              message: failure === null
                ? 'Claude stopped before the turn completed.'
                : 'Claude stopped unexpectedly before the turn completed.',
              retryable: true
            }
          });
        }
      }
    })();
    consumePromise = consuming;
    return nextQuery;
  };

  const submitPrompt = async (text: string, attachmentTokens: readonly string[]): Promise<void> => {
    if (nativeSessionId === null) throw new Error('Claude is not ready.');
    const images = attachmentTokens.length === 0
      ? []
      : context.resolveImages?.(attachmentTokens) ?? [];
    if (images.length !== attachmentTokens.length) {
      throw new Error('Claude images are not available for this session.');
    }
    if (text.trim().length === 0 && images.length === 0) return;
    if (currentTurnId !== null) throw new Error('Claude is already processing a prompt.');
    // Read every image before the turn begins, so a missing file fails the
    // prompt instead of leaving a turn started with nothing sent.
    const imageBlocks = await Promise.all(images.map(async (image) => ({
      type: 'image',
      source: {
        type: 'base64',
        media_type: image.mimeType,
        data: (await readFile(image.path)).toString('base64')
      }
    })));
    startQuery();
    for (let index = pendingResultTurnIds.length - 1; index >= 0; index -= 1) {
      if (completedTurnStates.has(pendingResultTurnIds[index]!)) {
        pendingResultTurnIds.splice(index, 1);
      }
    }
    turnNumber += 1;
    currentTurnId = `claude-turn-${turnNumber}`;
    const userMessageUuid = randomUUID();
    remember(turnIdByUserMessageUuid, userMessageUuid, currentTurnId);
    pendingResultTurnIds.push(currentTurnId);
    if (pendingResultTurnIds.length > 512) pendingResultTurnIds.shift();
    emit({
      turnId: currentTurnId,
      parentEventId: null,
      kind: 'turn.started',
      payload: { state: 'running', message: null }
    });
    emit({
      turnId: currentTurnId,
      parentEventId: null,
      kind: 'user.message',
      payload: images.length === 0
        ? { text: bounded(text) }
        : { text: text.trim() === '' ? '' : bounded(text), imageCount: images.length }
    });
    input!.push({
      type: 'user',
      message: {
        role: 'user',
        // Images before the text, as Claude reads them best.
        content: images.length === 0
          ? text
          : [...imageBlocks, ...(text.trim() === '' ? [] : [{ type: 'text', text }])]
      },
      parent_tool_use_id: null,
      session_id: nativeSessionId,
      uuid: userMessageUuid
    });
  };

  return {
    async open() {
      const dependencies = options.createQuery !== undefined && options.loadHistory !== undefined
        ? { createQuery: options.createQuery, loadHistory: options.loadHistory }
        : await loadDefaultDependencies();
      queryFactory = options.createQuery ?? dependencies.createQuery ?? defaultFactory;
      const loadHistory = options.loadHistory ?? dependencies.loadHistory;
      sdkExecutablePath = await (
        options.resolveSdkExecutablePath ?? resolveClaudeSdkExecutablePath
      )(context.launch.executablePath);
      startQuery();
      const history = context.launch.request.strategy === 'resume'
        ? await loadHistory(nativeSessionId, context.launch.workingDirectory)
        : [];
      opened = true;
      return {
        nativeSessionId,
        commands,
        initialEvents: historyEvents(history),
        acceptsImages: true
      };
    },

    async activate() {
      if (initialPromptSent) return;
      initialPromptSent = true;
      await submitPrompt(context.launch.request.startPrompt, []);
    },

    async dispatch(action: StructuredAgentAction) {
      if (action.kind === 'session.details.refresh') return;
      if (action.kind === 'command.execute') {
        const command = commands.find(({ id }) => id === action.commandId);
        if (command === undefined) throw new Error('The Claude command is not available.');
        if (command.id === 'model') {
          const model = modelChoices.find(({ value }) => value === action.argument.trim());
          if (model === undefined) throw new Error('The Claude model is not available.');
          await startQuery().setModel(model.value);
          selectedModel = model.value;
          publishCommands();
          return;
        }
        await submitPrompt(
          `${command.name}${action.argument.trim() === '' ? '' : ` ${action.argument.trim()}`}`,
          []
        );
        return;
      }
      if (action.kind === 'prompt.submit') {
        await submitPrompt(action.text, action.attachmentTokens);
        return;
      }
      if (action.kind === 'turn.cancel') {
        const turnId = currentTurnId;
        if (turnId === null) return;
        try {
          await query?.interrupt();
        } catch {
          // The provider may close while an interrupt is in flight. The user's
          // cancellation remains authoritative for the Lumora turn lifecycle.
        }
        const pendingIndex = pendingResultTurnIds.indexOf(turnId);
        if (pendingIndex !== -1) pendingResultTurnIds.splice(pendingIndex, 1);
        completeTurn(turnId, 'cancelled', null);
        return;
      }
      if (action.kind === 'question.respond') {
        const question = pendingQuestions.get(action.requestId);
        if (question === undefined) throw new Error('The Claude question is no longer pending.');
        let reply: unknown;
        if (question.kind === 'ask') {
          reply = action.outcome === 'decline'
            ? { behavior: 'deny', message: 'The user declined to answer.' }
            : {
              behavior: 'allow',
              updatedInput: {
                ...question.input,
                answers: Object.fromEntries([...question.prompts].map(([id, prompt]) => [
                  prompt,
                  (action.answers[id] ?? []).join(', ')
                ]))
              }
            };
        } else if (action.outcome === 'decline') {
          reply = { action: 'decline' };
        } else {
          // Checked before the question is let go, so a bad answer can be fixed.
          const content = question.form === null
            ? null
            : mcpFormContent(question.form, action.answers);
          reply = content === null ? { action: 'accept' } : { action: 'accept', content };
        }
        pendingQuestions.delete(action.requestId);
        question.resolve(reply);
        emit({
          turnId: question.turnId,
          parentEventId: null,
          kind: 'question.resolved',
          payload: {
            requestId: action.requestId,
            outcome: action.outcome === 'decline' ? 'declined' : 'answered'
          }
        });
        return;
      }
      const pending = pendingPermissions.get(action.approvalId);
      if (pending === undefined) throw new Error('The Claude permission is no longer pending.');
      pendingPermissions.delete(action.approvalId);
      if (action.decision === 'deny') {
        pending.resolve({ behavior: 'deny', message: 'The user denied this operation.' });
      } else {
        pending.resolve({
          behavior: 'allow',
          ...(action.decision === 'allow_session' && pending.suggestions.length > 0
            ? { updatedPermissions: pending.suggestions }
            : {})
        });
      }
      emit({
        turnId: pending.turnId,
        parentEventId: null,
        kind: 'approval.resolved',
        payload: { approvalId: action.approvalId, decision: action.decision }
      });
    },

    async close() {
      if (closed) return;
      closed = true;
      opened = false;
      for (const pending of pendingPermissions.values()) {
        pending.resolve({ behavior: 'deny', message: 'Lumora closed the session.' });
      }
      pendingPermissions.clear();
      settleQuestions(null);
      pendingDiffs.clear();
      turnIdByUserMessageUuid.clear();
      turnIdByAssistantMessageUuid.clear();
      pendingResultTurnIds.length = 0;
      completedTurnStates.clear();
      terminalStreamTurnIds.clear();
      input?.end();
      query?.close();
      await Promise.race([
        consumePromise ?? Promise.resolve(),
        new Promise<void>((resolve) => setTimeout(resolve, 1_000))
      ]);
      query = null;
    }
  };
}
