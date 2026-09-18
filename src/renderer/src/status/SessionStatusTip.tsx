import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

import type { SessionOutcomeKind } from '../../../shared/contracts';
import { useLocalization } from '../localization/useLocalization';

/** How long a tip stays unless you hover it. */
export const SESSION_TIP_DURATION_MS = 6_000;

export interface SessionTip {
  /** Tells one tip from the next, so a new one restarts the clock. */
  id: number;
  sessionKey: string;
  kind: SessionOutcomeKind;
  provider: string;
  title: string;
}

const MESSAGE_KEYS: Readonly<Record<SessionOutcomeKind, string>> = {
  finished: 'shell.session-status.tip-finished',
  failed: 'shell.session-status.tip-failed',
  needs_you: 'shell.session-status.tip-needs-you'
};

/**
 * One line about a session you were not watching, with a way to open it.
 *
 * It never takes focus: whatever you were typing in keeps the keyboard, as
 * everywhere else in Lumora. It goes on its own after a few seconds, waits
 * while the pointer is over it, and a newer tip replaces it.
 */
export function SessionStatusTip({
  onDismiss,
  onOpen,
  tip
}: {
  tip: SessionTip | null;
  onOpen(sessionKey: string): void;
  onDismiss(): void;
}): ReactNode {
  const { t } = useLocalization();
  const timer = useRef<number | null>(null);
  const dismiss = useRef(onDismiss);
  dismiss.current = onDismiss;

  const stopClock = () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
  };
  const startClock = () => {
    stopClock();
    timer.current = window.setTimeout(() => dismiss.current(), SESSION_TIP_DURATION_MS);
  };

  useEffect(() => {
    if (tip === null) return undefined;
    startClock();
    return stopClock;
  }, [tip?.id]);

  if (tip === null) return null;

  return createPortal(
    <div
      aria-label={t('shell.session-status.tips-label')}
      className="session-status-tip"
      data-outcome={tip.kind}
      onPointerEnter={stopClock}
      onPointerLeave={startClock}
      role="status"
    >
      <span aria-hidden="true" className="session-status-dot" data-outcome={tip.kind} />
      <p className="session-status-tip-message">
        {t(MESSAGE_KEYS[tip.kind], { provider: tip.provider, title: tip.title })}
      </p>
      <button
        className="session-status-tip-open"
        data-lumora-command
        onClick={() => onOpen(tip.sessionKey)}
        tabIndex={-1}
        type="button"
      >
        {t('shell.session-status.open')}
      </button>
      <button
        aria-label={t('shell.session-status.dismiss')}
        className="session-status-tip-dismiss"
        data-lumora-command
        onClick={onDismiss}
        tabIndex={-1}
        type="button"
      >
        <svg aria-hidden="true" viewBox="0 0 16 16">
          <path d="M4 4l8 8M12 4l-8 8" />
        </svg>
      </button>
    </div>,
    document.querySelector('.app-shell') ?? document.body
  );
}
