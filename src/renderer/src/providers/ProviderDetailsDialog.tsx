import { createPortal } from 'react-dom';
import type { ReactNode } from 'react';

import type {
  ProviderInstallation,
  ProviderUpdateStatus
} from '../../../shared/contracts';
import { providerDefinition } from '../../../shared/provider-definitions';
import { useLocalization } from '../localization/useLocalization';

/**
 * Everything about one provider that does not belong on its card: where it was
 * found, and the command Lumora starts it with. Keeping this in a dialog is
 * what lets the card stay a single row per provider.
 */
export function ProviderDetailsDialog({
  command,
  installation,
  onClose,
  onCommandChange,
  onOpenGuide,
  onResetCommand,
  onSaveCommand,
  release,
  releaseChecking,
  saving,
  updatesChecked
}: {
  command: string;
  installation: ProviderInstallation;
  release: ProviderUpdateStatus | null;
  releaseChecking: boolean;
  updatesChecked: boolean;
  onClose(): void;
  onCommandChange(command: string): void;
  onOpenGuide(): void;
  onResetCommand(): void;
  onSaveCommand(): void;
  saving: boolean;
}): ReactNode {
  const { t } = useLocalization();
  const definition = providerDefinition(installation.provider);
  const label = { provider: installation.displayName };

  return createPortal(
    <div className="dialog-backdrop" role="presentation">
      <section
        aria-labelledby="provider-details-title"
        aria-modal="true"
        className="new-session-dialog provider-details-dialog"
        role="dialog"
      >
        <header>
          <div>
            <p className="card-label">{installation.displayName}</p>
            <h2 id="provider-details-title">
              {t('providers.settings.details-title')}
            </h2>
          </div>
          <button
            className="text-button"
            data-lumora-command
            onClick={onClose}
            type="button"
          >
            {t('common.actions.close')}
          </button>
        </header>

        <div className="dialog-body">
          <dl className="provider-details">
            <div>
              <dt>{t('providers.settings.version')}</dt>
              <dd>
                {installation.state === 'ready'
                  ? installation.version
                  : t('providers.settings.not-installed')}
              </dd>
            </div>
            <div>
              <dt>{t('providers.settings.detected-command')}</dt>
              <dd>{definition.command}</dd>
            </div>
            <div>
              <dt>{t('providers.settings.executable')}</dt>
              <dd className="provider-path">
                {installation.executablePath ??
                  t('providers.settings.not-installed')}
              </dd>
            </div>
            <div>
              <dt>{t('providers.settings.saved-sessions')}</dt>
              <dd>
                {t(definition.sessionSupport === 'complete'
                  ? 'providers.settings.full-support'
                  : 'providers.settings.launch-only')}
              </dd>
            </div>
          </dl>

          <div className="provider-release" aria-live="polite">
            {!updatesChecked ? (
              <p className="provider-release-status provider-release-idle">
                {t('providers.settings.updates-not-checked')}
              </p>
            ) : releaseChecking ? (
              <p className="provider-release-status provider-release-checking">
                <span className="status-dot" aria-hidden="true" />
                {t('providers.settings.checking-latest')}
              </p>
            ) : release === null || release.state === 'unavailable' ? (
              <div>
                <p className="provider-release-status provider-release-unavailable">
                  {t('providers.settings.latest-unavailable')}
                </p>
                <p className="provider-release-recovery">
                  {release?.issue.recovery ?? t('providers.settings.release-retry')}
                </p>
              </div>
            ) : (
              <p className={`provider-release-status provider-release-${release.state}`}>
                {release.state === 'update_available'
                  ? t('providers.settings.update-version', { version: release.latestVersion })
                  : t('providers.settings.current-version', { version: release.latestVersion })}
              </p>
            )}
          </div>

          {installation.state === 'ready' ? null : (
            <div className="provider-diagnostic">
              <p>{installation.issue.message}</p>
              <p className="provider-recovery">{installation.issue.recovery}</p>
            </div>
          )}

          <div className="provider-command">
            <label>
              <span>{t('providers.settings.start-command-label', label)}</span>
              <input
                aria-label={t('providers.settings.start-command-label', label)}
                disabled={saving}
                maxLength={4096}
                onChange={(event) => onCommandChange(event.currentTarget.value)}
                placeholder={installation.executablePath ?? installation.provider}
                type="text"
                value={command}
              />
            </label>
            <p>{t('providers.settings.start-command-help')}</p>
            <div className="provider-command-actions">
              <button
                aria-label={t('providers.settings.save-command-label', label)}
                className="refresh-button"
                data-lumora-command
                disabled={saving}
                onClick={onSaveCommand}
                type="button"
              >
                {t(saving
                  ? 'providers.settings.saving-command'
                  : 'providers.settings.save-command')}
              </button>
              <button
                aria-label={t('providers.settings.reset-command-label', label)}
                className="text-button"
                data-lumora-command
                disabled={saving || command === ''}
                onClick={onResetCommand}
                type="button"
              >
                {t('providers.settings.use-detected')}
              </button>
            </div>
          </div>
        </div>

        <footer>
          <button
            aria-label={t('providers.settings.open-guide-label', label)}
            className="secondary-button"
            data-lumora-command
            onClick={onOpenGuide}
            type="button"
          >
            {t('providers.settings.installation-guide')}
          </button>
        </footer>
      </section>
    </div>,
    document.body
  );
}
