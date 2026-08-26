import { describe, expect, it, vi } from 'vitest';

import {
  IPC_CHANNELS,
  LOCAL_EXECUTION_TARGET_ID,
  type StructuredAgentEvent,
  type StructuredProviderPreference
} from '../../shared/contracts';
import { registerAgentIpc } from './register-agent-ipc';

type Handler = (event: unknown, input?: unknown) => Promise<unknown>;

function event() {
  return {
    sender: { id: 17 },
    senderFrame: { url: 'app://lumora/index.html' }
  };
}

function runtimeSummary() {
  return {
    connectionId: 'connection-1',
    providerId: 'codex' as const,
    nativeSessionId: 'native-1',
    catalogSessionId: null,
    workspaceId: 'workspace-1',
    title: 'Structured session',
    state: 'ready' as const,
    generation: 1,
    createdAt: '2026-08-27T00:00:00.000Z',
    updatedAt: '2026-08-27T00:00:00.000Z',
    error: null
  };
}

function harness() {
  const handlers = new Map<string, Handler>();
  const authorize = vi.fn(() => ({
    mode: 'local' as const,
    executionTargetId: LOCAL_EXECUTION_TARGET_ID
  }));
  const summary = runtimeSummary();
  const runtime = {
    launch: vi.fn(async () => summary),
    list: vi.fn(() => [summary]),
    snapshot: vi.fn(() => ({ runtime: summary, events: [], boundary: null })),
    dispatch: vi.fn(async () => undefined),
    reconnect: vi.fn(async () => summary),
    close: vi.fn(async () => summary),
    subscribe: vi.fn<(listener: (value: StructuredAgentEvent) => void) => () => void>()
  };
  let publish: ((event: StructuredAgentEvent) => void) | null = null;
  const unsubscribe = vi.fn();
  runtime.subscribe.mockImplementation((listener) => {
    publish = listener;
    return unsubscribe;
  });
  const scanCapabilities = vi.fn(async () => []);
  const preferenceValues: StructuredProviderPreference[] = [
      { providerId: 'codex' as const, useUnifiedWhenAvailable: true, executablePathOverride: null },
      { providerId: 'claude' as const, useUnifiedWhenAvailable: true, executablePathOverride: null },
      { providerId: 'gemini' as const, useUnifiedWhenAvailable: true, executablePathOverride: null }
  ];
  const preferences = {
    list: vi.fn(() => preferenceValues),
    save: vi.fn(async (input: StructuredProviderPreference) =>
      preferenceValues.map((value) => value.providerId === input.providerId ? input : value)
    )
  };
  const sendEvent = vi.fn();
  const startPrepared = vi.fn(async () => ({
    mode: 'structured' as const,
    routeReason: 'verified' as const,
    runtime: summary
  }));
  const dispose = registerAgentIpc({
    ipc: { handle: (channel, handler) => handlers.set(channel, handler as Handler) },
    authorize,
    runtime,
    scanCapabilities,
    preferences,
    startPrepared,
    sendEvent
  });
  return {
    handlers,
    authorize,
    runtime,
    scanCapabilities,
    preferences,
    startPrepared,
    sendEvent,
    dispose,
    unsubscribe,
    publish: (value: StructuredAgentEvent) => publish?.(value)
  };
}

describe('registerAgentIpc', () => {
  it('starts a prepared launch through the automatic local agent router', async () => {
    const current = harness();
    const start = current.handlers.get(IPC_CHANNELS.agentRuntimeStart)!;

    await expect(start(event(), {
      launchToken: '0198f8b6-18f3-7ca0-9f0f-123456789abc'
    })).resolves.toMatchObject({ mode: 'structured', routeReason: 'verified' });
    expect(current.startPrepared).toHaveBeenCalledWith(
      '0198f8b6-18f3-7ca0-9f0f-123456789abc'
    );
  });

  it('authorizes before parsing and delegates validated local runtime operations', async () => {
    const current = harness();
    const launch = current.handlers.get(IPC_CHANNELS.structuredRuntimeLaunch)!;
    await expect(launch(event(), {
      strategy: 'new', providerId: 'codex', workspaceId: 'workspace-1', startPrompt: ''
    })).resolves.toEqual(runtimeSummary());
    expect(current.authorize).toHaveBeenCalledBefore(current.runtime.launch);

    const action = current.handlers.get(IPC_CHANNELS.structuredRuntimeAction)!;
    await expect(action(event(), {
      kind: 'prompt.submit', connectionId: 'connection-1', text: 'Hello', attachmentTokens: []
    })).resolves.toEqual({ accepted: true });
    expect(current.runtime.dispatch).toHaveBeenCalledWith(expect.objectContaining({ text: 'Hello' }));
  });

  it('sanitizes invalid requests and runtime failures', async () => {
    const current = harness();
    const close = current.handlers.get(IPC_CHANNELS.structuredRuntimeClose)!;
    await expect(close(event(), { connectionId: '../private/path' })).rejects.toMatchObject({
      code: 'STRUCTURED_AGENT_OPERATION_FAILED',
      message: 'Lumora could not complete the structured agent operation.'
    });
    current.runtime.close.mockRejectedValueOnce(new Error('secret path and token'));
    await expect(close(event(), { connectionId: 'connection-1' })).rejects.not.toThrow(
      'secret path and token'
    );
  });

  it('reads and saves validated per-provider routing preferences', async () => {
    const current = harness();
    const get = current.handlers.get(IPC_CHANNELS.structuredPreferencesGet)!;
    await expect(get(event())).resolves.toHaveLength(3);
    const save = current.handlers.get(IPC_CHANNELS.structuredPreferenceSave)!;
    await expect(save(event(), {
      providerId: 'claude', useUnifiedWhenAvailable: false, executablePathOverride: null
    })).resolves.toContainEqual({
      providerId: 'claude', useUnifiedWhenAvailable: false, executablePathOverride: null
    });
  });

  it('rejects a remote window even when a broad authorizer is injected', async () => {
    const current = harness();
    current.authorize.mockReturnValueOnce({
      mode: 'remote', executionTargetId: '1db51c25-4984-49c7-bfd3-24a438f991d1'
    } as never);
    const list = current.handlers.get(IPC_CHANNELS.structuredRuntimeList)!;
    await expect(list(event())).rejects.toMatchObject({ code: 'IPC_UNTRUSTED_SENDER' });
    expect(current.runtime.list).not.toHaveBeenCalled();
  });

  it('validates runtime events and disposes its host subscription', () => {
    const current = harness();
    const value: StructuredAgentEvent = {
      connectionId: 'connection-1', providerId: 'codex', nativeSessionId: 'native-1',
      turnId: 'lifecycle', eventId: 'event-1', parentEventId: null, sequence: 1,
      generation: 1, timestamp: '2026-08-27T00:00:00.000Z', kind: 'runtime.status',
      payload: { state: 'ready', message: null }
    };
    current.publish(value);
    expect(current.sendEvent).toHaveBeenCalledWith(value);
    current.dispose();
    expect(current.unsubscribe).toHaveBeenCalledOnce();
  });
});
