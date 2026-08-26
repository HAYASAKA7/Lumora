import { z } from 'zod';

import type {
  StructuredAgentAction
} from '../../../shared/agent/contracts';
import type { StructuredAgentEventDraft } from '../runtime/event-sequencer';
import {
  spawnStructuredLineTransport
} from '../transport/process-invocation';
import type {
  JsonRpcNotification,
  JsonRpcProviderRequest,
  LineJsonRpcTransport
} from '../transport/line-json-rpc';
import type {
  StructuredAgentAdapter,
  StructuredAgentAdapterContext
} from './structured-agent-adapter';

const ThreadItemSchema = z.object({
  type: z.string(),
  id: z.string().min(1),
  text: z.string().optional(),
  summary: z.array(z.string()).optional(),
  command: z.string().optional(),
  cwd: z.string().optional(),
  status: z.string().optional(),
  aggregatedOutput: z.string().nullable().optional(),
  changes: z.array(z.object({
    path: z.string().optional(),
    kind: z.string().optional()
  }).passthrough()).optional(),
  server: z.string().optional(),
  tool: z.string().optional()
}).passthrough();

const TurnSchema = z.object({
  id: z.string().min(1),
  status: z.string(),
  items: z.array(ThreadItemSchema).default([])
}).passthrough();

const ThreadResponseSchema = z.object({
  thread: z.object({
    id: z.string().min(1),
    turns: z.array(TurnSchema).default([])
  }).passthrough()
}).passthrough();

const TurnStartResponseSchema = z.object({ turn: TurnSchema }).passthrough();
const EnvelopeSchema = z.object({
  threadId: z.string().min(1),
  turnId: z.string().min(1).optional()
}).passthrough();

type ApprovalDecision = 'allow_once' | 'allow_session' | 'deny';

interface PendingApproval {
  method: string;
  turnId: string;
  resolve(value: unknown): void;
}

export interface CodexStructuredTransportFactoryOptions {
  executablePath: string;
  workingDirectory: string;
  handleRequest(request: JsonRpcProviderRequest): Promise<unknown>;
}

export type CodexStructuredTransportFactory = (
  options: CodexStructuredTransportFactoryOptions
) => Promise<LineJsonRpcTransport>;

export interface CreateCodexStructuredAdapterOptions {
  createTransport?: CodexStructuredTransportFactory;
}

function bounded(value: string, max = 65_536): string {
  const text = value.slice(0, max);
  return text.length === 0 ? ' ' : text;
}

function status(value: string): 'running' | 'completed' | 'failed' | 'cancelled' {
  if (value === 'completed') return 'completed';
  if (value === 'interrupted' || value === 'declined') return 'cancelled';
  if (value === 'failed') return 'failed';
  return 'running';
}

function itemEvents(
  turnId: string,
  item: z.infer<typeof ThreadItemSchema>,
  phase: 'started' | 'completed'
): StructuredAgentEventDraft[] {
  const parentEventId = null;
  if (item.type === 'agentMessage' && item.text?.length) {
    return [{
      turnId,
      parentEventId,
      kind: 'assistant.message',
      payload: { text: bounded(item.text) }
    }];
  }
  if (item.type === 'reasoning' && item.summary?.length) {
    return [{
      turnId,
      parentEventId,
      kind: 'reasoning.summary',
      payload: { text: bounded(item.summary.join('\n')) }
    }];
  }
  if (item.type === 'commandExecution') {
    const title = bounded(item.command ?? 'Command', 512);
    return [phase === 'started'
      ? {
        turnId,
        parentEventId,
        kind: 'command.started',
        payload: {
          activityId: item.id,
          title,
          detail: item.cwd ? bounded(item.cwd, 4_096) : null
        }
      }
      : {
        turnId,
        parentEventId,
        kind: 'command.updated',
        payload: {
          activityId: item.id,
          status: status(item.status ?? 'completed'),
          detail: item.aggregatedOutput === null || item.aggregatedOutput === undefined
            ? null
            : bounded(item.aggregatedOutput)
        }
      }];
  }
  if (item.type === 'fileChange') {
    return (item.changes ?? []).flatMap((change, index) => {
      if (!change.path) return [];
      const kind = change.kind?.toLowerCase() ?? 'update';
      const mapped = kind.includes('delete') ? 'deleted'
        : kind.includes('add') || kind.includes('create') ? 'created'
          : kind.includes('move') || kind.includes('rename') ? 'moved'
            : 'updated';
      return [{
        turnId,
        parentEventId,
        kind: 'file.changed' as const,
        payload: {
          activityId: `${item.id}:${index}`,
          title: 'File change',
          pathLabel: bounded(change.path, 4_096),
          change: mapped
        }
      }];
    });
  }
  if (item.type === 'mcpToolCall' || item.type === 'dynamicToolCall') {
    const title = bounded(
      [item.server, item.tool].filter(Boolean).join(' · ') || 'Tool',
      512
    );
    return [phase === 'started'
      ? {
        turnId,
        parentEventId,
        kind: 'tool.started',
        payload: { activityId: item.id, title, detail: null }
      }
      : {
        turnId,
        parentEventId,
        kind: 'tool.updated',
        payload: {
          activityId: item.id,
          status: status(item.status ?? 'completed'),
          detail: null
        }
      }];
  }
  return [];
}

function historyEvents(
  turns: readonly z.infer<typeof TurnSchema>[]
): StructuredAgentEventDraft[] {
  return turns.flatMap((turn) => [
    {
      turnId: turn.id,
      parentEventId: null,
      kind: 'turn.started' as const,
      payload: { state: 'running' as const, message: null }
    },
    ...turn.items.flatMap((item) => itemEvents(turn.id, item, 'completed')),
    {
      turnId: turn.id,
      parentEventId: null,
      kind: 'turn.completed' as const,
      payload: { state: status(turn.status), message: null }
    }
  ]);
}

function defaultTransportFactory(
  options: CodexStructuredTransportFactoryOptions
): Promise<LineJsonRpcTransport> {
  const platform = process.platform;
  if (platform !== 'win32' && platform !== 'darwin' && platform !== 'linux') {
    return Promise.reject(new Error('Unsupported platform.'));
  }
  return Promise.resolve(spawnStructuredLineTransport(
    options.executablePath,
    ['app-server', '--stdio'],
    {
      platform,
      env: process.env,
      cwd: options.workingDirectory,
      requestTimeoutMs: 30_000,
      maxFrameBytes: 4 * 1024 * 1024,
      handleRequest: options.handleRequest
    }
  ));
}

export function createCodexStructuredAdapter(
  context: StructuredAgentAdapterContext,
  options: CreateCodexStructuredAdapterOptions = {}
): StructuredAgentAdapter {
  if (context.providerId !== 'codex') {
    throw new Error('The Codex adapter requires a Codex context.');
  }
  const createTransport = options.createTransport ?? defaultTransportFactory;
  const pendingApprovals = new Map<string, PendingApproval>();
  let transport: LineJsonRpcTransport | null = null;
  let nativeSessionId = context.launch.nativeSessionId;
  let currentTurnId: string | null = null;
  let closed = false;
  let initialPromptSent = false;

  const emit = (event: StructuredAgentEventDraft): void => {
    if (!closed) context.callbacks.emit(event);
  };

  const handleRequest = async (request: JsonRpcProviderRequest): Promise<unknown> => {
    if (
      request.method !== 'item/commandExecution/requestApproval' &&
      request.method !== 'item/fileChange/requestApproval'
    ) {
      throw new Error('Unsupported Codex request.');
    }
    const parsed = EnvelopeSchema.safeParse(request.params);
    if (!parsed.success || parsed.data.threadId !== nativeSessionId || !parsed.data.turnId) {
      throw new Error('Invalid Codex approval request.');
    }
    const params = parsed.data as Record<string, unknown> & {
      turnId: string;
      itemId?: string;
      command?: string | null;
      reason?: string | null;
    };
    const approvalId = `codex-approval-${String(request.id)}`;
    const title = request.method.includes('commandExecution')
      ? bounded(params.command ?? 'Run command', 512)
      : 'Apply file changes';
    const detail = bounded(params.reason ?? title, 8_192);
    emit({
      turnId: params.turnId,
      parentEventId: null,
      kind: 'approval.requested',
      payload: {
        approvalId,
        title,
        detail,
        choices: ['allow_once', 'allow_session', 'deny']
      }
    });
    return new Promise((resolve) => {
      pendingApprovals.set(approvalId, {
        method: request.method,
        turnId: params.turnId,
        resolve
      });
    });
  };

  const acceptNotification = (notification: JsonRpcNotification): void => {
    const parsed = EnvelopeSchema.safeParse(notification.params);
    if (!parsed.success || parsed.data.threadId !== nativeSessionId) return;
    const params = parsed.data as Record<string, unknown> & {
      turnId?: string;
      itemId?: string;
      delta?: string;
      turn?: unknown;
      item?: unknown;
      plan?: unknown;
      tokenUsage?: unknown;
      willRetry?: boolean;
    };
    const turnId = params.turnId;
    if (notification.method === 'turn/started') {
      const turn = TurnSchema.safeParse(params.turn);
      if (!turn.success) return;
      currentTurnId = turn.data.id;
      emit({
        turnId: turn.data.id,
        parentEventId: null,
        kind: 'turn.started',
        payload: { state: 'running', message: null }
      });
      return;
    }
    if (notification.method === 'turn/completed') {
      const turn = TurnSchema.safeParse(params.turn);
      if (!turn.success) return;
      if (currentTurnId === turn.data.id) currentTurnId = null;
      emit({
        turnId: turn.data.id,
        parentEventId: null,
        kind: 'turn.completed',
        payload: { state: status(turn.data.status), message: null }
      });
      return;
    }
    if (!turnId) return;
    if (notification.method === 'item/agentMessage/delta' && params.delta) {
      emit({
        turnId, parentEventId: null, kind: 'assistant.delta',
        payload: { text: bounded(params.delta) }
      });
      return;
    }
    if (notification.method === 'item/reasoning/summaryTextDelta' && params.delta) {
      emit({
        turnId, parentEventId: null, kind: 'reasoning.summary',
        payload: { text: bounded(params.delta) }
      });
      return;
    }
    if (notification.method === 'item/started' || notification.method === 'item/completed') {
      const item = ThreadItemSchema.safeParse(params.item);
      if (!item.success) return;
      for (const event of itemEvents(
        turnId,
        item.data,
        notification.method === 'item/started' ? 'started' : 'completed'
      )) emit(event);
      return;
    }
    if (notification.method === 'item/commandExecution/outputDelta' && params.itemId && params.delta) {
      emit({
        turnId,
        parentEventId: null,
        kind: 'command.updated',
        payload: {
          activityId: params.itemId,
          status: 'running',
          detail: bounded(params.delta)
        }
      });
      return;
    }
    if (notification.method === 'turn/plan/updated') {
      const plan = z.array(z.object({
        step: z.string().min(1), status: z.string()
      })).safeParse(params.plan);
      if (!plan.success) return;
      emit({
        turnId,
        parentEventId: null,
        kind: 'plan.updated',
        payload: {
          items: plan.data.slice(0, 100).map((item, index) => ({
            id: `${turnId}:${index}`,
            text: bounded(item.step, 2_048),
            status: item.status === 'completed' ? 'completed'
              : item.status === 'inProgress' ? 'in_progress'
                : 'pending'
          }))
        }
      });
      return;
    }
    if (notification.method === 'thread/tokenUsage/updated') {
      const usage = z.object({ total: z.object({
        inputTokens: z.number().int().nonnegative(),
        cachedInputTokens: z.number().int().nonnegative(),
        outputTokens: z.number().int().nonnegative(),
        totalTokens: z.number().int().nonnegative()
      }).passthrough() }).safeParse(params.tokenUsage);
      if (!usage.success) return;
      emit({
        turnId,
        parentEventId: null,
        kind: 'usage.updated',
        payload: usage.data.total
      });
      return;
    }
    if (notification.method === 'error') {
      emit({
        turnId,
        parentEventId: null,
        kind: 'runtime.error',
        payload: {
          code: 'CODEX_RUNTIME_ERROR',
          message: 'Codex reported a structured runtime error.',
          retryable: params.willRetry === true
        }
      });
    }
  };

  const submitPrompt = async (text: string, attachmentTokens: readonly string[]): Promise<void> => {
    if (transport === null || nativeSessionId === null) throw new Error('Codex is not ready.');
    if (attachmentTokens.length > 0) {
      throw new Error('Codex structured attachments are not available yet.');
    }
    if (text.trim().length === 0) return;
    const parsed = TurnStartResponseSchema.parse(await transport.request('turn/start', {
      threadId: nativeSessionId,
      input: [{ type: 'text', text, text_elements: [] }]
    }));
    currentTurnId = parsed.turn.id;
    emit({
      turnId: parsed.turn.id,
      parentEventId: null,
      kind: 'user.message',
      payload: { text: bounded(text, 65_536) }
    });
  };

  return {
    async open() {
      transport = await createTransport({
        executablePath: context.launch.executablePath,
        workingDirectory: context.launch.workingDirectory,
        handleRequest
      });
      transport.onNotification(acceptNotification);
      transport.onExit((error) => {
        if (!closed) context.callbacks.exited(error);
      });
      await transport.request('initialize', {
        clientInfo: { name: 'lumora', title: 'Lumora', version: '0.4.2' },
        capabilities: null
      });
      await transport.notify('initialized');
      const response = ThreadResponseSchema.parse(
        context.launch.request.strategy === 'new'
          ? await transport.request('thread/start', {
            cwd: context.launch.workingDirectory,
            ephemeral: false
          })
          : await transport.request('thread/resume', {
            threadId: context.launch.nativeSessionId,
            cwd: context.launch.workingDirectory
          })
      );
      if (
        context.launch.nativeSessionId !== null &&
        response.thread.id !== context.launch.nativeSessionId
      ) {
        throw new Error('Codex returned a different native session.');
      }
      nativeSessionId = response.thread.id;
      return {
        nativeSessionId,
        initialEvents: historyEvents(response.thread.turns)
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
        if (transport !== null && nativeSessionId !== null && currentTurnId !== null) {
          await transport.request('turn/interrupt', {
            threadId: nativeSessionId,
            turnId: currentTurnId
          });
        }
        return;
      }
      const pending = pendingApprovals.get(action.approvalId);
      if (pending === undefined) throw new Error('The Codex approval is no longer pending.');
      pendingApprovals.delete(action.approvalId);
      const decision: ApprovalDecision = action.decision;
      const codexDecision = decision === 'allow_once' ? 'accept'
        : decision === 'allow_session' ? 'acceptForSession'
          : 'decline';
      pending.resolve({ decision: codexDecision });
      emit({
        turnId: pending.turnId,
        parentEventId: null,
        kind: 'approval.resolved',
        payload: { approvalId: action.approvalId, decision }
      });
    },

    async close() {
      if (closed) return;
      closed = true;
      for (const pending of pendingApprovals.values()) {
        pending.resolve({ decision: 'cancel' });
      }
      pendingApprovals.clear();
      await transport?.close();
      transport = null;
    }
  };
}
