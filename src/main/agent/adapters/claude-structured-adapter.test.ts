import { describe, expect, it, vi } from 'vitest';

import type { StructuredAgentAdapterContext } from './structured-agent-adapter';
import {
  createClaudeStructuredAdapter,
  type ClaudeQueryLike,
  type ClaudeStructuredQueryFactory
} from './claude-structured-adapter';

class FakeQuery implements ClaudeQueryLike {
  readonly interrupt = vi.fn(async () => undefined);
  readonly close = vi.fn(() => undefined);
  private readonly values: unknown[];
  private waiting: ((value: IteratorResult<unknown>) => void) | null = null;
  private done = false;

  constructor(initial: unknown[] = []) {
    this.values = [...initial];
  }

  emit(value: unknown): void {
    if (this.waiting !== null) {
      const resolve = this.waiting;
      this.waiting = null;
      resolve({ done: false, value });
      return;
    }
    this.values.push(value);
  }

  finish(): void {
    this.done = true;
    this.waiting?.({ done: true, value: undefined });
    this.waiting = null;
  }

  [Symbol.asyncIterator](): AsyncIterator<unknown> {
    return {
      next: async () => {
        const next = this.values.shift();
        if (next !== undefined) return { done: false, value: next };
        if (this.done) return { done: true, value: undefined };
        return new Promise((resolve) => { this.waiting = resolve; });
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
      }]
    });

    const opened = await adapter.open();

    expect(factoryOptions).toMatchObject({
      executablePath: '/usr/local/bin/claude',
      workingDirectory: '/workspace',
      resumeSessionId: 'claude-native-1',
      settingSources: ['user', 'project', 'local']
    });
    expect(opened.nativeSessionId).toBe('claude-native-1');
    expect(opened.initialEvents).toContainEqual(expect.objectContaining({
      kind: 'assistant.message', payload: { text: 'Earlier answer' }
    }));
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
      loadHistory: async () => []
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

    await adapter.dispatch({ kind: 'turn.cancel', connectionId: 'connection-claude' });
    expect(query.interrupt).toHaveBeenCalledOnce();
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
      loadHistory: async () => []
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
