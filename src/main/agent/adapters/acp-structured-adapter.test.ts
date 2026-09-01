import { describe, expect, it, vi } from 'vitest';

import type {
  JsonRpcNotification,
  JsonRpcProviderRequest,
  LineJsonRpcError,
  LineJsonRpcTransport
} from '../transport/line-json-rpc';
import { acpProviderProfile } from '../acp/acp-provider-profiles';
import type { StructuredAgentAdapterContext } from './structured-agent-adapter';
import {
  createAcpStructuredAdapter,
  type AcpStructuredTransportFactory
} from './acp-structured-adapter';

class FakeAcpTransport implements LineJsonRpcTransport {
  authMethods: Array<{ id: string }> = [];
  promptResponse: unknown = { stopReason: 'end_turn' };
  readonly request = vi.fn(async (method: string) => {
    if (method === 'initialize') {
      return {
        protocolVersion: 1,
        agentCapabilities: { loadSession: true },
        authMethods: this.authMethods
      };
    }
    if (method === 'session/new') return { sessionId: 'opencode-native-1' };
    if (method === 'session/prompt') return this.promptResponse;
    return {};
  });
  readonly notify = vi.fn(async () => undefined);
  readonly close = vi.fn(async () => undefined);
  onNotification(_listener: (value: JsonRpcNotification) => void): () => void {
    return () => undefined;
  }
  onExit(_listener: (error: LineJsonRpcError) => void): () => void {
    return () => undefined;
  }
}

function context(
  providerId: 'opencode' | 'qwen' = 'opencode',
  strategy: 'new' | 'resume' = 'new'
): StructuredAgentAdapterContext {
  return {
    connectionId: `connection-${providerId}`,
    providerId,
    generation: 1,
    launch: {
      request: strategy === 'resume'
        ? {
            strategy: 'resume',
            providerId,
            sessionId: 'catalog-1',
            startPrompt: ''
          }
        : {
            strategy: 'new',
            providerId,
            workspaceId: 'workspace-1',
            startPrompt: ''
          },
      workspaceId: 'workspace-1',
      catalogSessionId: strategy === 'resume' ? 'catalog-1' : null,
      nativeSessionId: strategy === 'resume' ? `${providerId}-native-1` : null,
      title: `${providerId} session`,
      workingDirectory: 'C:\\workspace',
      executablePath: `C:\\tools\\${providerId}.cmd`
    },
    callbacks: { emit: vi.fn(), exited: vi.fn() }
  };
}

describe('generic ACP structured adapter', () => {
  it('opens an advertised-auth provider with its exact ACP invocation', async () => {
    const transport = new FakeAcpTransport();
    const createTransport: AcpStructuredTransportFactory = vi.fn(async () => transport);
    const adapter = createAcpStructuredAdapter(
      context(),
      acpProviderProfile('opencode'),
      { createTransport }
    );

    await expect(adapter.open()).resolves.toMatchObject({
      nativeSessionId: 'opencode-native-1'
    });
    expect(createTransport).toHaveBeenCalledWith(expect.objectContaining({
      arguments: ['acp'],
      executablePath: 'C:\\tools\\opencode.cmd'
    }));
    expect(transport.request).not.toHaveBeenCalledWith('authenticate', expect.anything());
  });

  it('rejects a mismatched provider profile before spawning a process', () => {
    expect(() => createAcpStructuredAdapter(
      context(),
      acpProviderProfile('qwen')
    )).toThrow('Qwen Code');
  });

  it('authenticates with an advertised method before loading an exact session', async () => {
    const transport = new FakeAcpTransport();
    transport.authMethods = [{ id: 'qwen-login' }];
    const adapter = createAcpStructuredAdapter(
      context('qwen', 'resume'),
      acpProviderProfile('qwen'),
      { createTransport: async () => transport }
    );

    await expect(adapter.open()).resolves.toMatchObject({
      nativeSessionId: 'qwen-native-1'
    });
    expect(transport.request).toHaveBeenCalledWith('authenticate', {
      methodId: 'qwen-login'
    });
    expect(transport.request).toHaveBeenCalledWith('session/load', {
      sessionId: 'qwen-native-1',
      cwd: 'C:\\workspace',
      mcpServers: []
    });
  });

  it('does not fail a completed turn when a provider adds nonstandard usage fields', async () => {
    const transport = new FakeAcpTransport();
    transport.promptResponse = {
      stopReason: 'end_turn',
      usage: { totalTokens: 21, providerExtension: true }
    };
    const current = context();
    const adapter = createAcpStructuredAdapter(
      current,
      acpProviderProfile('opencode'),
      { createTransport: async () => transport }
    );
    await adapter.open();
    await adapter.activate?.();

    await adapter.dispatch({
      kind: 'prompt.submit',
      connectionId: current.connectionId,
      text: 'Hello',
      attachmentTokens: []
    });

    await vi.waitFor(() => expect(current.callbacks.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'turn.completed',
        payload: expect.objectContaining({ state: 'completed' })
      })
    ));
  });
});
