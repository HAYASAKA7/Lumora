import { describe, expect, it, vi } from 'vitest';

import type { StructuredAgentAdapterContext } from './structured-agent-adapter';
import type { StructuredAgentCommand } from '../../../shared/agent/contracts';
import {
  createCodexStructuredAdapter,
  type CodexStructuredTransportFactory
} from './codex-structured-adapter';
import type {
  JsonRpcNotification,
  JsonRpcProviderRequest,
  LineJsonRpcError,
  LineJsonRpcTransport
} from '../transport/line-json-rpc';

class FakeTransport implements LineJsonRpcTransport {
  constructor(private readonly options: {
    resumeModel?: string;
    includeLuna?: boolean;
    commandDiscoveryGate?: Promise<void>;
  } = {}) {}

  readonly request = vi.fn(async (method: string, params?: unknown) => {
    if (method === 'initialize') return { userAgent: 'codex-cli/0.149.1' };
    if (method === 'thread/start') {
      return { thread: { id: '019c-native-thread', turns: [] } };
    }
    if (method === 'thread/resume') {
      return {
        model: this.options.resumeModel ?? 'gpt-5.6-sol',
        reasoningEffort: this.options.resumeModel === 'gpt-5.6-luna' ? 'high' : 'medium',
        serviceTier: null,
        thread: {
          id: '019c-native-thread',
          turns: []
        },
        initialTurnsPage: {
          data: [{
            id: 'turn-newer',
            status: 'completed',
            items: [
              {
                type: 'userMessage',
                id: 'item-user-newer',
                content: [{ type: 'text', text: 'Newer question' }]
              },
              { type: 'agentMessage', id: 'item-agent-newer', text: 'Newer answer' }
            ]
          }, {
            id: 'turn-history',
            status: 'completed',
            items: [
              {
                type: 'userMessage',
                id: 'item-user-history',
                content: [{ type: 'text', text: 'Earlier question' }]
              },
              { type: 'agentMessage', id: 'item-agent-history', text: 'Earlier answer' }
            ]
          }],
          nextCursor: 'older-turns'
        }
      };
    }
    if (method === 'turn/start') {
      return { turn: { id: 'turn-live', status: 'inProgress', items: [] } };
    }
    if (method === 'model/list') {
      await this.options.commandDiscoveryGate;
      return {
        data: [{
          id: 'gpt-5.6-sol',
          model: 'gpt-5.6-sol',
          displayName: 'GPT-5.6 Sol',
          description: 'Frontier coding model',
          hidden: false,
          supportedReasoningEfforts: [
            { reasoningEffort: 'medium', description: 'Balanced' },
            { reasoningEffort: 'high', description: 'Deeper reasoning' }
          ],
          defaultReasoningEffort: 'medium',
          supportsPersonality: true,
          serviceTiers: [{
            id: 'fast',
            name: 'Fast',
            description: 'Lower latency for supported models.'
          }],
          defaultServiceTier: null,
          isDefault: true
        }, ...(this.options.includeLuna ? [{
          id: 'gpt-5.6-luna',
          model: 'gpt-5.6-luna',
          displayName: 'GPT-5.6 Luna',
          description: 'Fast coding model',
          hidden: false,
          supportedReasoningEfforts: [
            { reasoningEffort: 'medium', description: 'Balanced' },
            { reasoningEffort: 'high', description: 'Deeper reasoning' }
          ],
          defaultReasoningEffort: 'medium',
          supportsPersonality: true,
          serviceTiers: [],
          defaultServiceTier: null,
          isDefault: false
        }] : [])],
        nextCursor: null
      };
    }
    if (method === 'permissionProfile/list') {
      return {
        data: [
          { id: 'workspace-write', description: 'Workspace access', allowed: true },
          { id: 'blocked-profile', description: 'Unavailable', allowed: false }
        ],
        nextCursor: null
      };
    }
    if (method === 'skills/list') {
      return {
        data: [{
          cwd: 'C:\\workspace',
          skills: [{
            name: 'test-driven-development',
            description: 'Develop with a red-green-refactor loop.',
            path: 'C:\\skills\\test-driven-development\\SKILL.md',
            enabled: true,
            scope: 'user',
            pluginId: null
          }],
          errors: []
        }]
      };
    }
    if (method === 'mcpServerStatus/list') {
      return {
        data: [{
          name: 'browser',
          runtimeStatus: 'connected',
          pluginId: null,
          serverInfo: null,
          tools: {},
          resources: [],
          resourceTemplates: [],
          authStatus: 'unsupported'
        }],
        nextCursor: null
      };
    }
    if (method === 'thread/goal/get') {
      return {
        goal: {
          threadId: '019c-native-thread',
          objective: 'Finish the command surface',
          status: 'active',
          tokenBudget: null,
          tokensUsed: 120,
          timeUsedSeconds: 45,
          createdAt: 1,
          updatedAt: 2
        }
      };
    }
    if (method === 'thread/goal/set') {
      return {
        goal: {
          threadId: '019c-native-thread',
          objective: typeof params === 'object' && params !== null && 'objective' in params
            ? String(params.objective)
            : 'Finish the command surface',
          status: typeof params === 'object' && params !== null && 'status' in params
            ? String(params.status)
            : 'active',
          tokenBudget: null,
          tokensUsed: 120,
          timeUsedSeconds: 45,
          createdAt: 1,
          updatedAt: 2
        }
      };
    }
    if (method === 'thread/backgroundTerminals/list') {
      return {
        data: [{
          itemId: 'item-bg',
          processId: 'process-bg',
          command: 'npm run verify',
          cwd: 'C:\\workspace',
          osPid: 4242,
          cpuPercent: 3.5,
          rssKb: 2048
        }],
        nextCursor: null
      };
    }
    if (method === 'account/rateLimits/read') {
      return {
        rateLimits: {
          limitId: 'codex',
          limitName: 'Codex',
          primary: { usedPercent: 25, windowDurationMins: 300, resetsAt: 99 },
          secondary: null,
          credits: null,
          individualLimit: null,
          spendControlReached: false,
          planType: 'pro',
          rateLimitReachedType: null
        },
        rateLimitsByLimitId: null,
        rateLimitResetCredits: null
      };
    }
    if (method === 'account/usage/read') {
      return {
        summary: {
          lifetimeTokens: 123456,
          peakDailyTokens: 4000,
          longestRunningTurnSec: 90,
          currentStreakDays: 3,
          longestStreakDays: 7
        },
        dailyUsageBuckets: null,
        threadUsage: null
      };
    }
    if (method === 'app/list') {
      return {
        data: [{
          id: 'github', name: 'GitHub', description: 'GitHub connector',
          isAccessible: true, isEnabled: true, pluginDisplayNames: []
        }],
        nextCursor: null
      };
    }
    if (method === 'plugin/list') {
      return {
        marketplaces: [{
          name: 'personal',
          path: null,
          interface: null,
          plugins: [{
            id: 'browser-plugin', name: 'Browser', installed: true, enabled: true,
            version: '1.0.0', localVersion: '1.0.0', availability: 'AVAILABLE'
          }]
        }],
        marketplaceLoadErrors: [],
        featuredPluginIds: []
      };
    }
    if (method === 'hooks/list') {
      return {
        data: [{
          cwd: 'C:\\workspace',
          hooks: [{
            key: 'after-test', eventName: 'afterToolUse', enabled: true,
            trustStatus: 'trusted', handlerType: 'command'
          }],
          warnings: [], errors: []
        }]
      };
    }
    if (method === 'gitDiffToRemote') {
      return {
        sha: '0123456789abcdef',
        diff: 'diff --git a/src/app.ts b/src/app.ts\n+export const ready = true;'
      };
    }
    return {};
  });
  readonly notify = vi.fn(async () => undefined);
  readonly close = vi.fn(async () => undefined);
  private readonly notifications = new Set<(value: JsonRpcNotification) => void>();
  private readonly exits = new Set<(error: LineJsonRpcError) => void>();

  onNotification(listener: (value: JsonRpcNotification) => void): () => void {
    this.notifications.add(listener);
    return () => this.notifications.delete(listener);
  }

  onExit(listener: (error: LineJsonRpcError) => void): () => void {
    this.exits.add(listener);
    return () => this.exits.delete(listener);
  }

  emit(method: string, params: unknown): void {
    for (const listener of this.notifications) listener({ method, params });
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function context(strategy: 'new' | 'resume' = 'new') {
  const events: unknown[] = [];
  const commandLists: (readonly StructuredAgentCommand[])[] = [];
  const exited = vi.fn();
  const value: StructuredAgentAdapterContext = {
    connectionId: 'connection-1',
    providerId: 'codex',
    generation: 1,
    launch: {
      request: strategy === 'new'
        ? {
          strategy: 'new', providerId: 'codex', workspaceId: 'workspace-1', startPrompt: ''
        }
        : {
          strategy: 'resume', providerId: 'codex', sessionId: 'catalog-1', startPrompt: ''
        },
      workspaceId: 'workspace-1',
      catalogSessionId: strategy === 'resume' ? 'catalog-1' : null,
      nativeSessionId: strategy === 'resume' ? '019c-native-thread' : null,
      title: 'Codex session',
      workingDirectory: 'C:\\workspace',
      executablePath: 'C:\\tools\\codex.exe'
    },
    callbacks: {
      emit: (event) => events.push(event),
      commandsChanged: (commands) => commandLists.push(commands),
      exited
    }
  };
  return { value, events, commandLists, exited };
}

describe('Codex structured adapter', () => {
  it('starts and resumes exact native threads without sending an empty prompt', async () => {
    const transport = new FakeTransport();
    const createTransport: CodexStructuredTransportFactory = vi.fn(async () => transport);
    const fresh = context('new');
    const adapter = createCodexStructuredAdapter(fresh.value, { createTransport });

    await expect(adapter.open()).resolves.toMatchObject({
      nativeSessionId: '019c-native-thread',
      initialEvents: []
    });
    await adapter.activate?.();

    expect(transport.request).toHaveBeenCalledWith('thread/start', {
      cwd: 'C:\\workspace',
      ephemeral: false
    });
    expect(transport.request).toHaveBeenCalledWith('initialize', {
      clientInfo: {
        name: 'lumora',
        title: 'Lumora',
        version: 'unknown'
      },
      capabilities: { experimentalApi: true }
    });
    expect(transport.request).not.toHaveBeenCalledWith('turn/start', expect.anything());

    const resumed = context('resume');
    const resumeTransport = new FakeTransport();
    const resumeAdapter = createCodexStructuredAdapter(resumed.value, {
      createTransport: async () => resumeTransport
    });
    const opened = await resumeAdapter.open();
    expect(opened.nativeSessionId).toBe('019c-native-thread');
    expect(resumeTransport.request).toHaveBeenCalledWith('thread/resume', {
      threadId: '019c-native-thread',
      cwd: 'C:\\workspace',
      excludeTurns: true,
      initialTurnsPage: {
        limit: 24,
        sortDirection: 'desc',
        itemsView: 'summary'
      }
    });
    expect(opened.initialEvents?.filter(({ kind }) => kind === 'turn.started').map(
      ({ turnId }) => turnId
    )).toEqual(['turn-history', 'turn-newer']);
    expect(opened.initialEvents).toContainEqual(expect.objectContaining({
      kind: 'user.message',
      turnId: 'turn-history',
      payload: { text: 'Earlier question' }
    }));
    expect(opened.initialEvents).toContainEqual(expect.objectContaining({
      kind: 'assistant.message',
      turnId: 'turn-history',
      payload: { text: 'Earlier answer' }
    }));
  });

  it('opens a usable session before optional command discovery settles', async () => {
    const gate = deferred<void>();
    const transport = new FakeTransport({ commandDiscoveryGate: gate.promise });
    const current = context('resume');
    const adapter = createCodexStructuredAdapter(current.value, {
      createTransport: async () => transport
    });

    const openPromise = adapter.open();

    await vi.waitFor(() => {
      expect(transport.request).toHaveBeenCalledWith(
        'model/list',
        expect.anything()
      );
    });
    const opened = await openPromise;
    expect(opened?.commands?.some(({ id }) => id === 'model')).toBe(false);
    expect(opened?.commands?.some(({ id }) => id === 'compact')).toBe(true);

    gate.resolve();
    await vi.waitFor(() => {
      expect(current.commandLists).toHaveLength(1);
      expect(current.commandLists[0]).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: 'model' }),
        expect.objectContaining({ id: 'compact' })
      ]));
    });
  });

  it('uses the provider-owned model restored by Codex when resuming a thread', async () => {
    const transport = new FakeTransport({
      resumeModel: 'gpt-5.6-luna',
      includeLuna: true
    });
    const current = context('resume');
    const adapter = createCodexStructuredAdapter(current.value, {
      createTransport: async () => transport
    });

    await adapter.open();

    await vi.waitFor(() => {
      expect(current.commandLists.at(-1)?.find(({ id }) => id === 'model')).toMatchObject({
        selectedValue: 'gpt-5.6-luna'
      });
    });
    await adapter.dispatch({
      kind: 'command.execute', connectionId: 'connection-1',
      commandId: 'status', argument: ''
    });
    expect(current.events).toContainEqual(expect.objectContaining({
      kind: 'command.updated',
      payload: expect.objectContaining({
        detail: expect.stringMatching(/GPT-5\.6 Luna[\s\S]*Reasoning: high/)
      })
    }));
  });

  it('maps live events, prompt submission, cancellation, usage, and approvals', async () => {
    const transport = new FakeTransport();
    let handleRequest: ((request: JsonRpcProviderRequest) => Promise<unknown>) | undefined;
    const current = context();
    const adapter = createCodexStructuredAdapter(current.value, {
      createTransport: async (options) => {
        handleRequest = options.handleRequest;
        return transport;
      }
    });
    await adapter.open();
    await adapter.activate?.();

    await adapter.dispatch({
      kind: 'prompt.submit',
      connectionId: 'connection-1',
      text: 'Inspect this',
      attachmentTokens: []
    });
    transport.emit('item/agentMessage/delta', {
      threadId: '019c-native-thread', turnId: 'turn-live', itemId: 'item-2', delta: 'Working'
    });
    transport.emit('thread/tokenUsage/updated', {
      threadId: '019c-native-thread',
      turnId: 'turn-live',
      tokenUsage: { total: {
        inputTokens: 10,
        cachedInputTokens: 2,
        outputTokens: 4,
        totalTokens: 14,
        reasoningOutputTokens: 3
      } }
    });
    transport.emit('turn/completed', {
      threadId: '019c-native-thread',
      turn: { id: 'turn-live', status: 'completed', items: [] }
    });
    await adapter.dispatch({
      kind: 'prompt.submit',
      connectionId: 'connection-1',
      text: 'Continue',
      attachmentTokens: []
    });
    await adapter.dispatch({
      kind: 'turn.cancel', connectionId: 'connection-1'
    });

    expect(transport.request).toHaveBeenCalledWith('turn/start', {
      threadId: '019c-native-thread',
      input: [{ type: 'text', text: 'Inspect this', text_elements: [] }]
    });
    expect(transport.request).toHaveBeenCalledWith('turn/interrupt', {
      threadId: '019c-native-thread', turnId: 'turn-live'
    });
    expect(current.events).toContainEqual(expect.objectContaining({
      kind: 'assistant.delta', payload: { text: 'Working' }
    }));
    expect(current.events).toContainEqual(expect.objectContaining({
      kind: 'turn.completed',
      payload: { state: 'completed', message: null }
    }));
    expect(transport.request).toHaveBeenCalledWith('turn/start', {
      threadId: '019c-native-thread',
      input: [{ type: 'text', text: 'Continue', text_elements: [] }]
    });
    const usage = current.events.find((event) => (
      typeof event === 'object' &&
      event !== null &&
      'kind' in event &&
      event.kind === 'usage.updated'
    ));
    expect(usage).toEqual(expect.objectContaining({
      kind: 'usage.updated',
      payload: { inputTokens: 10, cachedInputTokens: 2, outputTokens: 4, totalTokens: 14 }
    }));

    const approval = handleRequest?.({
      id: 42,
      method: 'item/commandExecution/requestApproval',
      params: {
        threadId: '019c-native-thread',
        turnId: 'turn-live',
        itemId: 'item-command',
        command: 'npm test',
        reason: 'Run tests'
      }
    });
    await vi.waitFor(() => expect(current.events).toContainEqual(expect.objectContaining({
      kind: 'approval.requested',
      payload: expect.objectContaining({ approvalId: 'codex-approval-42' })
    })));
    await adapter.dispatch({
      kind: 'approval.respond',
      connectionId: 'connection-1',
      approvalId: 'codex-approval-42',
      decision: 'allow_once'
    });
    await expect(approval).resolves.toEqual({ decision: 'accept' });
  });

  it('refreshes structured subscription usage for the session details view', async () => {
    const transport = new FakeTransport();
    const current = context();
    const adapter = createCodexStructuredAdapter(current.value, {
      createTransport: async () => transport
    });
    await adapter.open();

    await adapter.dispatch({
      kind: 'session.details.refresh',
      connectionId: 'connection-1'
    });

    expect(transport.request).toHaveBeenCalledWith('account/rateLimits/read', undefined);
    expect(current.events).toContainEqual(expect.objectContaining({
      kind: 'account.usage.updated',
      payload: {
        plan: 'pro',
        windows: [{
          kind: 'primary',
          usedPercent: 25,
          windowDurationMinutes: 300,
          resetsAt: 99
        }]
      }
    }));
  });

  it('maps every live Codex operation lifecycle into visible process activities', async () => {
    const transport = new FakeTransport();
    const current = context();
    const adapter = createCodexStructuredAdapter(current.value, {
      createTransport: async () => transport
    });
    await adapter.open();

    const envelope = {
      threadId: '019c-native-thread',
      turnId: 'turn-live'
    };
    transport.emit('item/started', {
      ...envelope,
      item: {
        type: 'commandExecution', id: 'command-1', command: 'npm run verify',
        cwd: 'C:\\workspace', status: 'inProgress'
      }
    });
    transport.emit('item/completed', {
      ...envelope,
      item: {
        type: 'fileChange', id: 'file-change-1', status: 'completed',
        changes: [{ path: 'src/app.ts', kind: 'update' }]
      }
    });

    await vi.waitFor(() => expect(current.events).toContainEqual(expect.objectContaining({
      kind: 'diff.updated',
      payload: expect.objectContaining({
        diffId: 'turn-live:workspace',
        files: [expect.objectContaining({
          pathLabel: 'src/app.ts', additions: 1, deletions: 0
        })]
      })
    })));
    transport.emit('item/completed', {
      ...envelope,
      item: {
        type: 'commandExecution', id: 'command-1', command: 'npm run verify',
        cwd: 'C:\\workspace', status: 'completed', aggregatedOutput: 'All checks passed'
      }
    });
    transport.emit('item/completed', {
      ...envelope,
      item: {
        type: 'mcpToolCall', id: 'tool-1', server: 'browser', tool: 'open',
        status: 'completed'
      }
    });
    transport.emit('item/started', {
      ...envelope,
      item: {
        type: 'webSearch', id: 'search-1', query: 'Lumora process rendering'
      }
    });

    expect(current.events).toContainEqual(expect.objectContaining({
      kind: 'command.started',
      payload: expect.objectContaining({
        activityId: 'command-1', title: 'npm run verify'
      })
    }));
    expect(current.events).toContainEqual(expect.objectContaining({
      kind: 'command.updated',
      payload: expect.objectContaining({
        activityId: 'command-1', title: 'npm run verify', status: 'completed'
      })
    }));
    expect(current.events).toContainEqual(expect.objectContaining({
      kind: 'tool.updated',
      payload: expect.objectContaining({
        activityId: 'tool-1', title: 'browser · open', status: 'completed'
      })
    }));
    expect(current.events).toContainEqual(expect.objectContaining({
      kind: 'tool.started',
      payload: expect.objectContaining({
        activityId: 'search-1', title: 'Search web'
      })
    }));
  });

  it('accepts official nullable operation fields and completes turns containing tool results', async () => {
    const transport = new FakeTransport();
    const current = context();
    const adapter = createCodexStructuredAdapter(current.value, {
      createTransport: async () => transport
    });
    await adapter.open();

    const envelope = {
      threadId: '019c-native-thread',
      turnId: 'turn-live'
    };
    transport.emit('item/started', {
      ...envelope,
      item: {
        type: 'commandExecution',
        id: 'command-null-duration',
        command: 'npm run verify',
        commandActions: [],
        cwd: 'C:\\workspace',
        durationMs: null,
        status: 'inProgress'
      }
    });
    const completedTool = {
      type: 'mcpToolCall',
      id: 'tool-object-result',
      arguments: { path: 'README.md' },
      server: 'filesystem',
      tool: 'read_file',
      durationMs: null,
      error: null,
      result: { content: [{ type: 'text', text: 'Lumora' }] },
      status: 'completed'
    };
    transport.emit('item/completed', {
      ...envelope,
      item: completedTool
    });
    transport.emit('turn/completed', {
      threadId: '019c-native-thread',
      turn: {
        id: 'turn-live',
        status: 'completed',
        items: [completedTool]
      }
    });

    expect(current.events).toContainEqual(expect.objectContaining({
      kind: 'command.started',
      payload: expect.objectContaining({ activityId: 'command-null-duration' })
    }));
    expect(current.events).toContainEqual(expect.objectContaining({
      kind: 'tool.updated',
      payload: expect.objectContaining({
        activityId: 'tool-object-result',
        status: 'completed'
      })
    }));
    expect(current.events).toContainEqual(expect.objectContaining({
      kind: 'turn.completed',
      turnId: 'turn-live',
      payload: { state: 'completed', message: null }
    }));
  });

  it('does not let future turn-item fields block turn completion', async () => {
    const transport = new FakeTransport();
    const current = context();
    const adapter = createCodexStructuredAdapter(current.value, {
      createTransport: async () => transport
    });
    await adapter.open();

    transport.emit('turn/completed', {
      threadId: '019c-native-thread',
      turn: {
        id: 'turn-live',
        status: 'completed',
        items: [{
          type: 'futureOperation',
          id: 'future-item',
          durationMs: 'provider-defined'
        }]
      }
    });

    expect(current.events).toContainEqual(expect.objectContaining({
      kind: 'turn.completed',
      turnId: 'turn-live',
      payload: { state: 'completed', message: null }
    }));
  });

  it('ignores unknown notifications and rejects unsupported attachments safely', async () => {
    const transport = new FakeTransport();
    const current = context();
    const adapter = createCodexStructuredAdapter(current.value, {
      createTransport: async () => transport
    });
    await adapter.open();
    await adapter.activate?.();
    transport.emit('future/event', { secret: 'ignored' });
    expect(current.events).toEqual([]);

    await expect(adapter.dispatch({
      kind: 'prompt.submit',
      connectionId: 'connection-1',
      text: 'With attachment',
      attachmentTokens: ['attachment-1']
    })).rejects.toThrow('attachments');
  });

  it('executes native Codex commands without submitting fake prompt text', async () => {
    const transport = new FakeTransport();
    const current = context();
    const adapter = createCodexStructuredAdapter(current.value, {
      createTransport: async () => transport
    });
    await adapter.open();

    await adapter.dispatch({
      kind: 'command.execute',
      connectionId: 'connection-1',
      commandId: 'compact',
      argument: ''
    });

    expect(transport.request).toHaveBeenCalledWith('thread/compact/start', {
      threadId: '019c-native-thread'
    });
    expect(transport.request).not.toHaveBeenCalledWith('turn/start', expect.anything());
  });

  it('discovers and executes the complete meaningful Codex command registry', async () => {
    const transport = new FakeTransport();
    const current = context();
    const adapter = createCodexStructuredAdapter(current.value, {
      createTransport: async () => transport
    });

    await adapter.open();
    await vi.waitFor(() => expect(current.commandLists).not.toHaveLength(0));
    const commands = current.commandLists.at(-1) ?? [];
    expect(commands.map(({ name }) => name)).toEqual([
      '/model',
      '/reasoning',
      '/fast',
      '/personality',
      '/plan',
      '/review',
      '/compact',
      '/diff',
      '/copy',
      '/permissions',
      '/goal',
      '/memories',
      '/skills',
      '/skill',
      '/mcp',
      '/apps',
      '/plugins',
      '/hooks',
      '/ps',
      '/stop',
      '/status',
      '/usage',
      '/rename'
    ]);
    expect(commands.find(({ id }) => id === 'model')).toMatchObject({
      selectedValue: 'gpt-5.6-sol',
      choices: [{ value: 'gpt-5.6-sol', label: 'GPT-5.6 Sol' }]
    });
    expect(commands.find(({ id }) => id === 'permissions')).toMatchObject({
      choices: [{ value: 'workspace-write', label: 'workspace-write' }]
    });
    expect(commands.find(({ id }) => id === 'skill')).toMatchObject({
      selectionBehavior: 'continue',
      choices: [{
        value: 'test-driven-development',
        label: 'test-driven-development'
      }]
    });

    await adapter.dispatch({
      kind: 'command.execute', connectionId: 'connection-1',
      commandId: 'model', argument: 'gpt-5.6-sol'
    });
    await adapter.dispatch({
      kind: 'command.execute', connectionId: 'connection-1',
      commandId: 'effort', argument: 'high'
    });
    await adapter.dispatch({
      kind: 'command.execute', connectionId: 'connection-1',
      commandId: 'fast', argument: ''
    });
    await adapter.dispatch({
      kind: 'command.execute', connectionId: 'connection-1',
      commandId: 'personality', argument: 'pragmatic'
    });
    await adapter.dispatch({
      kind: 'command.execute', connectionId: 'connection-1',
      commandId: 'permissions', argument: 'workspace-write'
    });
    await adapter.dispatch({
      kind: 'command.execute', connectionId: 'connection-1',
      commandId: 'mode', argument: ''
    });
    await adapter.dispatch({
      kind: 'command.execute', connectionId: 'connection-1',
      commandId: 'rename', argument: 'Command registry work'
    });
    await adapter.dispatch({
      kind: 'command.execute', connectionId: 'connection-1',
      commandId: 'skill', argument: 'test-driven-development Fix the regression'
    });
    await adapter.dispatch({
      kind: 'command.execute', connectionId: 'connection-1',
      commandId: 'skills', argument: ''
    });
    await adapter.dispatch({
      kind: 'command.execute', connectionId: 'connection-1',
      commandId: 'mcp', argument: ''
    });
    for (const [commandId, argument] of [
      ['goal', ''],
      ['goal', 'pause'],
      ['goal', 'Ship the complete command surface'],
      ['memories', 'enabled'],
      ['apps', ''],
      ['plugins', ''],
      ['hooks', ''],
      ['ps', ''],
      ['stop', ''],
      ['status', ''],
      ['usage', ''],
      ['diff', '']
    ] as const) {
      await adapter.dispatch({
        kind: 'command.execute', connectionId: 'connection-1', commandId, argument
      });
    }

    expect(transport.request).toHaveBeenCalledWith('thread/settings/update', {
      threadId: '019c-native-thread', model: 'gpt-5.6-sol'
    });
    expect(transport.request).toHaveBeenCalledWith('thread/settings/update', {
      threadId: '019c-native-thread', effort: 'high'
    });
    expect(transport.request).toHaveBeenCalledWith('thread/settings/update', {
      threadId: '019c-native-thread', serviceTier: 'fast'
    });
    expect(transport.request).toHaveBeenCalledWith('thread/settings/update', {
      threadId: '019c-native-thread', personality: 'pragmatic'
    });
    expect(transport.request).toHaveBeenCalledWith('thread/settings/update', {
      threadId: '019c-native-thread', permissions: 'workspace-write'
    });
    expect(transport.request).toHaveBeenCalledWith('thread/settings/update', {
      threadId: '019c-native-thread',
      collaborationMode: {
        mode: 'plan',
        settings: {
          model: 'gpt-5.6-sol',
          reasoning_effort: 'high',
          developer_instructions: null
        }
      }
    });
    expect(transport.request).toHaveBeenCalledWith('thread/name/set', {
      threadId: '019c-native-thread', name: 'Command registry work'
    });
    expect(transport.request).toHaveBeenCalledWith('turn/start', {
      threadId: '019c-native-thread',
      input: [
        {
          type: 'skill',
          name: 'test-driven-development',
          path: 'C:\\skills\\test-driven-development\\SKILL.md'
        },
        { type: 'text', text: 'Fix the regression', text_elements: [] }
      ]
    });
    expect(current.events).toContainEqual(expect.objectContaining({
      kind: 'command.updated',
      payload: expect.objectContaining({ detail: expect.stringContaining('test-driven-development') })
    }));
    expect(current.events).toContainEqual(expect.objectContaining({
      kind: 'command.updated',
      payload: expect.objectContaining({ detail: expect.stringContaining('browser') })
    }));
    expect(transport.request).toHaveBeenCalledWith('thread/memoryMode/set', {
      threadId: '019c-native-thread', mode: 'enabled'
    });
    expect(transport.request).toHaveBeenCalledWith('thread/backgroundTerminals/terminate', {
      threadId: '019c-native-thread', processId: 'process-bg'
    });
    for (const expected of [
      'Finish the command surface', 'GitHub', 'Browser', 'after-test',
      'npm run verify', 'GPT-5.6 Sol', '123,456',
      'export const ready = true'
    ]) {
      expect(current.events).toContainEqual(expect.objectContaining({
        kind: 'command.updated',
        payload: expect.objectContaining({ detail: expect.stringContaining(expected) })
      }));
    }
    expect(current.events).toContainEqual(expect.objectContaining({
      kind: 'user.message',
      payload: { text: '/status' }
    }));
    expect(current.events).toContainEqual(expect.objectContaining({
      kind: 'command.updated',
      payload: expect.objectContaining({ detail: expect.stringContaining('GPT-5.6 Sol') })
    }));
    expect(current.events).toContainEqual(expect.objectContaining({
      kind: 'turn.completed',
      payload: { state: 'completed', message: null }
    }));
    expect(current.events).toContainEqual(expect.objectContaining({
      kind: 'command.started',
      payload: expect.objectContaining({ title: '/status' })
    }));
  });

  it('rejects stale or invented dynamic Codex command values', async () => {
    const transport = new FakeTransport();
    const adapter = createCodexStructuredAdapter(context().value, {
      createTransport: async () => transport
    });
    await adapter.open();

    await expect(adapter.dispatch({
      kind: 'command.execute', connectionId: 'connection-1',
      commandId: 'permissions', argument: 'blocked-profile'
    })).rejects.toThrow('not available');
    expect(transport.request).not.toHaveBeenCalledWith(
      'thread/settings/update',
      expect.objectContaining({ permissions: 'blocked-profile' })
    );
  });
});
