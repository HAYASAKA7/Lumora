import { describe, expect, it, vi } from 'vitest';

import type {
  ResolvedStructuredAgentLaunch,
  StructuredAgentAdapter,
  StructuredAgentAdapterContext
} from '../adapters/structured-agent-adapter';
import {
  StructuredAgentRuntimeHost,
  StructuredAgentRuntimeHostError
} from './structured-agent-runtime-host';
import { StructuredSessionGuard } from './structured-session-guard';

const newRequest = {
  strategy: 'new' as const,
  providerId: 'codex' as const,
  workspaceId: 'workspace-1',
  startPrompt: ''
};

function resolved(
  nativeSessionId: string | null = null
): ResolvedStructuredAgentLaunch {
  return {
    request: newRequest,
    workspaceId: 'workspace-1',
    catalogSessionId: null,
    nativeSessionId,
    title: 'New Codex session',
    workingDirectory: 'C:\\workspace',
    executablePath: 'C:\\tools\\codex.exe'
  };
}

function harness(options: { maxTailEvents?: number } = {}) {
  const contexts: StructuredAgentAdapterContext[] = [];
  const adapters: StructuredAgentAdapter[] = [];
  const dispatch = vi.fn(async () => undefined);
  const close = vi.fn(async () => undefined);
  let connectionNumber = 0;
  let eventNumber = 0;
  let clockTick = 0;
  const host = new StructuredAgentRuntimeHost({
    resolveLaunch: async () => resolved(),
    createAdapter: (context) => {
      contexts.push(context);
      const adapter: StructuredAgentAdapter = {
        open: vi.fn(async () => ({ nativeSessionId: 'native-1' })),
        dispatch,
        close
      };
      adapters.push(adapter);
      return adapter;
    },
    sessionGuard: new StructuredSessionGuard(),
    createConnectionId: () => `connection-${++connectionNumber}`,
    createEventId: () => `event-${++eventNumber}`,
    clock: () => new Date(1_787_741_200_000 + clockTick++ * 1_000),
    ...options
  });
  return { host, contexts, adapters, dispatch, close };
}

describe('StructuredAgentRuntimeHost', () => {
  it('launches a new native session and emits an ordered bounded envelope', async () => {
    const { host } = harness();
    const observed: unknown[] = [];
    host.subscribe((event) => observed.push(event));

    const runtime = await host.launch(newRequest);

    expect(runtime).toMatchObject({
      connectionId: 'connection-1',
      nativeSessionId: 'native-1',
      state: 'ready',
      generation: 1
    });
    expect(observed).toMatchObject([
      { kind: 'runtime.status', sequence: 0, nativeSessionId: null },
      { kind: 'runtime.status', sequence: 1, nativeSessionId: 'native-1' }
    ]);
    expect(host.snapshot('connection-1').events).toHaveLength(2);
  });

  it('records hydrated provider history only after native identity is assigned', async () => {
    let connectionNumber = 0;
    let eventNumber = 0;
    const activate = vi.fn(async () => undefined);
    const host = new StructuredAgentRuntimeHost({
      resolveLaunch: async () => resolved(),
      createAdapter: () => ({
        open: async () => ({
          nativeSessionId: 'native-1',
          initialEvents: [{
            turnId: 'turn-history',
            parentEventId: null,
            kind: 'assistant.message',
            payload: { text: 'Earlier answer' }
          }]
        }),
        activate,
        dispatch: async () => undefined,
        close: async () => undefined
      }),
      createConnectionId: () => `connection-${++connectionNumber}`,
      createEventId: () => `event-${++eventNumber}`
    });

    await host.launch(newRequest);

    expect(host.snapshot('connection-1').events).toMatchObject([
      { kind: 'runtime.status', nativeSessionId: null },
      {
        kind: 'assistant.message',
        nativeSessionId: 'native-1',
        turnId: 'turn-history'
      },
      { kind: 'runtime.status', nativeSessionId: 'native-1' }
    ]);
    expect(activate).toHaveBeenCalledOnce();
  });

  it('routes actions to the owning adapter and preserves provider events', async () => {
    const { host, contexts, dispatch } = harness();
    await host.launch(newRequest);
    contexts[0]!.callbacks.emit({
      turnId: 'turn-1',
      parentEventId: null,
      kind: 'assistant.delta',
      payload: { text: 'Working' }
    });

    await host.dispatch({
      kind: 'prompt.submit',
      connectionId: 'connection-1',
      text: 'Continue',
      attachmentTokens: []
    });

    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'prompt.submit',
      text: 'Continue'
    }));
    expect(host.snapshot('connection-1').events.at(-1)).toMatchObject({
      kind: 'assistant.delta',
      sequence: 2,
      generation: 1
    });
  });

  it('rejects a second writer for the same known native provider session', async () => {
    const guard = new StructuredSessionGuard();
    const createAdapter = vi.fn((): StructuredAgentAdapter => ({
      open: async () => ({ nativeSessionId: 'thread-known' }),
      dispatch: async () => undefined,
      close: async () => undefined
    }));
    const host = new StructuredAgentRuntimeHost({
      resolveLaunch: async () => ({
        ...resolved('thread-known'),
        request: {
          strategy: 'resume',
          providerId: 'codex',
          sessionId: 'catalog-session',
          startPrompt: ''
        },
        catalogSessionId: 'catalog-session'
      }),
      createAdapter,
      sessionGuard: guard,
      createConnectionId: (() => {
        let value = 0;
        return () => `connection-${++value}`;
      })()
    });

    await host.launch({
      strategy: 'resume',
      providerId: 'codex',
      sessionId: 'catalog-session',
      startPrompt: ''
    });
    await expect(host.launch({
      strategy: 'resume',
      providerId: 'codex',
      sessionId: 'catalog-session',
      startPrompt: ''
    })).rejects.toBeInstanceOf(StructuredAgentRuntimeHostError);
    expect(createAdapter).toHaveBeenCalledOnce();
  });

  it('changes generation on reconnect and ignores callbacks from the old adapter', async () => {
    const { host, contexts } = harness();
    await host.launch(newRequest);
    await host.reconnect('connection-1');
    contexts[0]!.callbacks.emit({
      turnId: 'stale-turn',
      parentEventId: null,
      kind: 'assistant.delta',
      payload: { text: 'stale' }
    });
    contexts[1]!.callbacks.emit({
      turnId: 'current-turn',
      parentEventId: null,
      kind: 'assistant.delta',
      payload: { text: 'current' }
    });

    const snapshot = host.snapshot('connection-1');
    expect(snapshot.runtime.generation).toBe(2);
    expect(snapshot.events.some((event) =>
      event.kind === 'assistant.delta' && event.payload.text === 'stale'
    )).toBe(false);
    expect(snapshot.events.at(-1)).toMatchObject({
      generation: 2,
      kind: 'assistant.delta',
      payload: { text: 'current' }
    });
  });

  it('retains only the configured normalized event tail', async () => {
    const { host, contexts } = harness({ maxTailEvents: 3 });
    await host.launch(newRequest);
    for (let index = 0; index < 5; index += 1) {
      contexts[0]!.callbacks.emit({
        turnId: 'turn-1',
        parentEventId: null,
        kind: 'assistant.delta',
        payload: { text: `chunk-${index}` }
      });
    }

    const snapshot = host.snapshot('connection-1');
    expect(snapshot.events).toHaveLength(3);
    expect(snapshot.events.map(({ sequence }) => sequence)).toEqual([4, 5, 6]);
    expect(snapshot.boundary?.kind).toBe('connection_start');
  });

  it('closes and shuts down idempotently while releasing native ownership', async () => {
    const { host, close } = harness();
    await host.launch(newRequest);

    const [first, second] = await Promise.all([
      host.close('connection-1'),
      host.close('connection-1')
    ]);
    await Promise.all([host.shutdown(), host.shutdown()]);

    expect(first.state).toBe('closed');
    expect(second.state).toBe('closed');
    expect(close).toHaveBeenCalledOnce();
  });
});
