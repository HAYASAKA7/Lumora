import { useCallback, useEffect, useRef, useState } from 'react';

import type { SessionOutcomeKind, SessionStatusSettings } from '../../../shared/contracts';
import { playSessionChime } from './chime';
import { createOutcomeTracker, trackOutcomes } from './outcome-tracker';
import type { SessionOutcome } from './session-outcome';
import type { SessionTip } from './SessionStatusTip';

const NO_DOTS: ReadonlyMap<string, SessionOutcomeKind> = new Map();

export interface SessionDescription {
  provider: string;
  title: string;
}

interface SessionStatusCuesOptions {
  /** Each open session's outcome right now, by session key; null while it works. */
  outcomes: ReadonlyMap<string, SessionOutcome | null>;
  /** The session in front of a focused window, or null. */
  watchedKey: string | null;
  settings: SessionStatusSettings;
  describe(sessionKey: string): SessionDescription | null;
}

/**
 * Turns outcomes into cues: a dot for each session with an outcome you have
 * not seen, and a tip and a chime when one arrives. Each cue follows its own
 * setting; the dots are still tracked while hidden, so turning them back on
 * shows what is waiting.
 */
export function useSessionStatusCues({
  describe,
  outcomes,
  settings,
  watchedKey
}: SessionStatusCuesOptions): {
  dots: ReadonlyMap<string, SessionOutcomeKind>;
  tip: SessionTip | null;
  dismissTip(): void;
} {
  const tracker = useRef(createOutcomeTracker());
  const [unseen, setUnseen] = useState(tracker.current.unseen);
  const [tip, setTip] = useState<SessionTip | null>(null);
  const tipSequence = useRef(0);
  const latest = useRef({ describe, settings });
  latest.current = { describe, settings };

  useEffect(() => {
    const result = trackOutcomes(tracker.current, outcomes, watchedKey);
    if (result.tracker === tracker.current) return;
    tracker.current = result.tracker;
    setUnseen(result.tracker.unseen);
    // Several at once make one tip: the newest says the most.
    const cue = result.cues.at(-1);
    if (cue === undefined) return;
    const { describe: describeSession, settings: current } = latest.current;
    const described = current.tip ? describeSession(cue.sessionKey) : null;
    if (described !== null) {
      tipSequence.current += 1;
      setTip({
        id: tipSequence.current,
        sessionKey: cue.sessionKey,
        kind: cue.kind,
        provider: described.provider,
        title: described.title
      });
    }
    if (current.sound) playSessionChime();
  }, [outcomes, watchedKey]);

  // A tip about the session you have just opened has nothing left to say.
  useEffect(() => {
    if (tip !== null && tip.sessionKey === watchedKey) setTip(null);
  }, [tip, watchedKey]);

  const dismissTip = useCallback(() => setTip(null), []);

  return {
    dots: settings.dot ? unseen : NO_DOTS,
    tip: settings.tip ? tip : null,
    dismissTip
  };
}
