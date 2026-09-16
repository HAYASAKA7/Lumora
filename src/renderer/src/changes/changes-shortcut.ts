import { useEffect, useRef } from 'react';

/**
 * The keyboard shortcut asks for the changes panel without knowing which one:
 * the session or workspace page in front answers, since each keeps its own.
 */
export const TOGGLE_CHANGES_EVENT = 'lumora:changes:toggle';

export function requestToggleChanges(host: EventTarget = window): void {
  host.dispatchEvent(new Event(TOGGLE_CHANGES_EVENT));
}

/** Answers the toggle request while this host is the one in front. */
export function useToggleChangesRequest(active: boolean, toggle: () => void): void {
  const latest = useRef(toggle);
  useEffect(() => {
    latest.current = toggle;
  });

  useEffect(() => {
    if (!active) return undefined;
    const answer = () => latest.current();
    window.addEventListener(TOGGLE_CHANGES_EVENT, answer);
    return () => window.removeEventListener(TOGGLE_CHANGES_EVENT, answer);
  }, [active]);
}
