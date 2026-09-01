import { describe, expect, it } from 'vitest';

import {
  STRUCTURED_AGENT_PROVIDER_IDS,
  StructuredAgentActionSchema,
  StructuredAgentCommandSchema,
  StructuredAgentEventSchema,
  StructuredAgentHistoryPageSchema,
  StructuredAgentLaunchRequestSchema,
  StructuredAgentRuntimeSnapshotSchema,
  StructuredAgentRuntimeSummarySchema
} from './contracts';

const envelope = {
  connectionId: 'connection-01',
  providerId: 'codex',
  nativeSessionId: 'thread-01',
  turnId: 'turn-01',
  eventId: 'event-01',
  parentEventId: null,
  sequence: 1,
  generation: 1,
  timestamp: '2026-08-26T12:00:00.000Z'
} as const;

describe('structured agent contracts', () => {
  it('covers every provider with a native ACP candidate', () => {
    expect(STRUCTURED_AGENT_PROVIDER_IDS).toEqual([
      'codex',
      'claude',
      'gemini',
      'opencode',
      'cursor',
      'copilot',
      'qwen',
      'kimi',
      'goose'
    ]);
    for (const providerId of STRUCTURED_AGENT_PROVIDER_IDS) {
      expect(StructuredAgentLaunchRequestSchema.parse({
        strategy: 'new',
        providerId,
        workspaceId: 'workspace-01',
        startPrompt: ''
      }).providerId).toBe(providerId);
    }
  });

  it('accepts bounded turn-grouped conversation and activity events', () => {
    expect(StructuredAgentEventSchema.parse({
      ...envelope,
      kind: 'assistant.delta',
      payload: { text: 'Working on it.' }
    })).toMatchObject({
      providerId: 'codex',
      turnId: 'turn-01',
      kind: 'assistant.delta'
    });

    expect(StructuredAgentEventSchema.parse({
      ...envelope,
      eventId: 'event-02',
      kind: 'tool.started',
      payload: {
        activityId: 'tool-01',
        title: 'Read file',
        detail: 'Reading a source file'
      }
    }).kind).toBe('tool.started');

    expect(StructuredAgentEventSchema.parse({
      ...envelope,
      eventId: 'event-03',
      kind: 'approval.requested',
      payload: {
        approvalId: 'approval-01',
        title: 'Run tests',
        detail: 'Allow the agent to run the focused test?',
        choices: ['allow_once', 'deny']
      }
    }).kind).toBe('approval.requested');

    expect(StructuredAgentEventSchema.parse({
      ...envelope,
      eventId: 'event-04',
      kind: 'diff.updated',
      payload: {
        diffId: 'turn-01:workspace',
        files: [{
          pathLabel: 'src/app.ts',
          oldPathLabel: null,
          additions: 1,
          deletions: 1,
          patch: '@@ -1 +1 @@\n-old value\n+new value'
        }]
      }
    }).kind).toBe('diff.updated');
  });

  it('allows a pending native identity only while a new provider session starts', () => {
    expect(StructuredAgentEventSchema.parse({
      ...envelope,
      nativeSessionId: null,
      kind: 'runtime.status',
      payload: { state: 'starting', message: null }
    }).nativeSessionId).toBeNull();

    expect(() => StructuredAgentEventSchema.parse({
      ...envelope,
      nativeSessionId: null,
      kind: 'runtime.status',
      payload: { state: 'ready', message: null }
    })).toThrow();

    expect(() => StructuredAgentEventSchema.parse({
      ...envelope,
      nativeSessionId: null,
      kind: 'assistant.delta',
      payload: { text: 'invalid before identity' }
    })).toThrow();
  });

  it('accepts only bounded catalog metadata from native identity reconciliation', () => {
    expect(StructuredAgentEventSchema.parse({
      ...envelope,
      kind: 'runtime.metadata',
      payload: {
        catalogSessionId: 'catalog-session-01',
        title: 'Provider-owned title'
      }
    })).toMatchObject({
      kind: 'runtime.metadata',
      payload: { catalogSessionId: 'catalog-session-01' }
    });
    expect(() => StructuredAgentEventSchema.parse({
      ...envelope,
      kind: 'runtime.metadata',
      payload: {
        catalogSessionId: 'catalog-session-01',
        title: 'Provider-owned title',
        transcriptPath: 'C:\\secret\\session.jsonl'
      }
    })).toThrow();
  });

  it('rejects unknown fields, invalid ordering, and oversized payloads', () => {
    expect(() => StructuredAgentEventSchema.parse({
      ...envelope,
      kind: 'assistant.delta',
      payload: { text: 'ok' },
      rawProviderPayload: { secret: true }
    })).toThrow();

    expect(() => StructuredAgentEventSchema.parse({
      ...envelope,
      sequence: -1,
      kind: 'assistant.delta',
      payload: { text: 'ok' }
    })).toThrow();

    expect(() => StructuredAgentEventSchema.parse({
      ...envelope,
      kind: 'assistant.delta',
      payload: { text: 'x'.repeat(65_537) }
    })).toThrow();

    expect(() => StructuredAgentEventSchema.parse({
      ...envelope,
      kind: 'diff.updated',
      payload: {
        diffId: 'turn-01:workspace',
        files: [{
          pathLabel: 'src/app.ts',
          oldPathLabel: null,
          additions: 1,
          deletions: 0,
          patch: 'x'.repeat(262_145)
        }]
      }
    })).toThrow();
  });

  it('validates renderer actions without exposing provider commands or paths', () => {
    expect(StructuredAgentActionSchema.parse({
      kind: 'prompt.submit',
      connectionId: 'connection-01',
      text: 'Please inspect this change.',
      attachmentTokens: ['attachment-01']
    })).toMatchObject({ kind: 'prompt.submit' });

    expect(StructuredAgentActionSchema.parse({
      kind: 'approval.respond',
      connectionId: 'connection-01',
      approvalId: 'approval-01',
      decision: 'allow_once'
    })).toMatchObject({ kind: 'approval.respond' });

    expect(StructuredAgentActionSchema.parse({
      kind: 'session.details.refresh',
      connectionId: 'connection-01'
    })).toMatchObject({ kind: 'session.details.refresh' });

    expect(() => StructuredAgentActionSchema.parse({
      kind: 'prompt.submit',
      connectionId: 'connection-01',
      text: 'hello',
      executablePath: 'C:\\secret\\provider.exe'
    })).toThrow();
  });

  it('uses catalog identities for launch and keeps prompt content optional', () => {
    expect(StructuredAgentLaunchRequestSchema.parse({
      strategy: 'new',
      providerId: 'gemini',
      workspaceId: 'workspace-01',
      startPrompt: ''
    })).toEqual({
      strategy: 'new',
      providerId: 'gemini',
      workspaceId: 'workspace-01',
      startPrompt: ''
    });

    expect(StructuredAgentLaunchRequestSchema.parse({
      strategy: 'resume',
      providerId: 'claude',
      sessionId: 'session-01',
      startPrompt: 'Continue the review.'
    })).toMatchObject({ strategy: 'resume', sessionId: 'session-01' });
  });

  it('bounds hydrated history and makes incomplete history explicit', () => {
    const page = StructuredAgentHistoryPageSchema.parse({
      nativeSessionId: 'thread-01',
      events: [{
        ...envelope,
        kind: 'assistant.message',
        payload: { text: 'Completed.' }
      }],
      nextCursor: null,
      boundary: {
        kind: 'provider_limit',
        message: 'Earlier history is unavailable from this provider.'
      }
    });

    expect(page.boundary?.kind).toBe('provider_limit');
  });

  it('validates provider command choices without exposing native authority', () => {
    expect(StructuredAgentCommandSchema.parse({
      id: 'model',
      name: '/model',
      description: 'Choose a model.',
      descriptionKey: 'terminal.unified.commands.model',
      inputHint: '<model>',
      choices: [{
        value: 'gpt-5.6-sol',
        label: 'GPT-5.6 Sol',
        description: 'Frontier coding model'
      }],
      selectedValue: 'gpt-5.6-sol',
      selectionBehavior: 'execute'
    })).toMatchObject({
      id: 'model',
      selectedValue: 'gpt-5.6-sol',
      choices: [{ value: 'gpt-5.6-sol' }]
    });
    expect(() => StructuredAgentCommandSchema.parse({
      id: 'unsafe',
      name: '/unsafe',
      description: 'Unsafe command.',
      inputHint: null,
      choices: [{
        value: '',
        label: 'Invalid',
        description: null
      }]
    })).toThrow();
    expect(() => StructuredAgentCommandSchema.parse({
      id: 'model',
      name: '/model',
      description: 'Choose a model.',
      inputHint: '<model>',
      choices: [{ value: 'available', label: 'Available', description: null }],
      selectedValue: 'missing'
    })).toThrow();
  });

  it('signals live command metadata changes without carrying provider authority', () => {
    expect(StructuredAgentEventSchema.parse({
      ...envelope,
      kind: 'runtime.commands',
      payload: { count: 2 }
    })).toMatchObject({ kind: 'runtime.commands', payload: { count: 2 } });
  });

  it('exposes bounded runtime state without provider paths or raw payloads', () => {
    const runtime = StructuredAgentRuntimeSummarySchema.parse({
      connectionId: 'connection-01',
      providerId: 'codex',
      nativeSessionId: 'thread-01',
      catalogSessionId: 'session-01',
      workspaceId: 'workspace-01',
      title: 'Review Lumora',
      state: 'ready',
      generation: 1,
      createdAt: '2026-08-26T12:00:00.000Z',
      updatedAt: '2026-08-26T12:00:01.000Z',
      error: null
    });
    const snapshot = StructuredAgentRuntimeSnapshotSchema.parse({
      runtime,
      events: [{
        ...envelope,
        kind: 'assistant.message',
        payload: { text: 'Ready.' }
      }],
      boundary: {
        kind: 'connection_start',
        message: 'This view starts when Lumora connected.'
      }
    });

    expect(snapshot.runtime.state).toBe('ready');
    expect(JSON.stringify(snapshot)).not.toContain('executablePath');
    expect(() => StructuredAgentRuntimeSnapshotSchema.parse({
      ...snapshot,
      events: Array.from({ length: 501 }, () => snapshot.events[0])
    })).toThrow();
  });
});
