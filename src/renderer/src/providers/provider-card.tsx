import { useState, type ReactNode } from 'react';

import type {
  ProviderInstallation,
  ProviderUpdateStatus
} from '../../../shared/contracts';
import {
  providerDefinition,
  supportsManagedProviderUpdate
} from '../../../shared/provider-definitions';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { useLocalization } from '../localization/useLocalization';
import { ProviderDetailsDialog } from './ProviderDetailsDialog';

const PROVIDER_STATE_LABELS: Record<ProviderInstallation['state'], string> = {
  ready: 'providers.states.detected',
  not_found: 'providers.states.not-found',
  probe_failed: 'providers.states.probe-failed'
};

/**
 * One row per provider: what it is, which version is installed, and the three
 * things worth doing to it. Everything else lives behind Details, so adding a
 * provider costs one row rather than one panel.
 */
export function ProviderCard({
  command,
  enabled,
  enableLocked,
  installation,
  release,
  releaseChecking,
  updatesChecked,
  onCancelUpdate,
  onCommandChange,
  onEnabledChange,
  onInstall,
  onOpenGuide,
  onResetCommand,
  onSaveCommand,
  onUpdate,
  installing,
  installError,
  saving,
  updateError,
  updating
}: {
  command: string;
  enabled: boolean;
  enableLocked: boolean;
  installation: ProviderInstallation;
  release: ProviderUpdateStatus | null;
  releaseChecking: boolean;
  updatesChecked: boolean;
  onCancelUpdate(): void;
  onCommandChange(command: string): void;
  onEnabledChange(enabled: boolean): void;
  onInstall(): void;
  onOpenGuide(): void;
  onResetCommand(): void;
  onSaveCommand(): void;
  onUpdate(): void;
  installing: boolean;
  installError: string | null;
  saving: boolean;
  updateError: string | null;
  updating: boolean;
}): ReactNode {
  const { t } = useLocalization();
  const [confirmingInstall, setConfirmingInstall] = useState(false);
  const [confirmingUpdate, setConfirmingUpdate] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const definition = providerDefinition(installation.provider);
  const label = { provider: installation.displayName };
  const ready = installation.state === 'ready';
  const available = ready && release !== null &&
    release.state === 'update_available'
    ? release
    : null;

  return (
    <article className={`provider-card provider-card-${installation.state}`}>
      <header className="provider-card-header">
        <div>
          <h4>{installation.displayName}</h4>
          <p className="provider-session-capability">
            {t('providers.settings.saved-sessions')}{' '}
            {t(definition.sessionSupport === 'complete'
              ? 'providers.settings.full-support'
              : 'providers.settings.launch-only')}
          </p>
        </div>
        <span
          className={`provider-card-version provider-state-${installation.state}`}
        >
          {ready
            ? installation.version
            : t(PROVIDER_STATE_LABELS[installation.state])}
        </span>
      </header>

      {/* Details is the one action every provider always has, so it leads and
          the situational buttons follow it. */}
      <div className="provider-card-actions">
        <button
          aria-label={t('providers.settings.details-label', label)}
          className="secondary-button"
          data-lumora-command
          onClick={() => setDetailsOpen(true)}
          type="button"
        >
          {t('providers.settings.details')}
        </button>

        {available !== null ? (
          <button
            aria-label={updating
              ? t('providers.settings.updating-label', label)
              : t('providers.settings.update-label', label)}
            className="refresh-button"
            data-lumora-command
            disabled={updating}
            onClick={() => {
              if (supportsManagedProviderUpdate(installation.provider)) {
                setConfirmingUpdate(true);
                return;
              }
              onOpenGuide();
            }}
            type="button"
          >
            {t(updating
              ? 'providers.states.updating'
              : 'providers.settings.update-available')}
          </button>
        ) : ready ? null : definition.npmPackage === null ? (
          <button
            aria-label={t('providers.settings.open-guide-label', label)}
            className="secondary-button"
            data-lumora-command
            onClick={onOpenGuide}
            type="button"
          >
            {t('providers.settings.installation-guide')}
          </button>
        ) : (
          <button
            aria-label={t('providers.settings.install-label', label)}
            className="refresh-button"
            data-lumora-command
            disabled={installing}
            onClick={() => setConfirmingInstall(true)}
            type="button"
          >
            {t(installing
              ? 'providers.states.installing'
              : 'common.actions.install')}
          </button>
        )}

        {!updating ? null : (
          <button
            aria-label={t('providers.settings.cancel-update-label', label)}
            className="text-button"
            data-lumora-command
            onClick={onCancelUpdate}
            type="button"
          >
            {t('providers.settings.cancel-update')}
          </button>
        )}

        <label className="settings-switch provider-card-switch">
          <input
            aria-label={t('providers.settings.use-provider', label)}
            checked={enabled}
            disabled={enableLocked}
            onChange={(event) => onEnabledChange(event.currentTarget.checked)}
            type="checkbox"
          />
          <span aria-hidden="true" className="settings-switch-track">
            <span className="settings-switch-thumb" />
          </span>
        </label>
      </div>

      {!releaseChecking ? null : (
        <p className="provider-release-status provider-release-checking">
          <span className="status-dot" aria-hidden="true" />
          {t('providers.settings.checking-latest')}
        </p>
      )}
      {installError === null ? null : (
        <p className="provider-update-error" role="alert">{installError}</p>
      )}
      {updateError === null ? null : (
        <p className="provider-update-error" role="alert">{updateError}</p>
      )}

      {!detailsOpen ? null : (
        <ProviderDetailsDialog
          command={command}
          installation={installation}
          onClose={() => setDetailsOpen(false)}
          onCommandChange={onCommandChange}
          onOpenGuide={onOpenGuide}
          onResetCommand={onResetCommand}
          onSaveCommand={onSaveCommand}
          release={release}
          releaseChecking={releaseChecking}
          saving={saving}
          updatesChecked={updatesChecked}
        />
      )}

      {!confirmingInstall ? null : (
        <ConfirmDialog
          confirmDisabled={installing}
          confirmLabel={t(installing
            ? 'providers.states.installing'
            : 'providers.settings.confirm-install')}
          description={t('providers.settings.install-confirm', label)}
          heading={t('providers.settings.confirm-install-label', label)}
          onCancel={() => setConfirmingInstall(false)}
          onConfirm={() => {
            setConfirmingInstall(false);
            onInstall();
          }}
        />
      )}
      {!confirmingUpdate || available === null ? null : (
        <ConfirmDialog
          confirmDisabled={updating}
          confirmLabel={t('providers.settings.confirm-update')}
          description={t('providers.settings.update-warning', {
            ...label,
            version: available.latestVersion
          })}
          heading={t('providers.settings.confirm-update-label', label)}
          onCancel={() => setConfirmingUpdate(false)}
          onConfirm={() => {
            setConfirmingUpdate(false);
            onUpdate();
          }}
        />
      )}
    </article>
  );
}
