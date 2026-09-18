import type { ReactNode } from 'react';

import { useLocalization } from '../localization/useLocalization';
import type { SessionIndicator } from './session-outcome';

const LABEL_KEYS: Readonly<Record<SessionIndicator, string>> = {
  working: 'shell.session-status.working',
  finished: 'shell.session-status.finished',
  failed: 'shell.session-status.failed',
  needs_you: 'shell.session-status.needs-you'
};

/**
 * The status slot on a session's tile and tab: a spinner while its agent
 * works, or a dot for an outcome waiting to be seen. Its colours come from the
 * theme and never from here, and the status is also part of the tile's
 * accessible name, so colour and motion are not the only signal.
 */
export function SessionStatusDot({
  status
}: {
  status: SessionIndicator | undefined;
}): ReactNode {
  const { t } = useLocalization();
  if (status === undefined) return null;
  return (
    <span className="session-status-dot" data-status={status}>
      <span className="session-status-dot-label">{t(LABEL_KEYS[status])}</span>
    </span>
  );
}
