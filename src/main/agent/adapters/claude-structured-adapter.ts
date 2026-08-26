import { randomUUID } from 'node:crypto';

import type { StructuredAgentAction } from '../../../shared/agent/contracts';
import type { StructuredAgentEventDraft } from '../runtime/event-sequencer';
import type {
  StructuredAgentAdapter,
  StructuredAgentAdapterContext
} from './structured-agent-adapter';

export interface ClaudeQueryLike extends AsyncIterable<unknown> {
  interrupt(): Promise<unknown>;
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
}

export type ClaudeCanUseTool = (
  toolName: string,
  input: Record<string, unknown>,
  options: ClaudePermissionOptions
) => Promise<unknown>;

export interface ClaudeStructuredQueryFactoryOptions {
  executablePath: string;
  workingDirectory: string;
  resumeSessionId: string | null;
  settingSources: readonly ['user', 'project', 'local'];
  input: AsyncIterable<unknown>;
  canUseTool: ClaudeCanUseTool;
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
}

interface PendingPermission {
  turnId: string;
  suggestions: unknown[];
  resolve(value: unknown): void;
}

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
        ...(options.resumeSessionId === null
          ? {}
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
  const input = new AsyncInputQueue();
  const pendingPermissions = new Map<string, PendingPermission>();
  let query: ClaudeQueryLike | null = null;
  let consumePromise: Promise<void> | null = null;
  let nativeSessionId = context.launch.nativeSessionId;
  let currentTurnId: string | null = null;
  let turnNumber = 0;
  let closed = false;
  let opened = false;
  let initialPromptSent = false;
  let resolveInit: ((sessionId: string) => void) | null = null;
  let rejectInit: ((error: Error) => void) | null = null;

  const initPromise = new Promise<string>((resolve, reject) => {
    resolveInit = resolve;
    rejectInit = reject;
  });

  const emit = (event: StructuredAgentEventDraft): void => {
    if (opened && !closed) context.callbacks.emit(event);
  };

  const canUseTool: ClaudeCanUseTool = async (toolName, toolInput, permission) => {
    const turnId = currentTurnId ?? `claude-turn-${Math.max(1, turnNumber)}`;
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
        rejectInit?.(new Error('Claude returned a different native session.'));
        return;
      }
      nativeSessionId = sessionId;
      resolveInit?.(sessionId);
      resolveInit = null;
      rejectInit = null;
      return;
    }
    if (sessionId !== null && nativeSessionId !== null && sessionId !== nativeSessionId) return;
    const turnId = currentTurnId ?? `claude-turn-${Math.max(1, turnNumber)}`;

    if (message.type === 'stream_event') {
      const event = object(message.event);
      const delta = object(event?.delta);
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
          emit({
            turnId,
            parentEventId: null,
            kind: 'tool.started',
            payload: {
              activityId: block.id,
              title: bounded(stringValue(block.name) ?? 'Tool', 512),
              detail: null
            }
          });
        }
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
      }
      return;
    }

    if (message.type === 'result') {
      const usage = object(message.usage);
      const inputTokens = typeof usage?.input_tokens === 'number' ? usage.input_tokens : null;
      const cachedInputTokens = typeof usage?.cache_read_input_tokens === 'number'
        ? usage.cache_read_input_tokens
        : null;
      const outputTokens = typeof usage?.output_tokens === 'number' ? usage.output_tokens : null;
      emit({
        turnId,
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
      emit({
        turnId,
        parentEventId: null,
        kind: 'turn.completed',
        payload: {
          state: message.is_error === true ? 'failed' : 'completed',
          message: message.is_error === true ? 'Claude could not complete this turn.' : null
        }
      });
      currentTurnId = null;
    }
  };

  const submitPrompt = async (text: string, attachmentTokens: readonly string[]): Promise<void> => {
    if (nativeSessionId === null) throw new Error('Claude is not ready.');
    if (attachmentTokens.length > 0) {
      throw new Error('Claude structured attachments are not available yet.');
    }
    if (text.trim().length === 0) return;
    turnNumber += 1;
    currentTurnId = `claude-turn-${turnNumber}`;
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
      payload: { text: bounded(text) }
    });
    input.push({
      type: 'user',
      message: { role: 'user', content: text },
      parent_tool_use_id: null,
      session_id: nativeSessionId,
      uuid: randomUUID()
    });
  };

  return {
    async open() {
      const dependencies = options.createQuery !== undefined && options.loadHistory !== undefined
        ? { createQuery: options.createQuery, loadHistory: options.loadHistory }
        : await loadDefaultDependencies();
      const createQuery = options.createQuery ?? dependencies.createQuery ?? defaultFactory;
      const loadHistory = options.loadHistory ?? dependencies.loadHistory;
      query = createQuery({
        executablePath: context.launch.executablePath,
        workingDirectory: context.launch.workingDirectory,
        resumeSessionId: context.launch.nativeSessionId,
        settingSources: ['user', 'project', 'local'],
        input,
        canUseTool
      });
      consumePromise = (async () => {
        try {
          for await (const message of query!) acceptMessage(message);
          if (!closed) {
            rejectInit?.(new Error('Claude exited before initialization.'));
            context.callbacks.exited(null);
          }
        } catch (error) {
          const normalized = error instanceof Error ? error : new Error('Claude stopped unexpectedly.');
          rejectInit?.(normalized);
          if (!closed) context.callbacks.exited(normalized);
        }
      })();
      const sessionId = await initPromise;
      const history = context.launch.request.strategy === 'resume'
        ? await loadHistory(sessionId, context.launch.workingDirectory)
        : [];
      opened = true;
      return {
        nativeSessionId: sessionId,
        initialEvents: historyEvents(history)
      };
    },

    async activate() {
      if (initialPromptSent) return;
      initialPromptSent = true;
      await submitPrompt(context.launch.request.startPrompt, []);
    },

    async dispatch(action: StructuredAgentAction) {
      if (action.kind === 'prompt.submit') {
        await submitPrompt(action.text, action.attachmentTokens);
        return;
      }
      if (action.kind === 'turn.cancel') {
        await query?.interrupt();
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
      input.end();
      query?.close();
      await Promise.race([
        consumePromise ?? Promise.resolve(),
        new Promise<void>((resolve) => setTimeout(resolve, 1_000))
      ]);
      query = null;
    }
  };
}
