import type { SessionOutcomeKind } from '../../../shared/contracts';
import type { SessionOutcome } from './session-outcome';

export interface OutcomeTracker {
  /** The outcome each session was last read with, so the same one is not news twice. */
  readonly lastKeys: ReadonlyMap<string, string | null>;
  /** Outcomes that arrived while their session was not watched: the dots. */
  readonly unseen: ReadonlyMap<string, SessionOutcomeKind>;
}

/** A new outcome for a session nobody was watching: the tip and the sound. */
export interface SessionCue {
  sessionKey: string;
  kind: SessionOutcomeKind;
  key: string;
}

export function createOutcomeTracker(): OutcomeTracker {
  return { lastKeys: new Map(), unseen: new Map() };
}

/**
 * Compares each session's outcome with the last one read.
 *
 * A session read for the first time is taken as seen, whatever it shows: a
 * resumed session arrives with its history and that is not news. After that, a
 * new outcome is news unless its session is the one being watched. Watching a
 * session clears its dot, and a newer outcome replaces an older one, so a
 * session carries one dot at most. The tracker comes back unchanged when
 * nothing changed, so a caller can skip the work.
 */
export function trackOutcomes(
  tracker: OutcomeTracker,
  sessions: ReadonlyMap<string, SessionOutcome | null>,
  watchedKey: string | null
): { tracker: OutcomeTracker; cues: SessionCue[] } {
  const lastKeys = new Map(tracker.lastKeys);
  const unseen = new Map(tracker.unseen);
  const cues: SessionCue[] = [];
  let changed = false;

  for (const [sessionKey, outcome] of sessions) {
    const outcomeKey = outcome?.key ?? null;
    if (!lastKeys.has(sessionKey)) {
      lastKeys.set(sessionKey, outcomeKey);
      changed = true;
      continue;
    }
    if (lastKeys.get(sessionKey) === outcomeKey) continue;
    lastKeys.set(sessionKey, outcomeKey);
    changed = true;
    if (outcome === null || sessionKey === watchedKey) continue;
    unseen.set(sessionKey, outcome.kind);
    cues.push({ sessionKey, kind: outcome.kind, key: outcome.key });
  }

  for (const sessionKey of tracker.lastKeys.keys()) {
    if (sessions.has(sessionKey)) continue;
    lastKeys.delete(sessionKey);
    unseen.delete(sessionKey);
    changed = true;
  }

  if (watchedKey !== null && unseen.delete(watchedKey)) changed = true;

  return changed ? { tracker: { lastKeys, unseen }, cues } : { tracker, cues };
}
