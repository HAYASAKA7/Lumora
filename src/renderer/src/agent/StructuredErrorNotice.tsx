import type { ReactNode } from 'react';

import type {
  StructuredAgentErrorKind,
  StructuredAgentEvent
} from '../../../shared/contracts';
import { useLocalization } from '../localization/useLocalization';

type StructuredAgentError = Extract<StructuredAgentEvent, { kind: 'runtime.error' }>['payload'];

const HEADLINE_KEYS: Readonly<Record<StructuredAgentErrorKind, string>> = {
  usage_limit: 'terminal.unified.error-usage-limit',
  rate_limit: 'terminal.unified.error-rate-limit',
  context_full: 'terminal.unified.error-context-full',
  overloaded: 'terminal.unified.error-overloaded',
  connection: 'terminal.unified.error-connection',
  sign_in: 'terminal.unified.error-sign-in',
  account: 'terminal.unified.error-account',
  rejected: 'terminal.unified.error-rejected',
  other: 'terminal.unified.error-other'
};

/**
 * What went wrong with the agent, said in the user's language: the kind of
 * failure first, the provider's own words beneath it, then whether it is being
 * retried and when a spent limit lifts. An error from before kinds existed is
 * shown as its message, as it always was.
 */
export function StructuredErrorNotice({
  error,
  providerName
}: {
  error: StructuredAgentError | null;
  providerName: string;
}): ReactNode {
  const { t, formatDate, formatTime } = useLocalization();
  if (error === null) {
    return <p className="structured-error-headline">{t('terminal.unified.action-failed')}</p>;
  }
  const headline = error.errorKind === undefined
    ? error.message
    : t(HEADLINE_KEYS[error.errorKind], { provider: providerName });
  const words = error.errorKind === undefined ? null : error.providerMessage ?? null;
  const resetsAt = error.resetsAt ?? null;
  return (
    <>
      <p className="structured-error-headline">{headline}</p>
      {words === null ? null : <p className="structured-error-detail">{words}</p>}
      {error.attempt === null || error.attempt === undefined ? null : (
        <p className="structured-error-detail">
          {t('terminal.unified.error-retrying', {
            current: error.attempt.current,
            max: error.attempt.max
          })}
        </p>
      )}
      {resetsAt === null ? null : (
        <p className="structured-error-detail">
          {t('terminal.unified.error-resets-at', {
            time: `${formatDate(resetsAt * 1_000)} · ${formatTime(resetsAt * 1_000)}`
          })}
        </p>
      )}
    </>
  );
}
