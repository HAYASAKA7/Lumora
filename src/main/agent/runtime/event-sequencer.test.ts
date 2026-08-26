import { describe, expect, it } from 'vitest';

import { StructuredAgentEventSchema } from '../../../shared/agent/contracts';
import { StructuredAgentEventSequencer } from './event-sequencer';

describe('StructuredAgentEventSequencer', () => {
  it('owns envelope identity and emits strictly increasing sequence numbers', () => {
    let eventNumber = 0;
    const sequencer = new StructuredAgentEventSequencer({
      connectionId: 'connection-1',
      providerId: 'codex',
      generation: 1,
      nativeSessionId: 'thread-1',
      clock: () => new Date('2026-08-26T12:00:00.000Z'),
      createEventId: () => `event-${++eventNumber}`
    });

    const first = sequencer.next(1, {
      turnId: 'turn-1',
      parentEventId: null,
      kind: 'turn.started',
      payload: { state: 'running', message: null }
    });
    const second = sequencer.next(1, {
      turnId: 'turn-1',
      parentEventId: first?.eventId ?? null,
      kind: 'assistant.delta',
      payload: { text: 'Hello' }
    });

    expect(first).toMatchObject({ sequence: 0, eventId: 'event-1' });
    expect(second).toMatchObject({
      sequence: 1,
      eventId: 'event-2',
      parentEventId: 'event-1'
    });
    expect(StructuredAgentEventSchema.safeParse(second).success).toBe(true);
  });

  it('drops stale callbacks after generation changes', () => {
    const sequencer = new StructuredAgentEventSequencer({
      connectionId: 'connection-1',
      providerId: 'gemini',
      generation: 1,
      nativeSessionId: 'session-1'
    });

    expect(sequencer.bumpGeneration()).toBe(2);
    expect(sequencer.next(1, {
      turnId: 'turn-old',
      parentEventId: null,
      kind: 'assistant.delta',
      payload: { text: 'stale' }
    })).toBeNull();
    expect(sequencer.next(2, {
      turnId: 'turn-new',
      parentEventId: null,
      kind: 'assistant.delta',
      payload: { text: 'current' }
    })).toMatchObject({ generation: 2, sequence: 0 });
  });

  it('allows only runtime status before native session identity is assigned', () => {
    const sequencer = new StructuredAgentEventSequencer({
      connectionId: 'connection-1',
      providerId: 'claude',
      generation: 1,
      nativeSessionId: null
    });

    expect(sequencer.next(1, {
      turnId: 'lifecycle',
      parentEventId: null,
      kind: 'runtime.status',
      payload: { state: 'starting', message: null }
    })).toMatchObject({ nativeSessionId: null });
    expect(() => sequencer.next(1, {
      turnId: 'turn-1',
      parentEventId: null,
      kind: 'assistant.delta',
      payload: { text: 'invalid before identity' }
    })).toThrow();

    sequencer.assignNativeSessionId('native-claude-1');
    expect(sequencer.next(1, {
      turnId: 'turn-1',
      parentEventId: null,
      kind: 'assistant.delta',
      payload: { text: 'valid now' }
    })).toMatchObject({ nativeSessionId: 'native-claude-1' });
  });
});
