import type { ReactNode } from 'react';

import { providerDefinition } from '../../../shared/provider-definitions';
import { useLocalization } from '../localization/useLocalization';
import type { DirectSessionLaunchState } from './useDirectSessionLaunch';

interface DirectSessionLaunchWorkspaceProps {
  launch: DirectSessionLaunchState;
  onClose(): void;
  onOpenOptions(): void;
  onRetry(): void;
  onTrustAndContinue(): void;
}

export function DirectSessionLaunchWorkspace({
  launch,
  onClose,
  onOpenOptions,
  onRetry,
  onTrustAndContinue
}: DirectSessionLaunchWorkspaceProps): ReactNode {
  const { t } = useLocalization();
  const providerName = providerDefinition(launch.session.provider).displayName;
  const waiting = launch.phase !== 'error' && launch.phase !== 'awaiting-trust';

  return (
    <section
      aria-label={t('terminal.direct.workspace-label', {
        session: launch.session.title
      })}
      className="terminal-workspace structured-agent-workspace direct-session-launch-workspace"
    >
      <header className="terminal-header structured-agent-header">
        <div>
          <p className="card-label">
            {t('terminal.direct.provider-context', { provider: providerName })}
          </p>
          <h2>{launch.session.title}</h2>
        </div>
        <button
          className="secondary-button"
          data-lumora-command
          onClick={onClose}
          tabIndex={-1}
          type="button"
        >
          {t('common.actions.close')}
        </button>
      </header>

      <div className="structured-agent-body direct-session-launch-body">
        <div className="structured-conversation">
          <article className="structured-turn">
            <section
              aria-live="polite"
              className="structured-message structured-message-assistant direct-session-launch-state"
              role={launch.phase === 'error' ? 'alert' : 'status'}
            >
              <div className="structured-assistant-title">
                <strong>{providerName}</strong>
                <span
                  className={`runtime-state runtime-${
                    launch.phase === 'error' ? 'failed' : 'launching'
                  }`}
                >
                  {t(`terminal.direct.${launch.phase}-title`, {
                    provider: providerName,
                    workspace: launch.workspace.displayName
                  })}
                </span>
              </div>
              <div className="direct-session-launch-copy">
                {waiting ? (
                  <span aria-hidden="true" className="direct-session-launch-spinner" />
                ) : null}
                <p>{t(`terminal.direct.${launch.phase}-description`, {
                  provider: providerName,
                  workspace: launch.workspace.displayName
                })}</p>
              </div>

              {launch.phase === 'awaiting-trust' ? (
                <div className="direct-session-launch-actions">
                  <button
                    className="secondary-button"
                    data-lumora-command
                    onClick={onOpenOptions}
                    tabIndex={-1}
                    type="button"
                  >
                    {t('terminal.direct.resume-options')}
                  </button>
                  <button
                    className="primary-button"
                    data-lumora-command
                    onClick={onTrustAndContinue}
                    tabIndex={-1}
                    type="button"
                  >
                    {t('terminal.trust.trust-and-continue')}
                  </button>
                </div>
              ) : launch.phase === 'error' ? (
                <div className="direct-session-launch-actions">
                  <button
                    className="secondary-button"
                    data-lumora-command
                    onClick={onOpenOptions}
                    tabIndex={-1}
                    type="button"
                  >
                    {t('terminal.direct.resume-options')}
                  </button>
                  <button
                    className="primary-button"
                    data-lumora-command
                    onClick={onRetry}
                    tabIndex={-1}
                    type="button"
                  >
                    {t('errors.general.retry')}
                  </button>
                </div>
              ) : null}
            </section>
          </article>
        </div>
      </div>
    </section>
  );
}
