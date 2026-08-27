import { describe, expect, it, vi } from 'vitest';

import type { StructuredAgentAdapterContext } from './structured-agent-adapter';
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
  readonly request = vi.fn(async (method: string) => {
    if (method === 'initialize') return { userAgent: 'codex-cli/0.149.1' };
    if (method === 'thread/start') {
      return { thread: { id: '019c-native-thread', turns: [] } };
    }
    if (method === 'thread/resume') {
      return {
        thread: {
          id: '019c-native-thread',
          turns: [{
            id: 'turn-history',
            status: 'completed',
            items: [{ type: 'agentMessage', id: 'item-1', text: 'Earlier answer' }]
          }]
        }
      };
    }
    if (method === 'turn/start') {
      return { turn: { id: 'turn-live', status: 'inProgress', items: [] } };
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

function context(strategy: 'new' | 'resume' = 'new') {
  const events: unknown[] = [];
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
      exited
    }
  };
  return { value, events, exited };
}

describe('Codex structured adapter', () => {
  it('starts and resumes exact native threads without sending an empty prompt', async () => {
    const transport = new FakeTransport();
    const createTransport: CodexStructuredTransportFactory = vi.fn(async () => transport);
    const fresh = context('new');
    const adapter = createCodexStructuredAdapter(fresh.value, { createTransport });

    await expect(adapter.open()).resolves.toEqual({
      nativeSessionId: '019c-native-thread',
      initialEvents: []
    });
    await adapter.activate?.();

    expect(transport.request).toHaveBeenCalledWith('thread/start', {
      cwd: 'C:\\workspace',
      ephemeral: false
    });
    expect(transport.request).not.toHaveBeenCalledWith('turn/start', expect.anything());

    const resumed = context('resume');
    const resumeAdapter = createCodexStructuredAdapter(resumed.value, {
      createTransport: async () => new FakeTransport()
    });
    const opened = await resumeAdapter.open();
    expect(opened.nativeSessionId).toBe('019c-native-thread');
    expect(opened.initialEvents).toContainEqual(expect.objectContaining({
      kind: 'assistant.message',
      turnId: 'turn-history',
      payload: { text: 'Earlier answer' }
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
});
