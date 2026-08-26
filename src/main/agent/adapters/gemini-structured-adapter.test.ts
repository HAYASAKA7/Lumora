import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, onTestFinished, vi } from 'vitest';

import type {
  JsonRpcNotification,
  JsonRpcProviderRequest,
  LineJsonRpcError,
  LineJsonRpcTransport
} from '../transport/line-json-rpc';
import type { StructuredAgentAdapterContext } from './structured-agent-adapter';
import {
  createGeminiStructuredAdapter,
  type GeminiStructuredTransportFactory
} from './gemini-structured-adapter';

class FakeTransport implements LineJsonRpcTransport {
  private promptRelease: (() => void) | null = null;
  private promptGate: Promise<void> | null = null;
  readonly request = vi.fn(async (method: string) => {
    if (method === 'initialize') {
      return {
        protocolVersion: 1,
        agentCapabilities: { loadSession: true },
        authMethods: [{ id: 'oauth-personal', name: 'Log in with Google' }]
      };
    }
    if (method === 'session/new') return { sessionId: 'gemini-native-1' };
    if (method === 'session/load') return {};
    if (method === 'session/prompt') {
      await this.promptGate;
      return {
        stopReason: 'end_turn',
        usage: {
          inputTokens: 12,
          cachedReadTokens: 3,
          outputTokens: 5,
          totalTokens: 17
        }
      };
    }
    return {};
  });
  readonly notify = vi.fn(async () => undefined);
  readonly close = vi.fn(async () => undefined);
  private readonly notifications = new Set<(value: JsonRpcNotification) => void>();

  onNotification(listener: (value: JsonRpcNotification) => void): () => void {
    this.notifications.add(listener);
    return () => this.notifications.delete(listener);
  }

  onExit(_listener: (error: LineJsonRpcError) => void): () => void {
    return () => undefined;
  }

  emit(method: string, params: unknown): void {
    for (const listener of this.notifications) listener({ method, params });
  }

  holdPrompt(): void {
    this.promptGate = new Promise((resolve) => {
      this.promptRelease = resolve;
    });
  }

  releasePrompt(): void {
    this.promptRelease?.();
    this.promptRelease = null;
    this.promptGate = null;
  }
}

function context(workspace: string, strategy: 'new' | 'resume' = 'new') {
  const events: unknown[] = [];
  const value: StructuredAgentAdapterContext = {
    connectionId: 'connection-gemini',
    providerId: 'gemini',
    generation: 1,
    launch: {
      request: strategy === 'new'
        ? { strategy: 'new', providerId: 'gemini', workspaceId: 'workspace-1', startPrompt: '' }
        : { strategy: 'resume', providerId: 'gemini', sessionId: 'catalog-1', startPrompt: '' },
      workspaceId: 'workspace-1',
      catalogSessionId: strategy === 'resume' ? 'catalog-1' : null,
      nativeSessionId: strategy === 'resume' ? 'gemini-native-1' : null,
      title: 'Gemini session',
      workingDirectory: workspace,
      executablePath: 'C:\\tools\\gemini.cmd'
    },
    callbacks: {
      emit: (event) => events.push(event),
      exited: vi.fn()
    }
  };
  return { value, events };
}

describe('Gemini structured adapter', () => {
  it('creates and loads exact ACP sessions without mutating existing authentication', async () => {
    const transport = new FakeTransport();
    const createTransport: GeminiStructuredTransportFactory = vi.fn(async () => transport);
    const fresh = context('C:\\workspace');
    const adapter = createGeminiStructuredAdapter(fresh.value, { createTransport });

    await expect(adapter.open()).resolves.toEqual({
      nativeSessionId: 'gemini-native-1',
      initialEvents: []
    });
    expect(transport.request).toHaveBeenCalledWith('session/new', {
      cwd: 'C:\\workspace', mcpServers: []
    });
    expect(transport.request).not.toHaveBeenCalledWith('authenticate', expect.anything());

    const resumedTransport = new FakeTransport();
    const resumed = context('C:\\workspace', 'resume');
    const resumeAdapter = createGeminiStructuredAdapter(resumed.value, {
      createTransport: async () => resumedTransport
    });
    await expect(resumeAdapter.open()).resolves.toMatchObject({
      nativeSessionId: 'gemini-native-1'
    });
    expect(resumedTransport.request).toHaveBeenCalledWith('session/load', {
      sessionId: 'gemini-native-1', cwd: 'C:\\workspace', mcpServers: []
    });
  });

  it('streams ACP updates and completes prompt usage without blocking dispatch', async () => {
    const transport = new FakeTransport();
    transport.holdPrompt();
    const current = context('C:\\workspace');
    const adapter = createGeminiStructuredAdapter(current.value, {
      createTransport: async () => transport
    });
    await adapter.open();
    await adapter.activate?.();

    await adapter.dispatch({
      kind: 'prompt.submit',
      connectionId: 'connection-gemini',
      text: 'Inspect this',
      attachmentTokens: []
    });
    transport.emit('session/update', {
      sessionId: 'gemini-native-1',
      update: {
        sessionUpdate: 'agent_message_chunk',
        content: { type: 'text', text: 'Working' }
      }
    });
    await vi.waitFor(() => expect(current.events).toContainEqual(expect.objectContaining({
      kind: 'assistant.delta', payload: { text: 'Working' }
    })));
    await adapter.dispatch({ kind: 'turn.cancel', connectionId: 'connection-gemini' });
    expect(transport.notify).toHaveBeenCalledWith('session/cancel', {
      sessionId: 'gemini-native-1'
    });
    transport.releasePrompt();
    await vi.waitFor(() => expect(current.events).toContainEqual(expect.objectContaining({
      kind: 'usage.updated',
      payload: { inputTokens: 12, cachedInputTokens: 3, outputTokens: 5, totalTokens: 17 }
    })));
  });

  it('contains ACP filesystem access to the selected workspace and resolves permissions', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'lumora-gemini-adapter-'));
    onTestFinished(() => rm(workspace, { recursive: true, force: true }));
    await writeFile(join(workspace, 'inside.txt'), 'inside', 'utf8');
    const transport = new FakeTransport();
    let handleRequest: ((request: JsonRpcProviderRequest) => Promise<unknown>) | undefined;
    const current = context(workspace);
    const adapter = createGeminiStructuredAdapter(current.value, {
      createTransport: async (options) => {
        handleRequest = options.handleRequest;
        return transport;
      }
    });
    await adapter.open();
    await adapter.activate?.();

    await expect(handleRequest?.({
      id: 1,
      method: 'fs/read_text_file',
      params: { sessionId: 'gemini-native-1', path: join(workspace, 'inside.txt') }
    })).resolves.toEqual({ content: 'inside' });
    await expect(handleRequest?.({
      id: 2,
      method: 'fs/write_text_file',
      params: {
        sessionId: 'gemini-native-1',
        path: join(workspace, 'written.txt'),
        content: 'written'
      }
    })).resolves.toEqual({});
    await expect(readFile(join(workspace, 'written.txt'), 'utf8')).resolves.toBe('written');
    await expect(handleRequest?.({
      id: 3,
      method: 'fs/read_text_file',
      params: { sessionId: 'gemini-native-1', path: join(workspace, '..', 'outside.txt') }
    })).rejects.toThrow('workspace');

    const permission = handleRequest?.({
      id: 4,
      method: 'session/request_permission',
      params: {
        sessionId: 'gemini-native-1',
        toolCall: { toolCallId: 'tool-1', title: 'Run command' },
        options: [
          { optionId: 'once', kind: 'allow_once', name: 'Allow once' },
          { optionId: 'always', kind: 'allow_always', name: 'Always allow' },
          { optionId: 'reject', kind: 'reject_once', name: 'Reject' }
        ]
      }
    });
    await vi.waitFor(() => expect(current.events).toContainEqual(expect.objectContaining({
      kind: 'approval.requested',
      payload: expect.objectContaining({ approvalId: 'gemini-tool-1' })
    })));
    await adapter.dispatch({
      kind: 'approval.respond',
      connectionId: 'connection-gemini',
      approvalId: 'gemini-tool-1',
      decision: 'allow_once'
    });
    await expect(permission).resolves.toEqual({
      outcome: { outcome: 'selected', optionId: 'once' }
    });
    await adapter.close();
  });
});
