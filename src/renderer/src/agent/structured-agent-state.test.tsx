import { describe, expect, it } from 'vitest';

import type { StructuredAgentEvent } from '../../../shared/contracts';
import {
  createStructuredAgentViewState,
  reduceStructuredAgentEvent
} from './structured-agent-state';

function event(
  sequence: number,
  kind: StructuredAgentEvent['kind'],
  payload: StructuredAgentEvent['payload'],
  turnId = 'turn-1'
): StructuredAgentEvent {
  return {
    connectionId: 'connection-1',
    providerId: 'codex',
    nativeSessionId: 'native-1',
    turnId,
    eventId: `event-${sequence}`,
    parentEventId: null,
    sequence,
    generation: 1,
    timestamp: `2026-08-27T00:00:${String(sequence).padStart(2, '0')}.000Z`,
    kind,
    payload
  } as StructuredAgentEvent;
}

describe('structured agent view state', () => {
  it('groups streamed conversation and provider activity into one ordered turn', () => {
    const events: StructuredAgentEvent[] = [
      event(1, 'turn.started', { state: 'running', message: null }),
      event(2, 'user.message', { text: 'Fix the tests.' }),
      event(3, 'assistant.delta', { text: 'I will ' }),
      event(4, 'assistant.delta', { text: 'inspect them.' }),
      event(5, 'reasoning.summary', { text: 'Checking failures' }),
      event(6, 'command.started', {
        activityId: 'command-1', title: 'Run tests', detail: 'npm test'
      }),
      event(7, 'command.updated', {
        activityId: 'command-1', status: 'completed', detail: 'All passed'
      }),
      event(8, 'file.changed', {
        activityId: 'file-1', title: 'Updated source', pathLabel: 'src/app.ts',
        change: 'updated'
      }),
      event(9, 'approval.requested', {
        approvalId: 'approval-1', title: 'Run command', detail: 'npm test',
        choices: ['allow_once', 'deny']
      }),
      event(10, 'plan.updated', {
        items: [{ id: 'plan-1', text: 'Fix tests', status: 'completed' }]
      }),
      event(11, 'usage.updated', {
        inputTokens: 10, cachedInputTokens: 2, outputTokens: 4, totalTokens: 14
      }),
      event(12, 'assistant.message', { text: 'Done.' }),
      event(13, 'turn.completed', { state: 'completed', message: null })
    ];

    const state = events.reduce(reduceStructuredAgentEvent, createStructuredAgentViewState());

    expect(state.turns).toHaveLength(1);
    expect(state.turns[0]).toMatchObject({
      id: 'turn-1',
      status: 'completed',
      userText: 'Fix the tests.',
      assistantText: 'Done.',
      reasoning: ['Checking failures'],
      activities: [
        { id: 'command-1', kind: 'command', status: 'completed' },
        { id: 'file-1', kind: 'file', status: 'completed' }
      ],
      approvals: [{ id: 'approval-1', decision: null }],
      plan: [{ id: 'plan-1', status: 'completed' }]
    });
    expect(state.usage?.totalTokens).toBe(14);
  });

  it('resolves approvals, reports recoverable errors, and ignores stale events', () => {
    const initial = [
      event(2, 'approval.requested', {
        approvalId: 'approval-1', title: 'Edit file', detail: 'src/app.ts',
        choices: ['allow_once', 'deny']
      }),
      event(3, 'approval.resolved', {
        approvalId: 'approval-1', decision: 'allow_once'
      }),
      event(4, 'runtime.error', {
        code: 'CONNECTION_LOST', message: 'Connection lost.', retryable: true
      })
    ].reduce(reduceStructuredAgentEvent, createStructuredAgentViewState());

    const stale = reduceStructuredAgentEvent(
      initial,
      event(3, 'assistant.message', { text: 'stale' })
    );

    expect(stale).toBe(initial);
    expect(initial.turns[0]?.approvals[0]?.decision).toBe('allow_once');
    expect(initial.error).toEqual({
      code: 'CONNECTION_LOST', message: 'Connection lost.', retryable: true
    });
  });
});
