import { describe, expect, it, vi } from 'vitest';

import type { StructuredAgentAdapterContext } from './structured-agent-adapter';
import {
  createClaudeStructuredAdapter,
  type ClaudeQueryLike,
  type ClaudeStructuredQueryFactory,
  resolveClaudeSdkExecutablePath
} from './claude-structured-adapter';

class FakeQuery implements ClaudeQueryLike {
  readonly interrupt = vi.fn(async () => undefined);
  readonly setModel = vi.fn(async () => undefined);
  readonly supportedCommands = vi.fn(async () => [{
    name: 'compact',
    description: 'Compact the current context.',
    argumentHint: ''
  }]);
  readonly supportedModels = vi.fn(async () => [{
    value: 'sonnet',
    displayName: 'Claude Sonnet',
    description: 'Balanced for everyday work.'
  }, {
    value: 'opus',
    displayName: 'Claude Opus',
    description: 'Most capable for complex work.'
  }]);
  readonly close = vi.fn(() => undefined);
  private readonly values: unknown[];
  private waiting: {
    resolve(value: IteratorResult<unknown>): void;
    reject(error: Error): void;
  } | null = null;
  private done = false;

  constructor(initial: unknown[] = []) {
    this.values = [...initial];
  }

  emit(value: unknown): void {
    if (this.waiting !== null) {
      const { resolve } = this.waiting;
      this.waiting = null;
      resolve({ done: false, value });
      return;
    }
    this.values.push(value);
  }

  finish(): void {
    this.done = true;
    this.waiting?.resolve({ done: true, value: undefined });
    this.waiting = null;
  }

  fail(error: Error): void {
    this.done = true;
    this.waiting?.reject(error);
    this.waiting = null;
  }

  [Symbol.asyncIterator](): AsyncIterator<unknown> {
    return {
      next: async () => {
        const next = this.values.shift();
        if (next !== undefined) return { done: false, value: next };
        if (this.done) return { done: true, value: undefined };
        return new Promise((resolve, reject) => { this.waiting = { resolve, reject }; });
      }
    };
  }
}

function context(strategy: 'new' | 'resume' = 'new') {
  const events: unknown[] = [];
  const exited = vi.fn();
  const value: StructuredAgentAdapterContext = {
    connectionId: 'connection-claude',
    providerId: 'claude',
    generation: 1,
    launch: {
      request: strategy === 'new'
        ? { strategy: 'new', providerId: 'claude', workspaceId: 'workspace-1', startPrompt: '' }
        : { strategy: 'resume', providerId: 'claude', sessionId: 'catalog-1', startPrompt: '' },
      workspaceId: 'workspace-1',
      catalogSessionId: strategy === 'resume' ? 'catalog-1' : null,
      nativeSessionId: strategy === 'resume' ? 'claude-native-1' : null,
      title: 'Claude session',
      workingDirectory: '/workspace',
      executablePath: '/usr/local/bin/claude'
    },
    callbacks: {
      emit: (event) => events.push(event),
      exited
    }
  };
  return { value, events, exited };
}

describe('Claude structured adapter', () => {
  it('resolves a Windows npm wrapper to the native Claude executable used by the SDK', async () => {
    const wrapper = 'D:\\node-global\\claude.cmd';
    const expected = 'D:\\node-global\\node_modules\\@anthropic-ai\\claude-code\\bin\\claude.exe';
    const isExecutable = vi.fn(async (path: string) => path === expected);

    await expect(resolveClaudeSdkExecutablePath(
      wrapper,
      'win32',
      isExecutable
    )).resolves.toBe(expected);
    expect(isExecutable).toHaveBeenCalledWith(expected);
  });

  it('keeps directly executable Claude paths unchanged on every platform', async () => {
    const isExecutable = vi.fn(async () => false);

    await expect(resolveClaudeSdkExecutablePath(
      '/usr/local/bin/claude',
      'linux',
      isExecutable
    )).resolves.toBe('/usr/local/bin/claude');
    expect(isExecutable).not.toHaveBeenCalled();
  });

  it('uses the installed runtime, existing settings, and exact native session identity', async () => {
    const query = new FakeQuery([{
      type: 'system', subtype: 'init', session_id: 'claude-native-1'
    }]);
    let factoryOptions: Parameters<ClaudeStructuredQueryFactory>[0] | undefined;
    const current = context('resume');
    const adapter = createClaudeStructuredAdapter(current.value, {
      createQuery: (options) => {
        factoryOptions = options;
        return query;
      },
      loadHistory: async () => [{
        type: 'assistant',
        uuid: 'history-1',
        session_id: 'claude-native-1',
        parent_tool_use_id: null,
        message: { role: 'assistant', content: [{ type: 'text', text: 'Earlier answer' }] }
      }],
      resolveSdkExecutablePath: async () => '/usr/local/bin/claude'
    });

    const opened = await adapter.open();

    expect(factoryOptions).toMatchObject({
      executablePath: '/usr/local/bin/claude',
      workingDirectory: '/workspace',
      resumeSessionId: 'claude-native-1',
      newSessionId: null,
      settingSources: ['user', 'project', 'local']
    });
    expect(opened.nativeSessionId).toBe('claude-native-1');
    expect(opened.initialEvents).toContainEqual(expect.objectContaining({
      kind: 'assistant.message', payload: { text: 'Earlier answer' }
    }));
  });

  it('opens resumed history before Claude emits its first prompt-bound init event', async () => {
    const query = new FakeQuery();
    const current = context('resume');
    const adapter = createClaudeStructuredAdapter(current.value, {
      createQuery: () => query,
      loadHistory: async () => [{
        type: 'assistant',
        uuid: 'history-before-init',
        session_id: 'claude-native-1',
        parent_tool_use_id: null,
        message: { role: 'assistant', content: 'Earlier answer' }
      }],
      resolveSdkExecutablePath: async () => '/usr/local/bin/claude'
    });

    await expect(Promise.race([
      adapter.open(),
      new Promise((_, reject) => setTimeout(
        () => reject(new Error('open waited for init')),
        50
      ))
    ])).resolves.toMatchObject({
      nativeSessionId: 'claude-native-1',
      initialEvents: [expect.objectContaining({
        kind: 'assistant.message', payload: { text: 'Earlier answer' }
      })]
    });

    await adapter.close();
  });

  it('streams prompts and normalized messages while cancelling safely', async () => {
    const query = new FakeQuery([{
      type: 'system', subtype: 'init', session_id: 'claude-native-2'
    }]);
    let input: AsyncIterable<unknown> | undefined;
    const current = context();
    const adapter = createClaudeStructuredAdapter(current.value, {
      createQuery: (options) => {
        input = options.input;
        return query;
      },
      loadHistory: async () => [],
      createNativeSessionId: () => 'claude-native-2'
    });
    await adapter.open();
    await adapter.activate?.();

    await adapter.dispatch({
      kind: 'prompt.submit',
      connectionId: 'connection-claude',
      text: 'Inspect this',
      attachmentTokens: []
    });
    const sent = await input?.[Symbol.asyncIterator]().next();
    expect(sent?.value).toMatchObject({
      type: 'user', message: { role: 'user', content: 'Inspect this' }
    });

    query.emit({
      type: 'stream_event',
      session_id: 'claude-native-2',
      event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Working' } }
    });
    query.emit({
      type: 'assistant',
      session_id: 'claude-native-2',
      message: {
        content: [{
          type: 'tool_use', id: 'edit-1', name: 'Edit',
          input: {
            file_path: 'src/app.ts',
            old_string: 'export const ready = false;',
            new_string: 'export const ready = true;'
          }
        }]
      }
    });
    query.emit({
      type: 'user',
      session_id: 'claude-native-2',
      message: {
        content: [{ type: 'tool_result', tool_use_id: 'edit-1', is_error: false }]
      }
    });
    query.emit({
      type: 'result',
      subtype: 'success',
      session_id: 'claude-native-2',
      usage: { input_tokens: 10, cache_read_input_tokens: 2, output_tokens: 4 },
      is_error: false
    });
    await vi.waitFor(() => expect(current.events).toContainEqual(expect.objectContaining({
      kind: 'assistant.delta', payload: { text: 'Working' }
    })));
    expect(current.events).toContainEqual(expect.objectContaining({
      kind: 'usage.updated',
      payload: { inputTokens: 10, cachedInputTokens: 2, outputTokens: 4, totalTokens: 14 }
    }));
    expect(current.events).toContainEqual(expect.objectContaining({
      kind: 'diff.updated',
      payload: expect.objectContaining({
        files: [expect.objectContaining({
          pathLabel: 'src/app.ts', additions: 1, deletions: 1
        })]
      })
    }));

    await adapter.dispatch({ kind: 'turn.cancel', connectionId: 'connection-claude' });
    expect(query.interrupt).not.toHaveBeenCalled();
  });

  it('completes a top-level end_turn when Claude omits result without completing the next turn', async () => {
    const query = new FakeQuery([{
      type: 'system', subtype: 'init', session_id: 'claude-native-end-turn'
    }]);
    let input: AsyncIterable<unknown> | undefined;
    const current = context();
    const adapter = createClaudeStructuredAdapter(current.value, {
      createQuery: (options) => {
        input = options.input;
        return query;
      },
      loadHistory: async () => [],
      createNativeSessionId: () => 'claude-native-end-turn'
    });
    await adapter.open();
    const inputIterator = input?.[Symbol.asyncIterator]();

    await adapter.dispatch({
      kind: 'prompt.submit',
      connectionId: 'connection-claude',
      text: 'First prompt',
      attachmentTokens: []
    });
    const firstInput = await inputIterator?.next();
    const firstMessage = firstInput?.value as { uuid?: unknown } | undefined;
    const firstUserMessageUuid = firstMessage?.uuid;
    expect(firstUserMessageUuid).toEqual(expect.any(String));

    query.emit({
      type: 'stream_event',
      session_id: 'claude-native-end-turn',
      uuid: 'subagent-stream',
      user_message_uuid: firstUserMessageUuid,
      parent_tool_use_id: 'agent-tool-1',
      event: {
        type: 'message_delta',
        delta: { stop_reason: 'end_turn', stop_sequence: null },
        usage: { output_tokens: 2 }
      }
    });
    query.emit({
      type: 'stream_event',
      session_id: 'claude-native-end-turn',
      uuid: 'subagent-stream',
      parent_tool_use_id: 'agent-tool-1',
      event: { type: 'message_stop' }
    });
    query.emit({
      type: 'stream_event',
      session_id: 'claude-native-end-turn',
      uuid: 'tool-stream',
      user_message_uuid: firstUserMessageUuid,
      parent_tool_use_id: null,
      event: {
        type: 'message_delta',
        delta: { stop_reason: 'tool_use', stop_sequence: null },
        usage: { output_tokens: 3 }
      }
    });
    query.emit({
      type: 'stream_event',
      session_id: 'claude-native-end-turn',
      uuid: 'tool-stream',
      parent_tool_use_id: null,
      event: { type: 'message_stop' }
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(current.events).not.toContainEqual(expect.objectContaining({
      kind: 'turn.completed'
    }));

    query.emit({
      type: 'stream_event',
      session_id: 'claude-native-end-turn',
      uuid: 'assistant-stream-1',
      user_message_uuid: firstUserMessageUuid,
      parent_tool_use_id: null,
      event: { type: 'message_start', message: { content: [] } }
    });
    query.emit({
      type: 'assistant',
      session_id: 'claude-native-end-turn',
      uuid: 'assistant-stream-1',
      user_message_uuid: firstUserMessageUuid,
      parent_tool_use_id: null,
      message: {
        stop_reason: null,
        content: [{ type: 'text', text: 'First response' }]
      }
    });
    query.emit({
      type: 'stream_event',
      session_id: 'claude-native-end-turn',
      uuid: 'assistant-stream-1',
      parent_tool_use_id: null,
      event: {
        type: 'message_delta',
        delta: { stop_reason: 'end_turn', stop_sequence: null },
        usage: { output_tokens: 5 }
      }
    });
    query.emit({
      type: 'stream_event',
      session_id: 'claude-native-end-turn',
      uuid: 'assistant-stream-1',
      parent_tool_use_id: null,
      event: { type: 'message_stop' }
    });

    await vi.waitFor(() => expect(current.events).toContainEqual(expect.objectContaining({
      kind: 'turn.completed',
      turnId: 'claude-turn-1',
      payload: { state: 'completed', message: null }
    })));

    await adapter.dispatch({
      kind: 'prompt.submit',
      connectionId: 'connection-claude',
      text: 'Second prompt',
      attachmentTokens: []
    });
    await inputIterator?.next();
    query.emit({
      type: 'result',
      subtype: 'error_during_execution',
      session_id: 'claude-native-end-turn',
      user_message_uuid: firstUserMessageUuid,
      usage: { input_tokens: 10, cache_read_input_tokens: 0, output_tokens: 5 },
      is_error: true
    });
    await vi.waitFor(() => expect(current.events).toContainEqual(expect.objectContaining({
      kind: 'usage.updated'
    })));
    expect(current.events).not.toContainEqual(expect.objectContaining({
      kind: 'turn.completed',
      turnId: 'claude-turn-2'
    }));
    expect(current.events).toContainEqual(expect.objectContaining({
      kind: 'turn.completed',
      turnId: 'claude-turn-1',
      payload: {
        state: 'failed',
        message: 'Claude could not complete this turn.'
      }
    }));
    expect(current.events.filter((event) => (
      (event as { kind?: unknown }).kind === 'turn.completed' &&
      (event as { turnId?: unknown }).turnId === 'claude-turn-1'
    ))).toHaveLength(2);
  });

  it('does not let a result-less completed turn consume the next turn result', async () => {
    const query = new FakeQuery([{
      type: 'system', subtype: 'init', session_id: 'claude-native-result-queue'
    }]);
    let input: AsyncIterable<unknown> | undefined;
    const current = context();
    const adapter = createClaudeStructuredAdapter(current.value, {
      createQuery: (options) => {
        input = options.input;
        return query;
      },
      loadHistory: async () => [],
      createNativeSessionId: () => 'claude-native-result-queue'
    });
    await adapter.open();
    const inputIterator = input?.[Symbol.asyncIterator]();

    await adapter.dispatch({
      kind: 'prompt.submit', connectionId: 'connection-claude',
      text: 'First prompt', attachmentTokens: []
    });
    const firstInput = await inputIterator?.next();
    const firstUuid = (firstInput?.value as { uuid?: unknown } | undefined)?.uuid;
    query.emit({
      type: 'stream_event', session_id: 'claude-native-result-queue',
      uuid: 'first-assistant', user_message_uuid: firstUuid, parent_tool_use_id: null,
      event: { type: 'message_delta', delta: { stop_reason: 'end_turn' } }
    });
    query.emit({
      type: 'stream_event', session_id: 'claude-native-result-queue',
      uuid: 'first-assistant', parent_tool_use_id: null,
      event: { type: 'message_stop' }
    });
    await vi.waitFor(() => expect(current.events).toContainEqual(expect.objectContaining({
      kind: 'turn.completed', turnId: 'claude-turn-1'
    })));

    await adapter.dispatch({
      kind: 'prompt.submit', connectionId: 'connection-claude',
      text: 'Second prompt', attachmentTokens: []
    });
    await inputIterator?.next();
    query.emit({
      type: 'result', subtype: 'success', session_id: 'claude-native-result-queue',
      usage: { input_tokens: 4, cache_read_input_tokens: 0, output_tokens: 2 },
      is_error: false
    });

    await vi.waitFor(() => expect(current.events).toContainEqual(expect.objectContaining({
      kind: 'turn.completed',
      turnId: 'claude-turn-2',
      payload: { state: 'completed', message: null }
    })));
  });

  it('rejects a second prompt while Claude is still processing the active turn', async () => {
    const query = new FakeQuery([{
      type: 'system', subtype: 'init', session_id: 'claude-native-concurrent'
    }]);
    const current = context();
    const adapter = createClaudeStructuredAdapter(current.value, {
      createQuery: () => query,
      loadHistory: async () => [],
      createNativeSessionId: () => 'claude-native-concurrent'
    });
    await adapter.open();
    await adapter.dispatch({
      kind: 'prompt.submit', connectionId: 'connection-claude',
      text: 'First prompt', attachmentTokens: []
    });

    await expect(adapter.dispatch({
      kind: 'prompt.submit', connectionId: 'connection-claude',
      text: 'Second prompt', attachmentTokens: []
    })).rejects.toThrow('Claude is already processing a prompt.');
  });

  it('finishes an interrupted turn as cancelled even when Claude omits a result', async () => {
    const query = new FakeQuery([{
      type: 'system', subtype: 'init', session_id: 'claude-native-cancel'
    }]);
    const current = context();
    const adapter = createClaudeStructuredAdapter(current.value, {
      createQuery: () => query,
      loadHistory: async () => [],
      createNativeSessionId: () => 'claude-native-cancel'
    });
    await adapter.open();
    await adapter.dispatch({
      kind: 'prompt.submit', connectionId: 'connection-claude',
      text: 'Long task', attachmentTokens: []
    });

    await adapter.dispatch({ kind: 'turn.cancel', connectionId: 'connection-claude' });

    expect(query.interrupt).toHaveBeenCalledOnce();
    expect(current.events).toContainEqual(expect.objectContaining({
      kind: 'turn.completed',
      turnId: 'claude-turn-1',
      payload: { state: 'cancelled', message: null }
    }));
  });

  it('recovers a completed session when the Claude SDK stream closes between turns', async () => {
    const firstQuery = new FakeQuery([{
      type: 'system', subtype: 'init', session_id: 'claude-native-recovery'
    }]);
    const secondQuery = new FakeQuery([{
      type: 'system', subtype: 'init', session_id: 'claude-native-recovery'
    }]);
    const queries = [firstQuery, secondQuery];
    const inputs: AsyncIterable<unknown>[] = [];
    const factoryOptions: Parameters<ClaudeStructuredQueryFactory>[0][] = [];
    const current = context();
    const adapter = createClaudeStructuredAdapter(current.value, {
      createQuery: (options) => {
        factoryOptions.push(options);
        inputs.push(options.input);
        const next = queries.shift();
        if (next === undefined) throw new Error('Unexpected query creation.');
        return next;
      },
      loadHistory: async () => [],
      createNativeSessionId: () => 'claude-native-recovery'
    });
    await adapter.open();
    await adapter.dispatch({
      kind: 'prompt.submit', connectionId: 'connection-claude',
      text: 'First prompt', attachmentTokens: []
    });
    firstQuery.emit({
      type: 'result', subtype: 'success', session_id: 'claude-native-recovery',
      usage: { input_tokens: 3, cache_read_input_tokens: 0, output_tokens: 2 },
      is_error: false
    });
    await vi.waitFor(() => expect(current.events).toContainEqual(expect.objectContaining({
      kind: 'turn.completed', turnId: 'claude-turn-1'
    })));

    firstQuery.finish();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(current.exited).not.toHaveBeenCalled();

    await adapter.dispatch({
      kind: 'prompt.submit', connectionId: 'connection-claude',
      text: 'Second prompt', attachmentTokens: []
    });
    expect(factoryOptions).toHaveLength(2);
    expect(factoryOptions[1]).toMatchObject({
      resumeSessionId: 'claude-native-recovery',
      newSessionId: null
    });
    await expect(inputs[1]?.[Symbol.asyncIterator]().next()).resolves.toMatchObject({
      value: expect.objectContaining({
        message: expect.objectContaining({ content: 'Second prompt' })
      })
    });
  });

  it('fails only the active turn and remains recoverable when the Claude SDK crashes', async () => {
    const firstQuery = new FakeQuery([{
      type: 'system', subtype: 'init', session_id: 'claude-native-crash'
    }]);
    const secondQuery = new FakeQuery([{
      type: 'system', subtype: 'init', session_id: 'claude-native-crash'
    }]);
    const queries = [firstQuery, secondQuery];
    const current = context();
    const adapter = createClaudeStructuredAdapter(current.value, {
      createQuery: () => {
        const next = queries.shift();
        if (next === undefined) throw new Error('Unexpected query creation.');
        return next;
      },
      loadHistory: async () => [],
      createNativeSessionId: () => 'claude-native-crash'
    });
    await adapter.open();
    await adapter.dispatch({
      kind: 'prompt.submit', connectionId: 'connection-claude',
      text: 'Prompt before crash', attachmentTokens: []
    });

    firstQuery.fail(new Error('provider process crashed'));

    await vi.waitFor(() => expect(current.events).toContainEqual(expect.objectContaining({
      kind: 'turn.completed',
      turnId: 'claude-turn-1',
      payload: {
        state: 'failed',
        message: 'Claude stopped before completing this turn. You can send the prompt again.'
      }
    })));
    expect(current.events).toContainEqual(expect.objectContaining({
      kind: 'runtime.error',
      turnId: 'claude-turn-1',
      payload: expect.objectContaining({ code: 'CLAUDE_QUERY_STOPPED', retryable: true })
    }));
    expect(current.exited).not.toHaveBeenCalled();

    await expect(adapter.dispatch({
      kind: 'prompt.submit', connectionId: 'connection-claude',
      text: 'Retry after crash', attachmentTokens: []
    })).resolves.toBeUndefined();
  });

  it('keeps cancellation authoritative when Claude emits a late result', async () => {
    const query = new FakeQuery([{
      type: 'system', subtype: 'init', session_id: 'claude-native-late-cancel'
    }]);
    let input: AsyncIterable<unknown> | undefined;
    const current = context();
    const adapter = createClaudeStructuredAdapter(current.value, {
      createQuery: (options) => {
        input = options.input;
        return query;
      },
      loadHistory: async () => [],
      createNativeSessionId: () => 'claude-native-late-cancel'
    });
    await adapter.open();
    await adapter.dispatch({
      kind: 'prompt.submit', connectionId: 'connection-claude',
      text: 'Cancel this', attachmentTokens: []
    });
    const sent = await input?.[Symbol.asyncIterator]().next();
    const userMessageUuid = (sent?.value as { uuid?: unknown } | undefined)?.uuid;
    await adapter.dispatch({ kind: 'turn.cancel', connectionId: 'connection-claude' });

    query.emit({
      type: 'result', subtype: 'success', session_id: 'claude-native-late-cancel',
      user_message_uuid: userMessageUuid,
      usage: { input_tokens: 2, cache_read_input_tokens: 0, output_tokens: 1 },
      is_error: false
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(current.events.filter((event) => (
      (event as { kind?: unknown }).kind === 'turn.completed' &&
      (event as { turnId?: unknown }).turnId === 'claude-turn-1'
    ))).toEqual([expect.objectContaining({
      payload: { state: 'cancelled', message: null }
    })]);
  });

  it('discovers and executes Claude slash commands through the SDK stream', async () => {
    const query = new FakeQuery([{
      type: 'system', subtype: 'init', session_id: 'claude-native-commands', model: 'sonnet'
    }]);
    let input: AsyncIterable<unknown> | undefined;
    const current = context();
    const commandLists: unknown[] = [];
    current.value.callbacks.commandsChanged = (commands) => commandLists.push(commands);
    const adapter = createClaudeStructuredAdapter(current.value, {
      createQuery: (options) => {
        input = options.input;
        return query;
      },
      loadHistory: async () => [],
      createNativeSessionId: () => 'claude-native-commands'
    });

    const opened = await adapter.open();
    await vi.waitFor(() => expect(
      (opened.commands?.length ?? 0) > 0 ? opened.commands : commandLists.at(-1)
    ).toEqual([
      {
        id: 'model',
        name: '/model',
        description: 'Choose the model for future turns.',
        descriptionKey: 'terminal.unified.commands.model',
        inputHint: '<model>',
        choices: [{
          value: 'sonnet',
          label: 'Claude Sonnet',
          description: 'Balanced for everyday work.'
        }, {
          value: 'opus',
          label: 'Claude Opus',
          description: 'Most capable for complex work.'
        }],
        selectedValue: 'sonnet',
        selectionBehavior: 'execute'
      },
      {
        id: 'claude:compact',
        name: '/compact',
        description: 'Compact the current context.',
        inputHint: null
      }
    ]));

    await adapter.dispatch({
      kind: 'command.execute',
      connectionId: 'connection-claude',
      commandId: 'model',
      argument: 'opus'
    });
    expect(query.setModel).toHaveBeenCalledWith('opus');
    expect(commandLists.at(-1)).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'model', selectedValue: 'opus' })
    ]));

    await adapter.dispatch({
      kind: 'command.execute',
      connectionId: 'connection-claude',
      commandId: 'claude:compact',
      argument: ''
    });
    expect((await input?.[Symbol.asyncIterator]().next())?.value).toMatchObject({
      message: { content: '/compact' }
    });
  });

  it('routes tool permission decisions and ignores malformed future messages', async () => {
    const query = new FakeQuery([{
      type: 'system', subtype: 'init', session_id: 'claude-native-3'
    }]);
    let canUseTool: Parameters<ClaudeStructuredQueryFactory>[0]['canUseTool'] | undefined;
    const current = context();
    const adapter = createClaudeStructuredAdapter(current.value, {
      createQuery: (options) => {
        canUseTool = options.canUseTool;
        return query;
      },
      loadHistory: async () => [],
      createNativeSessionId: () => 'claude-native-3'
    });
    await adapter.open();
    await adapter.activate?.();
    query.emit({ type: 'future_message', secret: 'ignored' });

    const permission = canUseTool?.('Bash', { command: 'npm test' }, {
      toolUseID: 'tool-1',
      requestId: 'request-1',
      title: 'Run tests',
      description: 'Claude wants to run npm test',
      suggestions: [{ type: 'addRules', rules: [], behavior: 'allow', destination: 'session' }]
    });
    await vi.waitFor(() => expect(current.events).toContainEqual(expect.objectContaining({
      kind: 'approval.requested',
      payload: expect.objectContaining({ approvalId: 'claude-tool-1' })
    })));
    await adapter.dispatch({
      kind: 'approval.respond',
      connectionId: 'connection-claude',
      approvalId: 'claude-tool-1',
      decision: 'allow_session'
    });
    await expect(permission).resolves.toMatchObject({
      behavior: 'allow',
      updatedPermissions: expect.any(Array)
    });
  });
});
