import type { ReactNode } from 'react';

import type { SessionOutcomeKind } from '../../../shared/contracts';
import { useLocalization } from '../localization/useLocalization';

const LABEL_KEYS: Readonly<Record<SessionOutcomeKind, string>> = {
  finished: 'shell.session-status.finished',
  failed: 'shell.session-status.failed',
  needs_you: 'shell.session-status.needs-you'
};

/**
 * The mark a session carries while an outcome waits for you to see it. Its
 * colour comes from the theme and never from here, and the outcome is also
 * part of the tile's accessible name, so colour is not the only signal.
 */
export function SessionStatusDot({
  kind
}: {
  kind: SessionOutcomeKind | undefined;
}): ReactNode {
  const { t } = useLocalization();
  if (kind === undefined) return null;
  return (
    <span className="session-status-dot" data-outcome={kind}>
      <span className="session-status-dot-label">{t(LABEL_KEYS[kind])}</span>
    </span>
  );
}
