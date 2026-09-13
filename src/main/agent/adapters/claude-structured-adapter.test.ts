import * as nodeFs from 'node:fs/promises';
import * as nodeOs from 'node:os';
import * as nodePath from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import type { StructuredAgentCommand } from '../../../shared/agent/contracts';

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

  it('sends attached images to Claude as base64 blocks before the text', async () => {
    const directory = await nodeFs.mkdtemp(nodePath.join(nodeOs.tmpdir(), 'lumora-claude-images-'));
    const path = nodePath.join(directory, 'image-1.png');
    await nodeFs.writeFile(path, Buffer.from([1, 2, 3]));
    try {
      const query = new FakeQuery([{
        type: 'system', subtype: 'init', session_id: 'claude-native-2'
      }]);
      let input: AsyncIterable<unknown> | undefined;
      const current = context();
      const adapter = createClaudeStructuredAdapter({
        ...current.value,
        resolveImages: () => [{ path, mimeType: 'image/png', width: 10, height: 10, bytes: 3 }]
      }, {
        createQuery: (options) => {
          input = options.input;
          return query;
        },
        loadHistory: async () => [],
        createNativeSessionId: () => 'claude-native-2'
      });
      await expect(adapter.open()).resolves.toMatchObject({ acceptsImages: true });
      await adapter.activate?.();

      await adapter.dispatch({
        kind: 'prompt.submit',
        connectionId: 'connection-claude',
        text: 'What is this?',
        attachmentTokens: ['image-1']
      });

      const sent = await input?.[Symbol.asyncIterator]().next();
      expect(sent?.value).toMatchObject({
        type: 'user',
        message: {
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AQID' } },
            { type: 'text', text: 'What is this?' }
          ]
        }
      });
      expect(current.events).toContainEqual(expect.objectContaining({
        kind: 'user.message', payload: { text: 'What is this?', imageCount: 1 }
      }));
    } finally {
      await nodeFs.rm(directory, { recursive: true, force: true });
    }
  });

  describe('questions Claude asks the user', () => {
    async function openWithHooks() {
      const query = new FakeQuery([{
        type: 'system', subtype: 'init', session_id: 'claude-native-3'
      }]);
      let hooks: Parameters<ClaudeStructuredQueryFactory>[0] | undefined;
      const current = context();
      const adapter = createClaudeStructuredAdapter(current.value, {
        createQuery: (options) => {
          hooks = options;
          return query;
        },
        loadHistory: async () => [],
        createNativeSessionId: () => 'claude-native-3'
      });
      await adapter.open();
      await adapter.activate?.();
      return { adapter, current, hooks: () => hooks! };
    }

    const askInput = {
      questions: [
        {
          question: 'Which library should we use?',
          header: 'Library',
          multiSelect: false,
          options: [
            { label: 'date-fns', description: 'Small and modular' },
            { label: 'Luxon', description: 'Time zones built in' }
          ]
        },
        {
          question: 'Which checks should run?',
          header: 'Checks',
          multiSelect: true,
          options: [
            { label: 'Lint', description: '' },
            { label: 'Tests', description: '' }
          ]
        }
      ]
    };

    it('shows AskUserQuestion as questions and answers under the question text', async () => {
      const { adapter, current, hooks } = await openWithHooks();

      const decision = hooks().canUseTool('AskUserQuestion', askInput, {
        toolUseID: 'tool-ask',
        requestId: 'request-ask'
      });
      await vi.waitFor(() => expect(current.events).toContainEqual(expect.objectContaining({
        kind: 'question.requested',
        payload: expect.objectContaining({
          requestId: 'claude-question-tool-ask',
          source: 'agent',
          questions: [
            expect.objectContaining({
              id: 'question-0',
              header: 'Library',
              prompt: 'Which library should we use?',
              answer: 'choice',
              options: [
                { label: 'date-fns', description: 'Small and modular' },
                { label: 'Luxon', description: 'Time zones built in' }
              ],
              multiSelect: false,
              allowOther: true
            }),
            expect.objectContaining({ id: 'question-1', multiSelect: true })
          ]
        })
      })));
      // It is a question to answer, not a permission to allow.
      expect(current.events).not.toContainEqual(expect.objectContaining({ kind: 'approval.requested' }));

      await adapter.dispatch({
        kind: 'question.respond',
        connectionId: 'connection-claude',
        requestId: 'claude-question-tool-ask',
        outcome: 'answer',
        answers: { 'question-0': ['Luxon'], 'question-1': ['Lint', 'Tests'] }
      });

      await expect(decision).resolves.toEqual({
        behavior: 'allow',
        updatedInput: {
          ...askInput,
          answers: {
            'Which library should we use?': 'Luxon',
            'Which checks should run?': 'Lint, Tests'
          }
        }
      });
      expect(current.events).toContainEqual(expect.objectContaining({
        kind: 'question.resolved',
        payload: { requestId: 'claude-question-tool-ask', outcome: 'answered' }
      }));
    });

    it('denies the question when declined, and lets go of it when Claude withdraws it', async () => {
      const { adapter, current, hooks } = await openWithHooks();

      const declined = hooks().canUseTool('AskUserQuestion', askInput, {
        toolUseID: 'tool-decline',
        requestId: 'request-decline'
      });
      await vi.waitFor(() => expect(current.events).toContainEqual(
        expect.objectContaining({ kind: 'question.requested' })
      ));
      await adapter.dispatch({
        kind: 'question.respond',
        connectionId: 'connection-claude',
        requestId: 'claude-question-tool-decline',
        outcome: 'decline',
        answers: {}
      });
      await expect(declined).resolves.toMatchObject({ behavior: 'deny' });

      const controller = new AbortController();
      const withdrawn = hooks().canUseTool('AskUserQuestion', askInput, {
        toolUseID: 'tool-withdrawn',
        requestId: 'request-withdrawn',
        signal: controller.signal
      });
      await vi.waitFor(() => expect(current.events.filter((event) => (
        (event as { kind?: string }).kind === 'question.requested'
      ))).toHaveLength(2));
      controller.abort();

      await expect(withdrawn).resolves.toMatchObject({ behavior: 'deny' });
      expect(current.events).toContainEqual(expect.objectContaining({
        kind: 'question.resolved',
        payload: { requestId: 'claude-question-tool-withdrawn', outcome: 'cancelled' }
      }));
    });

    it('falls back to a plain approval when AskUserQuestion input is not the expected shape', async () => {
      const { current, hooks } = await openWithHooks();

      void hooks().canUseTool('AskUserQuestion', { questions: 'not a list' }, {
        toolUseID: 'tool-odd',
        requestId: 'request-odd'
      });

      await vi.waitFor(() => expect(current.events).toContainEqual(expect.objectContaining({
        kind: 'approval.requested',
        payload: expect.objectContaining({ approvalId: 'claude-tool-odd' })
      })));
    });

    it('fills in an MCP form through Claude, and declines one it cannot show', async () => {
      const { adapter, current, hooks } = await openWithHooks();

      const reply = hooks().onElicitation({
        serverName: 'deploy-server',
        message: 'Confirm the rollout.',
        mode: 'form',
        requestedSchema: {
          type: 'object',
          properties: { notify: { type: 'boolean', title: 'Notify the team' } }
        }
      }, { signal: new AbortController().signal });
      await vi.waitFor(() => expect(current.events).toContainEqual(expect.objectContaining({
        kind: 'question.requested',
        payload: expect.objectContaining({ source: 'mcp', serverName: 'deploy-server' })
      })));
      const requested = current.events.find((event) => (
        (event as { kind?: string }).kind === 'question.requested'
      )) as { payload: { requestId: string } };

      await adapter.dispatch({
        kind: 'question.respond',
        connectionId: 'connection-claude',
        requestId: requested.payload.requestId,
        outcome: 'answer',
        answers: { 'field-0': ['true'] }
      });
      await expect(reply).resolves.toEqual({ action: 'accept', content: { notify: true } });

      await expect(hooks().onElicitation({
        serverName: 'deploy-server',
        message: 'Nested',
        mode: 'form',
        requestedSchema: { type: 'object', properties: { address: { type: 'object' } } }
      }, { signal: new AbortController().signal })).resolves.toEqual({ action: 'decline' });
    });
  });

  describe('errors and limits Claude reports', () => {
    async function openLive() {
      const query = new FakeQuery([{
        type: 'system', subtype: 'init', session_id: 'claude-native-3'
      }]);
      const current = context();
      const adapter = createClaudeStructuredAdapter(current.value, {
        createQuery: () => query,
        loadHistory: async () => [],
        createNativeSessionId: () => 'claude-native-3'
      });
      await adapter.open();
      await adapter.activate?.();
      await adapter.dispatch({
        kind: 'prompt.submit',
        connectionId: 'connection-claude',
        text: 'Keep going',
        attachmentTokens: []
      });
      return { adapter, current, query };
    }
    const errors = (events: unknown[]) => events.filter((event) => (
      (event as { kind?: string }).kind === 'runtime.error'
    )) as Array<{ payload: Record<string, unknown> }>;

    it('says Claude is retrying, why, and which attempt this is', async () => {
      const { current, query } = await openLive();

      query.emit({
        type: 'system',
        subtype: 'api_retry',
        session_id: 'claude-native-3',
        attempt: 2,
        max_retries: 10,
        retry_delay_ms: 4_000,
        error_status: 529,
        error: 'overloaded'
      });

      await vi.waitFor(() => expect(errors(current.events)).toHaveLength(1));
      expect(errors(current.events)[0]?.payload).toEqual({
        code: 'CLAUDE_API_RETRY',
        message: 'Claude is retrying after an API error.',
        retryable: true,
        errorKind: 'overloaded',
        providerMessage: null,
        attempt: { current: 2, max: 10 },
        resetsAt: null
      });
    });

    it('reports a refused request at the usage limit with when it resets, and lets a warning pass', async () => {
      const { current, query } = await openLive();

      query.emit({
        type: 'rate_limit_event',
        session_id: 'claude-native-3',
        rate_limit_info: { status: 'allowed_warning', utilization: 0.9, rateLimitType: 'five_hour' }
      });
      query.emit({
        type: 'rate_limit_event',
        session_id: 'claude-native-3',
        rate_limit_info: { status: 'rejected', resetsAt: 1_788_000_000_000, rateLimitType: 'five_hour' }
      });

      await vi.waitFor(() => expect(errors(current.events)).toHaveLength(1));
      expect(errors(current.events)[0]?.payload).toMatchObject({
        code: 'CLAUDE_USAGE_LIMIT',
        errorKind: 'usage_limit',
        providerMessage: null,
        resetsAt: 1_788_000_000
      });
    });

    it('passes on the reason a turn failed in Claude\'s own words', async () => {
      const { current, query } = await openLive();

      query.emit({
        type: 'result',
        subtype: 'success',
        session_id: 'claude-native-3',
        is_error: true,
        api_error_status: 529,
        result: 'API Error: 529 Overloaded'
      });

      await vi.waitFor(() => expect(errors(current.events)).toHaveLength(1));
      expect(errors(current.events)[0]?.payload).toMatchObject({
        code: 'CLAUDE_TURN_FAILED',
        errorKind: 'overloaded',
        providerMessage: 'API Error: 529 Overloaded'
      });
      expect(current.events).toContainEqual(expect.objectContaining({
        kind: 'turn.completed',
        payload: expect.objectContaining({ state: 'failed' })
      }));
    });

    it('does not report a turn the user stopped as a failure', async () => {
      const { adapter, current, query } = await openLive();

      await adapter.dispatch({ kind: 'turn.cancel', connectionId: 'connection-claude' });
      query.emit({
        type: 'result',
        subtype: 'error_during_execution',
        session_id: 'claude-native-3',
        is_error: true,
        errors: ['Request was aborted.']
      });

      await vi.waitFor(() => expect(current.events).toContainEqual(expect.objectContaining({
        kind: 'turn.completed',
        payload: expect.objectContaining({ state: 'cancelled' })
      })));
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(errors(current.events)).toEqual([]);
    });
  });

  describe('Claude permission modes', () => {
    class ModeQuery extends FakeQuery {
      readonly setPermissionMode = vi.fn(async (_mode: string) => undefined);
    }

    async function openWithModes(initialMode?: string) {
      const query = new ModeQuery([{
        type: 'system', subtype: 'init', session_id: 'claude-native-4',
        ...(initialMode === undefined ? {} : { permissionMode: initialMode })
      }]);
      const current = context();
      const commandLists: StructuredAgentCommand[][] = [];
      current.value.callbacks.commandsChanged = (commands) => commandLists.push([...commands]);
      const adapter = createClaudeStructuredAdapter(current.value, {
        createQuery: () => query,
        loadHistory: async () => [],
        createNativeSessionId: () => 'claude-native-4'
      });
      await adapter.open();
      await adapter.activate?.();
      const mode = () => commandLists.at(-1)?.find(({ id }) => id === 'mode');
      await vi.waitFor(() => expect(mode()).toBeDefined());
      return { adapter, query, mode };
    }

    it('offers default, accept edits and plan, switches between them, and follows Claude', async () => {
      const { adapter, query, mode } = await openWithModes();

      expect(mode()?.selectedValue).toBe('default');
      expect(mode()?.choices?.map(({ value }) => value)).toEqual(['default', 'acceptEdits', 'plan']);

      await adapter.dispatch({
        kind: 'command.execute', connectionId: 'connection-claude', commandId: 'mode', argument: 'acceptEdits'
      });
      expect(query.setPermissionMode).toHaveBeenCalledWith('acceptEdits');
      expect(mode()?.selectedValue).toBe('acceptEdits');

      // Approving a plan moves Claude out of plan mode on its own.
      query.emit({ type: 'system', subtype: 'status', session_id: 'claude-native-4', status: null, permissionMode: 'plan' });
      await vi.waitFor(() => expect(mode()?.selectedValue).toBe('plan'));
    });

    it('never switches into bypassing permissions, but shows it truthfully when it is already on', async () => {
      const { adapter, query, mode } = await openWithModes('bypassPermissions');

      expect(mode()?.selectedValue).toBe('bypassPermissions');
      await adapter.dispatch({
        kind: 'command.execute', connectionId: 'connection-claude', commandId: 'mode', argument: 'default'
      });
      expect(query.setPermissionMode).toHaveBeenCalledWith('default');
      // Once left, it is no longer on offer.
      expect(mode()?.choices?.map(({ value }) => value)).toEqual(['default', 'acceptEdits', 'plan']);
      await expect(adapter.dispatch({
        kind: 'command.execute', connectionId: 'connection-claude', commandId: 'mode', argument: 'bypassPermissions'
      })).rejects.toThrow('mode is not available');
    });
  });

  describe('Claude plan and compaction', () => {
    async function openLive() {
      const query = new FakeQuery([{
        type: 'system', subtype: 'init', session_id: 'claude-native-5'
      }]);
      const current = context();
      const adapter = createClaudeStructuredAdapter(current.value, {
        createQuery: () => query,
        loadHistory: async () => [],
        createNativeSessionId: () => 'claude-native-5'
      });
      await adapter.open();
      await adapter.activate?.();
      await adapter.dispatch({
        kind: 'prompt.submit', connectionId: 'connection-claude', text: 'Fix the build', attachmentTokens: []
      });
      return { current, query };
    }
    const ofKind = (events: unknown[], kind: string) => events.filter((event) => (
      (event as { kind?: string }).kind === kind
    )) as Array<{ payload: Record<string, unknown> }>;

    it('shows Claude\u2019s to-do list as the plan, not as a tool it used', async () => {
      const { current, query } = await openLive();

      query.emit({
        type: 'assistant',
        session_id: 'claude-native-5',
        parent_tool_use_id: null,
        message: {
          content: [{
            type: 'tool_use', id: 'todo-1', name: 'TodoWrite',
            input: {
              todos: [
                { content: 'Reproduce the failure', status: 'completed', activeForm: 'Reproducing the failure' },
                { content: 'Fix the import', status: 'in_progress', activeForm: 'Fixing the import' },
                { content: 'Run the tests', status: 'pending', activeForm: 'Running the tests' }
              ]
            }
          }]
        }
      });
      query.emit({
        type: 'user',
        session_id: 'claude-native-5',
        message: { content: [{ type: 'tool_result', tool_use_id: 'todo-1', is_error: false }] }
      });

      await vi.waitFor(() => expect(ofKind(current.events, 'plan.updated')).toHaveLength(1));
      expect(ofKind(current.events, 'plan.updated')[0]?.payload).toEqual({
        items: [
          { id: 'todo-0', text: 'Reproduce the failure', status: 'completed' },
          { id: 'todo-1', text: 'Fix the import', status: 'in_progress' },
          { id: 'todo-2', text: 'Run the tests', status: 'pending' }
        ]
      });
      expect(ofKind(current.events, 'tool.started')).toEqual([]);
      expect(ofKind(current.events, 'tool.updated')).toEqual([]);
    });

    it('leaves a subagent\u2019s to-do list as its own tool call rather than the plan', async () => {
      const { current, query } = await openLive();

      query.emit({
        type: 'assistant',
        session_id: 'claude-native-5',
        parent_tool_use_id: 'task-1',
        message: {
          content: [{
            type: 'tool_use', id: 'todo-sub', name: 'TodoWrite',
            input: { todos: [{ content: 'Search the logs', status: 'pending', activeForm: 'Searching' }] }
          }]
        }
      });

      await vi.waitFor(() => expect(ofKind(current.events, 'tool.started')).toHaveLength(1));
      expect(ofKind(current.events, 'plan.updated')).toEqual([]);
    });

    it('shows the plan as it stood when a session is resumed', async () => {
      const query = new FakeQuery([{ type: 'system', subtype: 'init', session_id: 'claude-native-6' }]);
      const adapter = createClaudeStructuredAdapter(context('resume').value, {
        createQuery: () => query,
        loadHistory: async () => [{
          type: 'assistant',
          uuid: 'history-plan',
          parent_tool_use_id: null,
          message: {
            content: [{
              type: 'tool_use', id: 'todo-old', name: 'TodoWrite',
              input: { todos: [{ content: 'Ship it', status: 'completed', activeForm: 'Shipping' }] }
            }]
          }
        }],
        createNativeSessionId: () => 'claude-native-6'
      });

      const opened = await adapter.open();

      expect(opened.initialEvents).toContainEqual(expect.objectContaining({
        kind: 'plan.updated',
        payload: { items: [{ id: 'todo-0', text: 'Ship it', status: 'completed' }] }
      }));
    });

    it('shows when Claude compacted its context', async () => {
      const { current, query } = await openLive();

      query.emit({
        type: 'system',
        subtype: 'compact_boundary',
        session_id: 'claude-native-5',
        compact_metadata: { trigger: 'auto', pre_tokens: 180_000, post_tokens: 24_000 }
      });

      await vi.waitFor(() => expect(ofKind(current.events, 'tool.updated')).toHaveLength(1));
      expect(ofKind(current.events, 'tool.started')[0]?.payload).toEqual({
        activityId: 'claude-compact-1', title: 'Compact context', detail: null
      });
      expect(ofKind(current.events, 'tool.updated')[0]?.payload).toMatchObject({ status: 'completed' });
    });
  });
});
