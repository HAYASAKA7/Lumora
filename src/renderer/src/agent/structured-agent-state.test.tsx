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
      event(9, 'diff.updated', {
        diffId: 'turn-1:workspace',
        files: [{
          pathLabel: 'src/app.ts', oldPathLabel: null,
          additions: 1, deletions: 1,
          patch: '@@ -1 +1 @@\n-old\n+new'
        }]
      }),
      event(10, 'approval.requested', {
        approvalId: 'approval-1', title: 'Run command', detail: 'npm test',
        choices: ['allow_once', 'deny']
      }),
      event(11, 'plan.updated', {
        items: [{ id: 'plan-1', text: 'Fix tests', status: 'completed' }]
      }),
      event(12, 'usage.updated', {
        inputTokens: 10, cachedInputTokens: 2, outputTokens: 4, totalTokens: 14
      }),
      event(13, 'assistant.message', { text: 'Done.' }),
      event(14, 'turn.completed', { state: 'completed', message: null })
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
      diffs: [{
        id: 'turn-1:workspace',
        files: [{ pathLabel: 'src/app.ts', additions: 1, deletions: 1 }]
      }],
      approvals: [{ id: 'approval-1', decision: null }],
      plan: [{ id: 'plan-1', status: 'completed' }]
    });
    expect(state.usage?.totalTokens).toBe(14);
  });

  it('replaces a repeated diff snapshot instead of duplicating it', () => {
    const state = [
      event(1, 'diff.updated', {
        diffId: 'turn-1:workspace',
        files: [{
          pathLabel: 'src/app.ts', oldPathLabel: null,
          additions: 1, deletions: 0, patch: '+first'
        }]
      }),
      event(2, 'diff.updated', {
        diffId: 'turn-1:workspace',
        files: [{
          pathLabel: 'src/app.ts', oldPathLabel: null,
          additions: 2, deletions: 0, patch: '+first\n+second'
        }]
      })
    ].reduce(reduceStructuredAgentEvent, createStructuredAgentViewState());

    expect(state.turns[0]?.diffs).toHaveLength(1);
    expect(state.turns[0]?.diffs[0]?.files[0]?.additions).toBe(2);
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

  it('retains structured provider account limits for session details', () => {
    const state = reduceStructuredAgentEvent(
      createStructuredAgentViewState(),
      event(1, 'account.usage.updated', {
        plan: 'pro',
        windows: [{
          kind: 'primary',
          usedPercent: 25,
          windowDurationMinutes: 300,
          resetsAt: 1_788_000_000
        }]
      })
    );

    expect(state.accountUsage).toEqual({
      plan: 'pro',
      windows: [{
        kind: 'primary',
        usedPercent: 25,
        windowDurationMinutes: 300,
        resetsAt: 1_788_000_000
      }]
    });
  });

  it('keeps completion-only provider operations visible when their start event was missed', () => {
    const state = [
      event(1, 'turn.started', { state: 'running', message: null }),
      event(2, 'command.updated', {
        activityId: 'command-late',
        title: 'npm run verify',
        status: 'completed',
        detail: 'All checks passed'
      }),
      event(3, 'tool.updated', {
        activityId: 'tool-late',
        title: 'browser · open',
        status: 'completed',
        detail: null
      }),
      event(4, 'turn.completed', { state: 'completed', message: null })
    ].reduce(reduceStructuredAgentEvent, createStructuredAgentViewState());

    expect(state.turns[0]?.activities).toEqual([
      {
        id: 'command-late', kind: 'command', title: 'npm run verify',
        detail: 'All checks passed', pathLabel: null, status: 'completed'
      },
      {
        id: 'tool-late', kind: 'tool', title: 'browser · open',
        detail: null, pathLabel: null, status: 'completed'
      }
    ]);
  });
});
