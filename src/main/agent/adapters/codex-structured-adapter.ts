import { z } from 'zod';

import type {
  StructuredAgentAction
} from '../../../shared/agent/contracts';
import type { StructuredAgentEventDraft } from '../runtime/event-sequencer';
import { parseGitUnifiedDiff } from '../diff/unified-diff';
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
import {
  buildCodexCommands,
  CodexMcpStatusListSchema,
  discoverCodexCommands,
  type CodexCommandDiscovery
} from './codex-command-registry';

const ThreadItemSchema = z.object({
  type: z.string(),
  id: z.string().min(1),
  text: z.string().optional(),
  content: z.array(z.object({
    type: z.string(),
    text: z.string().optional()
  }).passthrough()).optional(),
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
  tool: z.string().optional(),
  query: z.string().optional(),
  path: z.string().optional(),
  durationMs: z.number().nonnegative().nullable().optional(),
  review: z.string().optional(),
  result: z.unknown().optional(),
  kind: z.string().optional(),
  success: z.boolean().nullable().optional()
}).passthrough();

const TurnSchema = z.object({
  id: z.string().min(1),
  status: z.string(),
  items: z.array(ThreadItemSchema).default([])
}).passthrough();

const TurnLifecycleSchema = z.object({
  id: z.string().min(1),
  status: z.string()
}).passthrough();

const ThreadResponseSchema = z.object({
  model: z.string().trim().min(1).max(256).optional(),
  reasoningEffort: z.string().trim().min(1).max(128).nullable().optional(),
  serviceTier: z.string().trim().min(1).max(128).nullable().optional(),
  thread: z.object({
    id: z.string().min(1),
    turns: z.array(TurnSchema).default([])
  }).passthrough(),
  initialTurnsPage: z.object({
    data: z.array(TurnSchema),
    nextCursor: z.string().nullable().optional()
  }).passthrough().nullable().optional()
}).passthrough();

const TurnStartResponseSchema = z.object({ turn: TurnLifecycleSchema }).passthrough();
const EnvelopeSchema = z.object({
  threadId: z.string().min(1),
  turnId: z.string().min(1).optional()
}).passthrough();
const ThreadSettingsSchema = z.object({
  model: z.string().trim().min(1).max(256),
  serviceTier: z.string().trim().min(1).max(128).nullable().optional(),
  effort: z.string().trim().min(1).max(128).nullable(),
  personality: z.enum(['none', 'friendly', 'pragmatic']).nullable().optional(),
  activePermissionProfile: z.object({
    id: z.string().trim().min(1).max(256)
  }).passthrough().nullable().optional(),
  collaborationMode: z.object({
    mode: z.string().trim().min(1).max(128)
  }).passthrough().optional()
}).passthrough();

const CodexGoalSchema = z.object({
  objective: z.string().max(4_000),
  status: z.string().trim().min(1).max(64),
  tokenBudget: z.number().int().nonnegative().nullable().optional(),
  tokensUsed: z.number().int().nonnegative().optional(),
  timeUsedSeconds: z.number().int().nonnegative().optional()
}).passthrough();
const CodexGoalResponseSchema = z.object({ goal: CodexGoalSchema.nullable() }).passthrough();
const CodexBackgroundTerminalsSchema = z.object({
  data: z.array(z.object({
    processId: z.string().trim().min(1).max(256),
    command: z.string().max(8_192),
    cwd: z.string().max(8_192),
    osPid: z.number().int().nonnegative().nullable().optional(),
    cpuPercent: z.number().nonnegative().nullable().optional(),
    rssKb: z.number().nonnegative().nullable().optional()
  }).passthrough()).max(256)
}).passthrough();
const CodexAppsSchema = z.object({
  data: z.array(z.object({
    name: z.string().trim().min(1).max(256),
    description: z.string().max(512).nullable().optional(),
    isAccessible: z.boolean(),
    isEnabled: z.boolean()
  }).passthrough()).max(256)
}).passthrough();
const CodexPluginsSchema = z.object({
  marketplaces: z.array(z.object({
    name: z.string().trim().min(1).max(256),
    plugins: z.array(z.object({
      name: z.string().trim().min(1).max(256),
      installed: z.boolean(),
      enabled: z.boolean(),
      version: z.string().max(128).nullable().optional(),
      localVersion: z.string().max(128).nullable().optional(),
      availability: z.string().max(128)
    }).passthrough()).max(256)
  }).passthrough()).max(64)
}).passthrough();
const CodexHooksSchema = z.object({
  data: z.array(z.object({
    hooks: z.array(z.object({
      key: z.string().trim().min(1).max(512),
      eventName: z.string().trim().min(1).max(128),
      enabled: z.boolean(),
      trustStatus: z.string().trim().min(1).max(128)
    }).passthrough()).max(256)
  }).passthrough()).max(32)
}).passthrough();
const CodexRateLimitsSchema = z.object({
  rateLimits: z.object({
    limitName: z.string().max(256).nullable().optional(),
    planType: z.string().trim().min(1).max(128).nullable().optional(),
    primary: z.object({
      usedPercent: z.number().min(0),
      windowDurationMins: z.number().nonnegative().nullable().optional(),
      resetsAt: z.number().nonnegative().nullable().optional()
    }).passthrough().nullable().optional(),
    secondary: z.object({
      usedPercent: z.number().min(0),
      windowDurationMins: z.number().nonnegative().nullable().optional(),
      resetsAt: z.number().nonnegative().nullable().optional()
    }).passthrough().nullable().optional()
  }).passthrough()
}).passthrough();
const CodexAccountUsageSchema = z.object({
  summary: z.object({
    lifetimeTokens: z.number().int().nonnegative().nullable().optional(),
    peakDailyTokens: z.number().int().nonnegative().nullable().optional(),
    longestRunningTurnSec: z.number().int().nonnegative().nullable().optional(),
    currentStreakDays: z.number().int().nonnegative().nullable().optional(),
    longestStreakDays: z.number().int().nonnegative().nullable().optional()
  }).passthrough()
}).passthrough();
const CodexGitDiffSchema = z.object({
  sha: z.string().trim().min(1).max(256),
  diff: z.string().max(1_000_000)
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

function numberLabel(value: number | null | undefined): string {
  return value === null || value === undefined ? 'unavailable' : value.toLocaleString('en-US');
}

function goalDetail(goal: z.infer<typeof CodexGoalSchema> | null): string | null {
  if (goal === null) return null;
  return [
    `${goal.objective} — ${goal.status}`,
    `Tokens used: ${numberLabel(goal.tokensUsed)}`,
    `Time used: ${numberLabel(goal.timeUsedSeconds)} seconds`,
    ...(goal.tokenBudget === null || goal.tokenBudget === undefined
      ? []
      : [`Token budget: ${numberLabel(goal.tokenBudget)}`])
  ].join('\n');
}

function toolItemPresentation(
  item: z.infer<typeof ThreadItemSchema>
): { title: string; detail: string | null } | null {
  if (item.type === 'mcpToolCall' || item.type === 'dynamicToolCall') {
    return {
      title: [item.server, item.tool].filter(Boolean).join(' · ') || 'Tool',
      detail: null
    };
  }
  if (item.type === 'collabAgentToolCall') {
    return { title: item.tool ?? 'Agent collaboration', detail: null };
  }
  if (item.type === 'subAgentActivity') {
    return { title: 'Agent activity', detail: item.kind ?? null };
  }
  if (item.type === 'webSearch') {
    return { title: 'Search web', detail: item.query ?? null };
  }
  if (item.type === 'imageView') {
    return { title: 'View image', detail: item.path ?? null };
  }
  if (item.type === 'sleep') {
    return {
      title: 'Wait',
      detail: item.durationMs === undefined ? null : `${item.durationMs} ms`
    };
  }
  if (item.type === 'imageGeneration') {
    return {
      title: 'Generate image',
      detail: typeof item.result === 'string' ? item.result : null
    };
  }
  if (item.type === 'enteredReviewMode') {
    return { title: 'Enter review mode', detail: item.review ?? null };
  }
  if (item.type === 'exitedReviewMode') {
    return { title: 'Exit review mode', detail: item.review ?? null };
  }
  if (item.type === 'contextCompaction') {
    return { title: 'Compact context', detail: null };
  }
  return null;
}

function itemEvents(
  turnId: string,
  item: z.infer<typeof ThreadItemSchema>,
  phase: 'started' | 'completed'
): StructuredAgentEventDraft[] {
  const parentEventId = null;
  if (item.type === 'userMessage' && item.content?.length) {
    const text = item.content
      .filter((content) => content.type === 'text' && content.text?.length)
      .map((content) => content.text)
      .join('\n');
    if (text.length > 0) {
      return [{
        turnId,
        parentEventId,
        kind: 'user.message',
        payload: { text: bounded(text) }
      }];
    }
  }
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
          title,
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
  const toolPresentation = toolItemPresentation(item);
  if (toolPresentation !== null) {
    const title = bounded(toolPresentation.title, 512);
    const detail = toolPresentation.detail === null
      ? null
      : bounded(toolPresentation.detail, 4_096);
    return [phase === 'started'
      ? {
        turnId,
        parentEventId,
        kind: 'tool.started',
        payload: { activityId: item.id, title, detail }
      }
      : {
        turnId,
        parentEventId,
        kind: 'tool.updated',
        payload: {
          activityId: item.id,
          title,
          status: item.success === false
            ? 'failed'
            : status(item.status ?? 'completed'),
          detail
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
  let commandSequence = 0;
  let commandDiscovery: CodexCommandDiscovery = {
    models: [],
    permissionProfiles: [],
    skills: []
  };
  let selectedModel: string | null = null;
  let selectedEffort: string | null = null;
  let selectedServiceTier: string | null = null;
  let selectedPersonality: 'none' | 'friendly' | 'pragmatic' | null = null;
  let selectedPermissionProfile: string | null = null;
  let selectedCollaborationMode = 'default';
  let receivedSettings = false;
  const diffRefreshGenerations = new Map<string, number>();

  const emit = (event: StructuredAgentEventDraft): void => {
    if (!closed) context.callbacks.emit(event);
  };

  const refreshWorkspaceDiff = async (turnId: string): Promise<void> => {
    const activeTransport = transport;
    if (activeTransport === null || closed) return;
    const generation = (diffRefreshGenerations.get(turnId) ?? 0) + 1;
    diffRefreshGenerations.set(turnId, generation);
    try {
      const response = CodexGitDiffSchema.parse(
        await activeTransport.request('gitDiffToRemote', {
          cwd: context.launch.workingDirectory
        })
      );
      if (closed || diffRefreshGenerations.get(turnId) !== generation) return;
      const files = parseGitUnifiedDiff(response.diff);
      if (files.length === 0) return;
      emit({
        turnId,
        parentEventId: null,
        kind: 'diff.updated',
        payload: { diffId: `${turnId}:workspace`.slice(0, 256), files }
      });
    } catch {
      // File activity remains visible when the provider cannot produce a diff.
    }
  };

  const emitCommandResponse = (
    commandId: string,
    commandText: string,
    detail: string | null,
    result: 'completed' | 'failed' = 'completed'
  ): void => {
    const turnId = `codex-command-${++commandSequence}-${commandId}`;
    emit({
      turnId,
      parentEventId: null,
      kind: 'turn.started',
      payload: { state: 'running', message: null }
    });
    emit({
      turnId,
      parentEventId: null,
      kind: 'user.message',
      payload: { text: bounded(commandText, 65_536) }
    });
    emit({
      turnId,
      parentEventId: null,
      kind: 'command.started',
      payload: {
        activityId: turnId,
        title: bounded(commandText, 512),
        detail: null
      }
    });
    emit({
      turnId,
      parentEventId: null,
      kind: 'command.updated',
      payload: {
        activityId: turnId,
        title: bounded(commandText, 512),
        status: result,
        detail: detail === null
          ? result === 'completed' ? 'Completed.' : 'The command failed.'
          : bounded(detail)
      }
    });
    emit({
      turnId,
      parentEventId: null,
      kind: 'turn.completed',
      payload: { state: result, message: null }
    });
  };

  const refreshCommands = (): void => {
    context.callbacks.commandsChanged?.(
      buildCodexCommands(commandDiscovery, selectedModel)
    );
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
    if (notification.method === 'thread/settings/updated') {
      const settings = ThreadSettingsSchema.safeParse(params.threadSettings);
      if (!settings.success) return;
      selectedModel = settings.data.model;
      selectedEffort = settings.data.effort;
      selectedServiceTier = settings.data.serviceTier ?? null;
      selectedPersonality = settings.data.personality ?? null;
      selectedPermissionProfile = settings.data.activePermissionProfile?.id ?? null;
      selectedCollaborationMode = settings.data.collaborationMode?.mode ?? 'default';
      receivedSettings = true;
      refreshCommands();
      return;
    }
    if (notification.method === 'turn/started') {
      const turn = TurnLifecycleSchema.safeParse(params.turn);
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
      const turn = TurnLifecycleSchema.safeParse(params.turn);
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
      if (notification.method === 'item/completed' && item.data.type === 'fileChange') {
        void refreshWorkspaceDiff(turnId);
      }
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
        payload: {
          inputTokens: usage.data.total.inputTokens,
          cachedInputTokens: usage.data.total.cachedInputTokens,
          outputTokens: usage.data.total.outputTokens,
          totalTokens: usage.data.total.totalTokens
        }
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

  const startTurn = async (
    input: readonly Record<string, unknown>[],
    displayText: string
  ): Promise<void> => {
    if (transport === null || nativeSessionId === null) throw new Error('Codex is not ready.');
    const parsed = TurnStartResponseSchema.parse(await transport.request('turn/start', {
      threadId: nativeSessionId,
      input
    }));
    currentTurnId = parsed.turn.id;
    emit({
      turnId: parsed.turn.id,
      parentEventId: null,
      kind: 'user.message',
      payload: { text: bounded(displayText, 65_536) }
    });
  };

  const submitPrompt = async (text: string, attachmentTokens: readonly string[]): Promise<void> => {
    if (attachmentTokens.length > 0) {
      throw new Error('Codex structured attachments are not available yet.');
    }
    if (text.trim().length === 0) return;
    await startTurn([{ type: 'text', text, text_elements: [] }], text);
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
        clientInfo: {
          name: 'lumora',
          title: 'Lumora',
          version: context.clientVersion ?? 'unknown'
        },
        capabilities: { experimentalApi: true }
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
            cwd: context.launch.workingDirectory,
            excludeTurns: true,
            initialTurnsPage: {
              limit: 24,
              sortDirection: 'desc',
              itemsView: 'summary'
            }
          })
      );
      if (
        context.launch.nativeSessionId !== null &&
        response.thread.id !== context.launch.nativeSessionId
      ) {
        throw new Error('Codex returned a different native session.');
      }
      nativeSessionId = response.thread.id;
      const history = response.initialTurnsPage?.data === undefined
        ? response.thread.turns
        : [...response.initialTurnsPage.data].reverse();
      selectedModel = response.model
        ?? (receivedSettings ? selectedModel : null);
      selectedEffort = response.reasoningEffort !== undefined
        ? response.reasoningEffort
        : (receivedSettings ? selectedEffort : null);
      selectedServiceTier = response.serviceTier !== undefined
        ? response.serviceTier
        : (receivedSettings ? selectedServiceTier : null);
      const initialCommands = buildCodexCommands(commandDiscovery, selectedModel);
      void discoverCodexCommands(
        (method, params) => {
          if (transport === null) throw new Error('Codex is not ready.');
          return transport.request(method, params);
        },
        context.launch.workingDirectory
      ).then((discovery) => {
        if (closed) return;
        commandDiscovery = discovery;
        const defaultModel = commandDiscovery.models.find(({ isDefault }) => isDefault)
          ?? commandDiscovery.models[0]
          ?? null;
        selectedModel = response.model
          ?? (receivedSettings ? selectedModel : defaultModel?.model ?? null);
        selectedEffort = response.reasoningEffort !== undefined
          ? response.reasoningEffort
          : (receivedSettings ? selectedEffort : defaultModel?.defaultEffort ?? null);
        selectedServiceTier = response.serviceTier !== undefined
          ? response.serviceTier
          : (receivedSettings ? selectedServiceTier : defaultModel?.defaultServiceTier ?? null);
        refreshCommands();
      }).catch(() => undefined);
      return {
        nativeSessionId,
        commands: initialCommands,
        initialEvents: historyEvents(history)
      };
    },

    async activate() {
      if (initialPromptSent) return;
      initialPromptSent = true;
      await submitPrompt(context.launch.request.startPrompt, []);
    },

    async dispatch(action: StructuredAgentAction) {
      if (action.kind === 'session.details.refresh') {
        if (transport === null || nativeSessionId === null) {
          throw new Error('Codex is not ready.');
        }
        const rateLimits = CodexRateLimitsSchema.parse(
          await transport.request('account/rateLimits/read', undefined)
        ).rateLimits;
        const windows = ([
          ['primary', rateLimits.primary],
          ['secondary', rateLimits.secondary]
        ] as const).flatMap(([kind, window]) => (
          window === null || window === undefined
            ? []
            : [{
                kind,
                usedPercent: window.usedPercent,
                windowDurationMinutes: window.windowDurationMins ?? null,
                resetsAt: window.resetsAt ?? null
              }]
        ));
        emit({
          turnId: currentTurnId ?? nativeSessionId,
          parentEventId: null,
          kind: 'account.usage.updated',
          payload: {
            plan: rateLimits.planType ?? null,
            windows
          }
        });
        return;
      }
      if (action.kind === 'command.execute') {
        if (transport === null || nativeSessionId === null) {
          throw new Error('Codex is not ready.');
        }
        const argument = action.argument.trim();
        const respond = (
          commandId: string,
          commandName: string,
          detail: string | null,
          result: 'completed' | 'failed' = 'completed'
        ): void => {
          emitCommandResponse(
            commandId,
            argument === '' ? commandName : `${commandName} ${argument}`,
            detail,
            result
          );
        };
        if (action.commandId === 'model') {
          const model = commandDiscovery.models.find((candidate) => candidate.model === argument);
          if (model === undefined) throw new Error('The requested Codex model is not available.');
          await transport.request('thread/settings/update', {
            threadId: nativeSessionId,
            model: model.model
          });
          selectedModel = model.model;
          selectedEffort = model.defaultEffort;
          selectedServiceTier = model.defaultServiceTier;
          refreshCommands();
          respond('model', '/model', model.displayName);
          return;
        }
        if (action.commandId === 'effort') {
          const model = commandDiscovery.models.find((candidate) => (
            candidate.model === selectedModel
          ));
          const effort = model?.efforts.find((candidate) => candidate.value === argument);
          if (effort === undefined) throw new Error('The requested reasoning effort is not available.');
          await transport.request('thread/settings/update', {
            threadId: nativeSessionId,
            effort: effort.value
          });
          selectedEffort = effort.value;
          respond('effort', '/reasoning', effort.value);
          return;
        }
        if (action.commandId === 'fast') {
          const model = commandDiscovery.models.find(({ model }) => model === selectedModel);
          const fastTier = model?.serviceTiers.find(({ id }) => id === 'fast')
            ?? model?.serviceTiers.find(({ id }) => id === 'priority');
          if (fastTier === undefined) throw new Error('Fast mode is not available for this model.');
          const serviceTier = selectedServiceTier === fastTier.id ? null : fastTier.id;
          await transport.request('thread/settings/update', {
            threadId: nativeSessionId,
            serviceTier
          });
          selectedServiceTier = serviceTier;
          respond('fast', '/fast', serviceTier === null ? 'Off' : fastTier.name);
          return;
        }
        if (action.commandId === 'personality') {
          if (argument !== 'friendly' && argument !== 'pragmatic' && argument !== 'none') {
            throw new Error('The requested Codex personality is not available.');
          }
          const model = commandDiscovery.models.find(({ model }) => model === selectedModel);
          if (model?.supportsPersonality !== true) {
            throw new Error('Personality controls are not available for this model.');
          }
          await transport.request('thread/settings/update', {
            threadId: nativeSessionId,
            personality: argument
          });
          selectedPersonality = argument;
          respond('personality', '/personality', argument);
          return;
        }
        if (action.commandId === 'mode') {
          if (selectedModel === null) {
            throw new Error('Codex did not expose a model for collaboration mode.');
          }
          await transport.request('thread/settings/update', {
            threadId: nativeSessionId,
            collaborationMode: {
              mode: 'plan',
              settings: {
                model: selectedModel,
                reasoning_effort: selectedEffort,
                developer_instructions: null
              }
            }
          });
          selectedCollaborationMode = 'plan';
          respond('mode', '/plan', 'Plan mode');
          if (argument !== '') {
            await startTurn([{ type: 'text', text: argument, text_elements: [] }], argument);
          }
          return;
        }
        if (action.commandId === 'compact') {
          await transport.request('thread/compact/start', { threadId: nativeSessionId });
          respond('compact', '/compact', 'Context compacted.');
          return;
        }
        if (action.commandId === 'diff') {
          const response = CodexGitDiffSchema.parse(
            await transport.request('gitDiffToRemote', {
              cwd: context.launch.workingDirectory
            })
          );
          respond('diff', '/diff', response.diff.trim() === '' ? null : response.diff);
          return;
        }
        if (action.commandId === 'review') {
          await transport.request('review/start', {
            threadId: nativeSessionId,
            target: action.argument.trim() === ''
              ? { type: 'uncommittedChanges' }
              : { type: 'custom', instructions: action.argument.trim() }
          });
          return;
        }
        if (action.commandId === 'permissions') {
          const profile = commandDiscovery.permissionProfiles.find(({ id }) => id === argument);
          if (profile === undefined) {
            throw new Error('The requested Codex permission profile is not available.');
          }
          await transport.request('thread/settings/update', {
            threadId: nativeSessionId,
            permissions: profile.id
          });
          selectedPermissionProfile = profile.id;
          respond('permissions', '/permissions', profile.id);
          return;
        }
        if (action.commandId === 'goal') {
          if (argument === '') {
            const response = CodexGoalResponseSchema.parse(
              await transport.request('thread/goal/get', { threadId: nativeSessionId })
            );
            respond('goal', '/goal', goalDetail(response.goal));
            return;
          }
          if (argument === 'clear') {
            await transport.request('thread/goal/clear', { threadId: nativeSessionId });
            respond('goal', '/goal', 'Goal cleared');
            return;
          }
          if (argument === 'pause' || argument === 'resume') {
            const current = CodexGoalResponseSchema.parse(
              await transport.request('thread/goal/get', { threadId: nativeSessionId })
            );
            if (current.goal === null) throw new Error('This Codex session does not have a goal.');
            const updated = CodexGoalResponseSchema.parse(
              await transport.request('thread/goal/set', {
                threadId: nativeSessionId,
                status: argument === 'pause' ? 'paused' : 'active'
              })
            );
            respond('goal', '/goal', goalDetail(updated.goal));
            return;
          }
          const objective = argument.startsWith('edit ') ? argument.slice(5).trim() : argument;
          if (objective === '') throw new Error('A Codex goal objective is required.');
          const updated = CodexGoalResponseSchema.parse(
            await transport.request('thread/goal/set', {
              threadId: nativeSessionId,
              objective: bounded(objective, 4_000).trim()
            })
          );
          respond('goal', '/goal', goalDetail(updated.goal));
          return;
        }
        if (action.commandId === 'memories') {
          if (argument !== 'enabled' && argument !== 'disabled') {
            throw new Error('Choose whether Codex memories are enabled or disabled.');
          }
          await transport.request('thread/memoryMode/set', {
            threadId: nativeSessionId,
            mode: argument
          });
          respond('memories', '/memories', argument);
          return;
        }
        if (action.commandId === 'skills') {
          const detail = commandDiscovery.skills.length === 0
            ? null
            : commandDiscovery.skills.map((skill) => (
              `${skill.name} — ${skill.description}`
            )).join('\n');
          respond('skills', '/skills', detail);
          return;
        }
        if (action.commandId === 'skill') {
          const match = /^(\S+)(?:\s+([\s\S]*))?$/.exec(argument);
          const skill = match === null
            ? undefined
            : commandDiscovery.skills.find(({ name }) => name === match[1]);
          if (skill === undefined) throw new Error('The requested Codex skill is not available.');
          const task = match?.[2]?.trim() ?? '';
          await startTurn([
            { type: 'skill', name: skill.name, path: skill.path },
            ...(task === '' ? [] : [{ type: 'text', text: task, text_elements: [] }])
          ], task === '' ? `$${skill.name}` : `$${skill.name} ${task}`);
          return;
        }
        if (action.commandId === 'mcp') {
          const response = CodexMcpStatusListSchema.parse(
            await transport.request('mcpServerStatus/list', {
              limit: 100,
              detail: 'toolsAndAuthOnly',
              threadId: nativeSessionId
            })
          );
          const detail = response.data.length === 0
            ? null
            : response.data.map((server) => (
              `${server.name} — ${server.runtimeStatus ?? 'unavailable'} · ${server.authStatus}`
            )).join('\n');
          respond('mcp', '/mcp', detail);
          return;
        }
        if (action.commandId === 'apps') {
          const response = CodexAppsSchema.parse(await transport.request('app/list', {
            limit: 256,
            threadId: nativeSessionId,
            forceRefetch: false
          }));
          const detail = response.data.length === 0 ? null : response.data.map((app) => (
            `${app.name} — ${app.isEnabled && app.isAccessible ? 'enabled' : 'unavailable'}`
          )).join('\n');
          respond('apps', '/apps', detail);
          return;
        }
        if (action.commandId === 'plugins') {
          const response = CodexPluginsSchema.parse(await transport.request('plugin/list', {
            cwds: [context.launch.workingDirectory],
            forceRefetch: false
          }));
          const plugins = response.marketplaces.flatMap(({ plugins }) => plugins);
          const detail = plugins.length === 0 ? null : plugins.map((plugin) => {
            const state = plugin.installed
              ? plugin.enabled ? 'enabled' : 'disabled'
              : plugin.availability === 'AVAILABLE' ? 'available' : 'unavailable';
            const version = plugin.localVersion ?? plugin.version;
            return `${plugin.name}${version ? ` ${version}` : ''} — ${state}`;
          }).join('\n');
          respond('plugins', '/plugins', detail);
          return;
        }
        if (action.commandId === 'hooks') {
          const response = CodexHooksSchema.parse(await transport.request('hooks/list', {
            cwds: [context.launch.workingDirectory]
          }));
          const hooks = response.data.flatMap(({ hooks }) => hooks);
          const detail = hooks.length === 0 ? null : hooks.map((hook) => (
            `${hook.key} — ${hook.eventName} · ${hook.enabled ? 'enabled' : 'disabled'} · ${hook.trustStatus}`
          )).join('\n');
          respond('hooks', '/hooks', detail);
          return;
        }
        if (action.commandId === 'ps' || action.commandId === 'stop') {
          const response = CodexBackgroundTerminalsSchema.parse(
            await transport.request('thread/backgroundTerminals/list', {
              threadId: nativeSessionId,
              limit: 256
            })
          );
          if (action.commandId === 'stop') {
            await Promise.all(response.data.map(({ processId }) => transport!.request(
              'thread/backgroundTerminals/terminate',
              { threadId: nativeSessionId, processId }
            )));
            await transport.request('thread/backgroundTerminals/clean', {
              threadId: nativeSessionId
            });
            respond('stop', '/stop', response.data.length === 0
              ? null
              : `Stopped ${response.data.length.toLocaleString('en-US')} background terminal(s).`);
            return;
          }
          const detail = response.data.length === 0 ? null : response.data.map((process) => {
            const metrics = [
              process.osPid === null || process.osPid === undefined ? null : `PID ${process.osPid}`,
              process.cpuPercent === null || process.cpuPercent === undefined
                ? null : `${process.cpuPercent}% CPU`,
              process.rssKb === null || process.rssKb === undefined
                ? null : `${Math.round(process.rssKb / 1024)} MB`
            ].filter((value): value is string => value !== null).join(' · ');
            return `${process.command}${metrics === '' ? '' : ` — ${metrics}`}\n${process.cwd}`;
          }).join('\n\n');
          respond('ps', '/ps', detail);
          return;
        }
        if (action.commandId === 'status') {
          let rateLimitDetail: string | null = null;
          try {
            const rateLimits = CodexRateLimitsSchema.parse(
              await transport.request('account/rateLimits/read', undefined)
            ).rateLimits;
            const windows = [rateLimits.primary, rateLimits.secondary].filter(
              (window): window is NonNullable<typeof window> => window !== null && window !== undefined
            );
            if (windows.length > 0) {
              rateLimitDetail = windows.map((window, index) => (
                `${index === 0 ? 'Primary' : 'Secondary'} limit: ${window.usedPercent}% used`
              )).join('\n');
            }
          } catch {
            rateLimitDetail = null;
          }
          const model = commandDiscovery.models.find(({ model }) => model === selectedModel);
          const detail = [
            `Session: ${nativeSessionId}`,
            `Model: ${model?.displayName ?? selectedModel ?? 'unavailable'}`,
            `Reasoning: ${selectedEffort ?? 'default'}`,
            `Service tier: ${selectedServiceTier ?? 'default'}`,
            `Personality: ${selectedPersonality ?? 'default'}`,
            `Mode: ${selectedCollaborationMode}`,
            `Permissions: ${selectedPermissionProfile ?? 'default'}`,
            ...(rateLimitDetail === null ? [] : [rateLimitDetail])
          ].join('\n');
          respond('status', '/status', detail);
          return;
        }
        if (action.commandId === 'usage') {
          const response = CodexAccountUsageSchema.parse(
            await transport.request('account/usage/read', { threadId: nativeSessionId })
          );
          const detail = [
            `Lifetime tokens: ${numberLabel(response.summary.lifetimeTokens)}`,
            `Peak daily tokens: ${numberLabel(response.summary.peakDailyTokens)}`,
            `Current streak: ${numberLabel(response.summary.currentStreakDays)} days`,
            `Longest streak: ${numberLabel(response.summary.longestStreakDays)} days`,
            `Longest turn: ${numberLabel(response.summary.longestRunningTurnSec)} seconds`
          ].join('\n');
          respond('usage', '/usage', detail);
          return;
        }
        if (action.commandId === 'rename') {
          if (argument === '') throw new Error('A Codex session name is required.');
          await transport.request('thread/name/set', {
            threadId: nativeSessionId,
            name: bounded(argument, 512).trim()
          });
          respond('rename', '/rename', argument);
          return;
        }
        throw new Error('The Codex command is not available.');
      }
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
