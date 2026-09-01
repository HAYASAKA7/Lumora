import type { ReactNode } from 'react';

import type { StructuredAgentRuntimeSummary } from '../../../shared/contracts';
import { useLocalization } from '../localization/useLocalization';
import type { StructuredAgentViewState } from './structured-agent-state';

interface StructuredSessionDetailsDialogProps {
  accountLoading: boolean;
  accountRefreshFailed: boolean;
  providerName: string;
  runtime: StructuredAgentRuntimeSummary;
  usage: StructuredAgentViewState['usage'];
  accountUsage: StructuredAgentViewState['accountUsage'];
  onClose(): void;
}

function boundedRemaining(usedPercent: number): number {
  return Math.max(0, Math.min(100, 100 - usedPercent));
}

export function StructuredSessionDetailsDialog({
  accountLoading,
  accountRefreshFailed,
  providerName,
  runtime,
  usage,
  accountUsage,
  onClose
}: StructuredSessionDetailsDialogProps): ReactNode {
  const { t, formatDate, formatNumber, formatTime } = useLocalization();
  const dateTime = (value: string): string => {
    const timestamp = new Date(value).getTime();
    return `${formatDate(timestamp)} · ${formatTime(timestamp)}`;
  };
  const tokenValue = (value: number | null): string => value === null
    ? t('terminal.unified.details.unavailable')
    : formatNumber(value);

  return (
    <div className="dialog-backdrop" role="presentation">
      <section
        aria-labelledby="structured-session-details-title"
        aria-modal="true"
        className="new-session-dialog terminal-details-dialog structured-session-details-dialog"
        role="dialog"
      >
        <header>
          <div>
            <p className="card-label">{t('terminal.unified.details.metadata-label')}</p>
            <h2 id="structured-session-details-title">
              {t('terminal.unified.details.title')}
            </h2>
          </div>
          <button
            aria-label={t('terminal.unified.details.close-label')}
            className="text-button"
            data-lumora-command
            onClick={onClose}
            type="button"
          >
            {t('common.actions.close')}
          </button>
        </header>

        <div className="dialog-body structured-session-details-body">
          <section className="terminal-inspector structured-session-details-section">
            <h3>{t('terminal.unified.details.session-section')}</h3>
            <dl>
              <div><dt>{t('terminal.unified.details.name')}</dt><dd>{runtime.title}</dd></div>
              <div><dt>{t('terminal.unified.details.provider')}</dt><dd>{providerName}</dd></div>
              <div><dt>{t('terminal.unified.details.status')}</dt><dd>{t(`terminal.unified.state-${runtime.state}`)}</dd></div>
              <div><dt>{t('terminal.unified.details.native-session')}</dt><dd>{runtime.nativeSessionId ?? t('terminal.unified.details.unavailable')}</dd></div>
              <div><dt>{t('terminal.unified.details.started')}</dt><dd>{dateTime(runtime.createdAt)}</dd></div>
              <div><dt>{t('terminal.unified.details.updated')}</dt><dd>{dateTime(runtime.updatedAt)}</dd></div>
            </dl>
          </section>

          <section className="terminal-inspector structured-session-details-section">
            <h3>{t('terminal.unified.details.session-usage-section')}</h3>
            {usage === null ? (
              <p className="structured-session-details-empty">
                {t('terminal.unified.details.session-usage-unavailable')}
              </p>
            ) : (
              <dl>
                <div><dt>{t('terminal.unified.details.total-tokens')}</dt><dd>{tokenValue(usage.totalTokens)}</dd></div>
                <div><dt>{t('terminal.unified.details.input-tokens')}</dt><dd>{tokenValue(usage.inputTokens)}</dd></div>
                <div><dt>{t('terminal.unified.details.cached-input-tokens')}</dt><dd>{tokenValue(usage.cachedInputTokens)}</dd></div>
                <div><dt>{t('terminal.unified.details.output-tokens')}</dt><dd>{tokenValue(usage.outputTokens)}</dd></div>
              </dl>
            )}
          </section>

          <section className="terminal-inspector structured-session-details-section">
            <h3>{t('terminal.unified.details.subscription-section')}</h3>
            {accountLoading ? (
              <p className="structured-session-details-empty">
                {t('terminal.unified.details.subscription-loading')}
              </p>
            ) : accountUsage === null || accountUsage.windows.length === 0 ? (
              <p className="structured-session-details-empty">
                {t(accountRefreshFailed
                  ? 'terminal.unified.details.subscription-refresh-failed'
                  : 'terminal.unified.details.subscription-unavailable')}
              </p>
            ) : (
              <dl>
                {accountUsage.plan === null ? null : (
                  <div><dt>{t('terminal.unified.details.plan')}</dt><dd>{accountUsage.plan}</dd></div>
                )}
                {accountUsage.windows.map((window) => (
                  <div key={window.kind}>
                    <dt>{t(`terminal.unified.details.${window.kind}-limit`)}</dt>
                    <dd>
                      {t('terminal.unified.details.remaining', {
                        remaining: formatNumber(boundedRemaining(window.usedPercent), {
                          maximumFractionDigits: 1
                        })
                      })}
                    </dd>
                  </div>
                ))}
              </dl>
            )}
          </section>
        </div>
      </section>
    </div>
  );
}
