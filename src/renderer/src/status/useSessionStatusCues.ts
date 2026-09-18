import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { SessionStatusSettings } from '../../../shared/contracts';
import { playSessionChime } from './chime';
import { createOutcomeTracker, trackOutcomes } from './outcome-tracker';
import {
  sessionIndicator,
  type SessionIndicator,
  type SessionOutcome
} from './session-outcome';
import type { SessionTip } from './SessionStatusTip';

const NO_INDICATORS: ReadonlyMap<string, SessionIndicator> = new Map();

export interface SessionDescription {
  provider: string;
  title: string;
}

interface SessionStatusCuesOptions {
  /** Each open session's outcome right now, by session key; null while it works. */
  outcomes: ReadonlyMap<string, SessionOutcome | null>;
  /** The sessions whose agent is at work, as far as their agent says. */
  working: ReadonlySet<string>;
  /** The session in front of a focused window, or null. */
  watchedKey: string | null;
  settings: SessionStatusSettings;
  describe(sessionKey: string): SessionDescription | null;
}

/**
 * Turns outcomes into cues: the status slot on each session's tile and tab,
 * and a tip and a chime when an outcome arrives for a session you are not
 * watching. The slot shows a spinner while the agent works and a dot for an
 * outcome you have not seen. Each cue follows its own setting; outcomes are
 * still tracked while the slot is hidden, so turning it back on shows what is
 * waiting.
 */
export function useSessionStatusCues({
  describe,
  outcomes,
  settings,
  watchedKey,
  working
}: SessionStatusCuesOptions): {
  indicators: ReadonlyMap<string, SessionIndicator>;
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

  const indicators = useMemo(() => {
    if (!settings.dot) return NO_INDICATORS;
    const shown = new Map<string, SessionIndicator>();
    for (const sessionKey of new Set([...unseen.keys(), ...working])) {
      const indicator = sessionIndicator(unseen.get(sessionKey), working.has(sessionKey));
      if (indicator !== undefined) shown.set(sessionKey, indicator);
    }
    return shown;
  }, [settings.dot, unseen, working]);

  return {
    indicators,
    tip: settings.tip ? tip : null,
    dismissTip
  };
}
