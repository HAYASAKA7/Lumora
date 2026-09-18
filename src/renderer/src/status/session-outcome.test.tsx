import { describe, expect, it } from 'vitest';

import type { StructuredAgentEvent } from '../../../shared/contracts';
import {
  sessionIndicator,
  structuredSessionOutcome,
  structuredSessionState
} from './session-outcome';

let sequence = 0;

function event(
  kind: StructuredAgentEvent['kind'],
  payload: Record<string, unknown>,
  turnId = 'turn-1'
): StructuredAgentEvent {
  sequence += 1;
  return {
    connectionId: 'connection-1',
    providerId: 'codex',
    nativeSessionId: 'native-1',
    turnId,
    eventId: `event-${sequence}`,
    parentEventId: null,
    sequence,
    generation: 1,
    timestamp: '2026-09-18T00:00:00.000Z',
    kind,
    payload
  } as StructuredAgentEvent;
}

const started = (turnId = 'turn-1') => event('turn.started', { state: 'running', message: null }, turnId);
const completed = (state: 'completed' | 'failed' | 'cancelled', turnId = 'turn-1') =>
  event('turn.completed', { state, message: null }, turnId);

describe('sessionIndicator', () => {
  it('puts a request for you first, then work in progress, then a finish or failure', () => {
    expect(sessionIndicator('needs_you', true)).toBe('needs_you');
    expect(sessionIndicator('finished', true)).toBe('working');
    expect(sessionIndicator('failed', false)).toBe('failed');
    expect(sessionIndicator(undefined, true)).toBe('working');
    expect(sessionIndicator(undefined, false)).toBeUndefined();
  });
});

describe('structuredSessionOutcome', () => {
  it('has no outcome while a turn runs, or before any turn', () => {
    expect(structuredSessionOutcome([])).toBeNull();
    expect(structuredSessionOutcome([started()])).toBeNull();
  });

  it('reads a finished turn and a failed one, each as its own outcome', () => {
    const done = completed('completed');
    expect(structuredSessionOutcome([started(), done])).toEqual({
      kind: 'finished',
      key: done.eventId
    });
    const broke = completed('failed', 'turn-2');
    expect(structuredSessionOutcome([started(), done, started('turn-2'), broke])).toEqual({
      kind: 'failed',
      key: broke.eventId
    });
  });

  it('gives no outcome for a turn you cancelled yourself', () => {
    expect(structuredSessionOutcome([started(), completed('cancelled')])).toBeNull();
  });

  it('waits on you until every approval and question is settled', () => {
    const approval = event('approval.requested', { approvalId: 'approval-1' });
    const question = event('question.requested', { requestId: 'question-1' });
    expect(structuredSessionOutcome([started(), approval])).toEqual({
      kind: 'needs_you',
      key: approval.eventId
    });
    const both = [started(), approval, question];
    expect(structuredSessionOutcome([
      ...both,
      event('approval.resolved', { approvalId: 'approval-1', decision: 'allow_once' })
    ])?.kind).toBe('needs_you');
    expect(structuredSessionOutcome([
      ...both,
      event('approval.resolved', { approvalId: 'approval-1', decision: 'allow_once' }),
      event('question.resolved', { requestId: 'question-1', outcome: 'answered' })
    ])).toBeNull();
  });

  it('forgets an outcome once the agent is at work again', () => {
    expect(structuredSessionOutcome([
      started(),
      completed('completed'),
      started('turn-2')
    ])).toBeNull();
  });

  it('is working while a turn runs, and not while it waits on you or after it ends', () => {
    const approval = event('approval.requested', { approvalId: 'approval-2' });
    expect(structuredSessionState([]).working).toBe(false);
    expect(structuredSessionState([started()]).working).toBe(true);
    expect(structuredSessionState([started(), approval]).working).toBe(false);
    expect(structuredSessionState([
      started(),
      approval,
      event('approval.resolved', { approvalId: 'approval-2', decision: 'allow_once' })
    ]).working).toBe(true);
    expect(structuredSessionState([started(), completed('completed')]).working).toBe(false);
    expect(structuredSessionState([started(), completed('cancelled')]).working).toBe(false);
  });

  it('reads only the latest turn, however long the history before it', () => {
    const history = Array.from({ length: 200 }, (_, index) => [
      started(`old-${index}`),
      event('assistant.delta', { text: 'working' }, `old-${index}`),
      completed('completed', `old-${index}`)
    ]).flat();
    const approval = event('approval.requested', { approvalId: 'approval-9' }, 'turn-latest');
    expect(structuredSessionOutcome([
      ...history,
      started('turn-latest'),
      approval
    ])).toEqual({ kind: 'needs_you', key: approval.eventId });
  });
});
