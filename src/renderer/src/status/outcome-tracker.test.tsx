import { describe, expect, it } from 'vitest';

import {
  createOutcomeTracker,
  trackOutcomes,
  type OutcomeTracker
} from './outcome-tracker';
import type { SessionOutcome } from './session-outcome';

const finished = (key: string): SessionOutcome => ({ kind: 'finished', key });
const needsYou = (key: string): SessionOutcome => ({ kind: 'needs_you', key });

function run(
  tracker: OutcomeTracker,
  sessions: Record<string, SessionOutcome | null>,
  watched: string | null = null
) {
  return trackOutcomes(tracker, new Map(Object.entries(sessions)), watched);
}

describe('trackOutcomes', () => {
  it('takes what a session already shows when it first appears as seen', () => {
    // A resumed session arrives with its history, which ended in a finished turn.
    const { tracker, cues } = run(createOutcomeTracker(), { a: finished('old') });

    expect(cues).toEqual([]);
    expect(tracker.unseen.size).toBe(0);
  });

  it('cues a new outcome for a session you are not watching, once', () => {
    const first = run(createOutcomeTracker(), { a: null, b: null }, 'b');
    const second = run(first.tracker, { a: finished('e1'), b: null }, 'b');

    expect(second.cues).toEqual([{ sessionKey: 'a', kind: 'finished', key: 'e1' }]);
    expect(second.tracker.unseen.get('a')).toBe('finished');

    const again = run(second.tracker, { a: finished('e1'), b: null }, 'b');
    expect(again.cues).toEqual([]);
    expect(again.tracker).toBe(second.tracker);
  });

  it('gives no cue for the session you are watching', () => {
    const first = run(createOutcomeTracker(), { a: null }, 'a');
    const second = run(first.tracker, { a: finished('e1') }, 'a');

    expect(second.cues).toEqual([]);
    expect(second.tracker.unseen.size).toBe(0);
  });

  it('lets a newer outcome replace the one not yet seen', () => {
    const first = run(createOutcomeTracker(), { a: null });
    const second = run(first.tracker, { a: needsYou('e1') });
    const third = run(second.tracker, { a: null });
    const fourth = run(third.tracker, { a: finished('e2') });

    expect(third.tracker.unseen.get('a')).toBe('needs_you');
    expect(fourth.cues).toEqual([{ sessionKey: 'a', kind: 'finished', key: 'e2' }]);
    expect(fourth.tracker.unseen.get('a')).toBe('finished');
  });

  it('clears the dot once you watch the session', () => {
    const first = run(createOutcomeTracker(), { a: null });
    const second = run(first.tracker, { a: finished('e1') });
    const watching = run(second.tracker, { a: finished('e1') }, 'a');

    expect(watching.cues).toEqual([]);
    expect(watching.tracker.unseen.size).toBe(0);
  });

  it('forgets a session that closed', () => {
    const first = run(createOutcomeTracker(), { a: null });
    const second = run(first.tracker, { a: finished('e1') });
    const closed = run(second.tracker, {});

    expect(closed.tracker.unseen.size).toBe(0);
    expect(closed.tracker.lastKeys.size).toBe(0);
  });
});
