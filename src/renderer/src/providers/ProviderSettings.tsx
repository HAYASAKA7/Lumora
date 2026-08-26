import { useEffect, useState, type ReactNode } from 'react';

import type {
  GeneralSettings,
  LumoraApi,
  ProviderId,
  ProviderInstallation,
  ProviderLaunchConfig,
  ProviderScanResult,
  ProviderUpdateStatus,
  StructuredProviderCapabilityReport,
  StructuredProviderPreference
} from '../../../shared/contracts';
import { DEFAULT_GENERAL_SETTINGS } from '../../../shared/contracts';
import {
  PROVIDER_DEFINITIONS,
  providerDefinition,
  supportsManagedProviderUpdate
} from '../../../shared/provider-definitions';
import type { ProviderUpdatesStatus } from './useProviderUpdates';
import { useLocalization } from '../localization/useLocalization';

export type ProviderScanStatus =
  | { state: 'loading' }
  | { state: 'ready'; scan: ProviderScanResult }
  | { state: 'error' };

export type ProviderSettingsApi = Pick<
  LumoraApi,
  'getProviderLaunchConfigs' |
  'saveProviderLaunchConfig' |
  'installProvider' |
  'openProviderInstallGuide' |
  'updateProvider'
> & Partial<Pick<
  LumoraApi,
  'scanStructuredProviderCapabilities' |
  'getStructuredProviderPreferences' |
  'saveStructuredProviderPreference'
>>;

const STRUCTURED_INTEGRATION_LABELS = {
  codex_app_server: 'Codex app-server',
  claude_agent_sdk: 'Claude Agent SDK',
  gemini_acp: 'Gemini ACP'
} as const;

const STRUCTURED_FALLBACK_LABELS = {
  unavailable: 'providers.settings.unified-unavailable',
  incompatible: 'providers.settings.unified-incompatible',
  failed: 'providers.settings.unified-failed',
  timed_out: 'providers.settings.unified-timed-out'
} as const;

const PROVIDER_STATE_LABELS: Record<ProviderInstallation['state'], string> = {
  ready: 'providers.states.detected',
  not_found: 'providers.states.not-found',
  probe_failed: 'providers.states.probe-failed'
};

function ScanIcon(): ReactNode {
  return (
    <svg
      aria-hidden="true"
      className="icon"
      fill="none"
      viewBox="0 0 20 20"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.55"
    >
      <path d="M3 7V4a1 1 0 0 1 1-1h3m6 0h3a1 1 0 0 1 1 1v3m0 6v3a1 1 0 0 1-1 1h-3m-6 0H4a1 1 0 0 1-1-1v-3M6 10h8" />
    </svg>
  );
}

function ProviderCard({
  command,
  installation,
  release,
  releaseChecking,
  updatesChecked,
  onCommandChange,
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
  installation: ProviderInstallation;
  release: ProviderUpdateStatus | null;
  releaseChecking: boolean;
  updatesChecked: boolean;
  onCommandChange(command: string): void;
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
  const definition = providerDefinition(installation.provider);
  return (
    <article className={`provider-card provider-card-${installation.state}`}>
      <header className="provider-card-header">
        <div>
          <p className="card-label">{t('providers.settings.native-cli')}</p>
          <h4>{installation.displayName}</h4>
        </div>
        <span className={`provider-state provider-state-${installation.state}`}>
          <span aria-hidden="true" />
          {t(PROVIDER_STATE_LABELS[installation.state])}
        </span>
      </header>
      <p className="provider-session-capability">
        {t('providers.settings.saved-sessions')}{' '}
        {definition.sessionSupport === 'complete'
          ? t('providers.settings.full-support')
          : t('providers.settings.launch-only')}
      </p>

      {installation.state === 'ready' ? (
        <dl className="provider-details">
          <div>
            <dt>{t('providers.settings.version')}</dt>
            <dd>{installation.version}</dd>
          </div>
          <div>
            <dt>{t('providers.settings.executable')}</dt>
            <dd className="provider-path">{installation.executablePath}</dd>
          </div>
        </dl>
      ) : (
        <div className="provider-diagnostic">
          <p>{installation.issue.message}</p>
          <p className="provider-recovery">{installation.issue.recovery}</p>
          {installation.executablePath === null ? null : (
            <p className="provider-path">{installation.executablePath}</p>
          )}
        </div>
      )}

      {installation.state === 'ready' ? null : (
        <div className="provider-install-actions">
          {definition.npmPackage === null ? (
            <button
              aria-label={t('providers.settings.open-guide-label', { provider: installation.displayName })}
              className="secondary-button"
              disabled={installing}
              onClick={onOpenGuide}
              type="button"
            >
              {t('providers.settings.installation-guide')}
            </button>
          ) : confirmingInstall ? (
            <div className="provider-install-confirmation">
              <p>
                {t('providers.settings.install-confirm', { provider: installation.displayName })}
              </p>
              <div>
                <button
                  aria-label={t('providers.settings.confirm-install-label', { provider: installation.displayName })}
                  className="refresh-button"
                  disabled={installing}
                  onClick={() => {
                    setConfirmingInstall(false);
                    onInstall();
                  }}
                  type="button"
                >
                  {t(installing ? 'providers.states.installing' : 'providers.settings.confirm-install')}
                </button>
                <button
                  className="text-button"
                  disabled={installing}
                  onClick={() => setConfirmingInstall(false)}
                  type="button"
                >
                  {t('common.actions.cancel')}
                </button>
              </div>
            </div>
          ) : (
            <button
              aria-label={t('providers.settings.install-label', { provider: installation.displayName })}
              className="secondary-button"
              disabled={installing}
              onClick={() => setConfirmingInstall(true)}
              type="button"
            >
              {t(installing ? 'providers.states.installing' : 'common.actions.install')}
            </button>
          )}
          {installError === null ? null : (
            <p className="provider-update-error" role="alert">
              {installError}
            </p>
          )}
        </div>
      )}

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
          <div className="provider-release-ready">
            <p
              className={`provider-release-status provider-release-${release.state}`}
            >
              {release.state === 'update_available'
                ? t('providers.settings.update-version', { version: release.latestVersion })
                : t('providers.settings.current-version', { version: release.latestVersion })}
            </p>
            {release.state === 'update_available' &&
            !supportsManagedProviderUpdate(installation.provider) ? (
              <button
                aria-label={t('providers.settings.open-update-guide', { provider: installation.displayName })}
                className="secondary-button provider-update-button"
                onClick={onOpenGuide}
                type="button"
              >
                {t('providers.settings.official-update-guide')}
              </button>
            ) : release.state === 'update_available' && confirmingUpdate ? (
              <div className="provider-install-confirmation">
                <p>
                  {t('providers.settings.update-warning', { provider: installation.displayName })}
                </p>
                <div>
                  <button
                    aria-label={t('providers.settings.confirm-update-label', { provider: installation.displayName })}
                    className="refresh-button"
                    disabled={updating}
                    onClick={() => {
                      setConfirmingUpdate(false);
                      onUpdate();
                    }}
                    type="button"
                  >
                    {t('providers.settings.confirm-update')}
                  </button>
                  <button
                    className="text-button"
                    disabled={updating}
                    onClick={() => setConfirmingUpdate(false)}
                    type="button"
                  >
                    {t('common.actions.cancel')}
                  </button>
                </div>
              </div>
            ) : release.state === 'update_available' ? (
              <button
                aria-label={
                  updating
                    ? t('providers.settings.updating-label', { provider: installation.displayName })
                    : t('providers.settings.update-label', { provider: installation.displayName, version: release.latestVersion })
                }
                className="secondary-button provider-update-button"
                disabled={updating}
                onClick={() => setConfirmingUpdate(true)}
                type="button"
              >
                {updating ? t('providers.states.updating') : t('providers.settings.update-to', { version: release.latestVersion })}
              </button>
            ) : null}
          </div>
        )}
        {updateError === null ? null : (
          <p className="provider-update-error" role="alert">{updateError}</p>
        )}
      </div>

      <div className="provider-command">
        <label>
          <span>{t('providers.settings.start-command-label', { provider: installation.displayName })}</span>
          <input
            aria-label={t('providers.settings.start-command-label', { provider: installation.displayName })}
            disabled={saving}
            maxLength={4096}
            onChange={(event) => onCommandChange(event.currentTarget.value)}
            placeholder={installation.executablePath ?? installation.provider}
            type="text"
            value={command}
          />
        </label>
        <p>
          {t('providers.settings.start-command-help')}
        </p>
        <div className="provider-command-actions">
          <button
            aria-label={t('providers.settings.save-command-label', { provider: installation.displayName })}
            className="secondary-button"
            disabled={saving}
            onClick={onSaveCommand}
            type="button"
          >
            {t(saving ? 'providers.settings.saving-command' : 'providers.settings.save-command')}
          </button>
          <button
            aria-label={t('providers.settings.reset-command-label', { provider: installation.displayName })}
            className="text-button"
            disabled={saving || command === ''}
            onClick={onResetCommand}
            type="button"
          >
            {t('providers.settings.use-detected')}
          </button>
        </div>
      </div>
    </article>
  );
}

export function ProviderSettings({
  status,
  onRefresh,
  api = window.lumora,
  scope = 'local',
  generalSettings = DEFAULT_GENERAL_SETTINGS,
  generalSettingsSaving = false,
  generalSettingsSaveError = null,
  refreshing = false,
  onSaveEnabledProviders = async () => true,
  updatesStatus,
  updatesRefreshing = false,
  onRefreshUpdates
}: {
  status: ProviderScanStatus;
  onRefresh: () => Promise<unknown> | void;
  api?: ProviderSettingsApi;
  scope?: 'local' | 'remote';
  generalSettings?: GeneralSettings;
  generalSettingsSaving?: boolean;
  generalSettingsSaveError?: string | null;
  refreshing?: boolean;
  onSaveEnabledProviders?: (
    providers: readonly ProviderId[]
  ) => Promise<boolean>;
  updatesStatus: ProviderUpdatesStatus;
  updatesRefreshing?: boolean;
  onRefreshUpdates: () => Promise<void>;
}): ReactNode {
  const { formatDate, formatTime, t } = useLocalization();
  const [enabledProviderDraft, setEnabledProviderDraft] = useState<
    readonly ProviderId[]
  >(generalSettings.enabledProviders);
  const [commands, setCommands] = useState<
    Partial<Record<ProviderId, string>>
  >({});
  const [savingProvider, setSavingProvider] = useState<ProviderId | null>(null);
  const [commandError, setCommandError] = useState<string | null>(null);
  const [updatingProvider, setUpdatingProvider] = useState<ProviderId | null>(
    null
  );
  const [updateErrors, setUpdateErrors] = useState<
    Partial<Record<ProviderId, string>>
  >({});
  const [installingProviders, setInstallingProviders] = useState<
    ReadonlySet<ProviderId>
  >(() => new Set());
  const [installErrors, setInstallErrors] = useState<
    Partial<Record<ProviderId, string>>
  >({});
  const [structuredReports, setStructuredReports] = useState<
    readonly StructuredProviderCapabilityReport[]
  >([]);
  const [structuredPreferences, setStructuredPreferences] = useState<
    readonly StructuredProviderPreference[]
  >([]);
  const [structuredOverrideDrafts, setStructuredOverrideDrafts] = useState<
    Partial<Record<StructuredProviderPreference['providerId'], string>>
  >({});
  const [structuredBusy, setStructuredBusy] = useState(false);
  const [structuredError, setStructuredError] = useState(false);
  useEffect(() => {
    setEnabledProviderDraft(generalSettings.enabledProviders);
  }, [generalSettings.enabledProviders]);

  const applyConfigs = (configs: readonly ProviderLaunchConfig[]) => {
    setCommands((current) => ({
      ...current,
      ...Object.fromEntries(
        configs.map((config) => [config.provider, config.command ?? ''])
      )
    }));
  };

  useEffect(() => {
    let active = true;
    void api.getProviderLaunchConfigs().then(
      (configs) => {
        if (active) applyConfigs(configs);
      },
      () => {
        if (active) setCommandError(t('providers.settings.commands-load-error'));
      }
    );
    return () => { active = false; };
  }, [api]);

  const refreshStructuredProviders = (fresh: boolean) => {
    if (
      scope !== 'local' ||
      api.scanStructuredProviderCapabilities === undefined ||
      api.getStructuredProviderPreferences === undefined
    ) return;
    setStructuredBusy(true);
    setStructuredError(false);
    void Promise.all([
      api.scanStructuredProviderCapabilities(fresh),
      api.getStructuredProviderPreferences()
    ]).then(
      ([reports, preferences]) => {
        setStructuredReports(reports);
        setStructuredPreferences(preferences);
        setStructuredOverrideDrafts(Object.fromEntries(
          preferences.map((preference) => [
            preference.providerId,
            preference.executablePathOverride ?? ''
          ])
        ));
        setStructuredBusy(false);
      },
      () => {
        setStructuredError(true);
        setStructuredBusy(false);
      }
    );
  };

  useEffect(() => {
    refreshStructuredProviders(false);
  }, [api, scope]);

  const saveStructuredPreference = (
    preference: StructuredProviderPreference,
    update: Partial<Pick<
      StructuredProviderPreference,
      'useUnifiedWhenAvailable' | 'executablePathOverride'
    >>
  ) => {
    if (api.saveStructuredProviderPreference === undefined) return;
    setStructuredBusy(true);
    setStructuredError(false);
    void api.saveStructuredProviderPreference({
      ...preference,
      ...update
    }).then(async (preferences) => {
        setStructuredPreferences(preferences);
        setStructuredOverrideDrafts(Object.fromEntries(
          preferences.map((saved) => [
            saved.providerId,
            saved.executablePathOverride ?? ''
          ])
        ));
        if (api.scanStructuredProviderCapabilities !== undefined) {
          setStructuredReports(
            await api.scanStructuredProviderCapabilities(true)
          );
        }
        setStructuredBusy(false);
      }).catch(() => {
        setStructuredError(true);
        setStructuredBusy(false);
      });
  };

  const saveCommand = (provider: ProviderId, command: string | null) => {
    setSavingProvider(provider);
    setCommandError(null);
    void api.saveProviderLaunchConfig({ provider, command }).then(
      (configs) => {
        applyConfigs(configs);
        setSavingProvider(null);
      },
      () => {
        setCommandError(t('providers.settings.command-save-error'));
        setSavingProvider(null);
      }
    );
  };

  const updateProvider = (provider: ProviderId, displayName: string) => {
    setUpdatingProvider(provider);
    setUpdateErrors((current) => ({ ...current, [provider]: undefined }));
    void api.updateProvider(provider).then(
      async () => {
        await onRefresh();
        await onRefreshUpdates();
        setUpdatingProvider(null);
      },
      () => {
        setUpdateErrors((current) => ({
          ...current,
          [provider]: t('providers.settings.update-error', { provider: displayName, command: provider })
        }));
        setUpdatingProvider(null);
      }
    );
  };

  const installProvider = (provider: ProviderId, displayName: string) => {
    setInstallingProviders((current) => new Set(current).add(provider));
    setInstallErrors((current) => ({ ...current, [provider]: undefined }));
    const finish = () => setInstallingProviders((current) => {
      const next = new Set(current);
      next.delete(provider);
      return next;
    });
    void api.installProvider(provider).then(
      async () => {
        await onRefresh();
        await onRefreshUpdates();
        finish();
      },
      () => {
        setInstallErrors((current) => ({
          ...current,
          [provider]: t('providers.settings.install-error', { provider: displayName })
        }));
        finish();
      }
    );
  };

  const openInstallGuide = (provider: ProviderId, displayName: string) => {
    setInstallErrors((current) => ({ ...current, [provider]: undefined }));
    void api.openProviderInstallGuide(provider).catch(() => {
      setInstallErrors((current) => ({
        ...current,
        [provider]: t('providers.settings.guide-error', { provider: displayName })
      }));
    });
  };

  const enabledProviderSelectionChanged =
    enabledProviderDraft.length !== generalSettings.enabledProviders.length ||
    enabledProviderDraft.some(
      (provider, index) => provider !== generalSettings.enabledProviders[index]
    );
  const enabledStructuredPreferences = structuredPreferences.filter(
    ({ providerId }) => generalSettings.enabledProviders.includes(providerId)
  );

  const toggleProvider = (provider: ProviderId, enabled: boolean) => {
    setEnabledProviderDraft((current) =>
      PROVIDER_DEFINITIONS
        .filter(({ provider: candidate }) =>
          candidate === provider
            ? enabled
            : current.includes(candidate)
        )
        .map(({ provider: candidate }) => candidate)
    );
  };

  const renderProviderCard = (installation: ProviderInstallation) => (
    <ProviderCard
      command={commands[installation.provider] ?? ''}
      installError={installErrors[installation.provider] ?? null}
      installation={installation}
      installing={installingProviders.has(installation.provider)}
      key={installation.provider}
      release={
        updatesStatus.state === 'ready'
          ? updatesStatus.check.providers.find(
              (provider) => provider.provider === installation.provider
            ) ?? null
          : null
      }
      releaseChecking={
        updatesStatus.state === 'loading' || updatesRefreshing
      }
      updatesChecked={updatesStatus.state !== 'idle'}
      onCommandChange={(command) => setCommands((current) => ({
        ...current,
        [installation.provider]: command
      }))}
      onInstall={() => installProvider(
        installation.provider,
        installation.displayName
      )}
      onOpenGuide={() => openInstallGuide(
        installation.provider,
        installation.displayName
      )}
      onResetCommand={() => saveCommand(installation.provider, null)}
      onSaveCommand={() => saveCommand(
        installation.provider,
        commands[installation.provider]?.trim() || null
      )}
      onUpdate={() => updateProvider(
        installation.provider,
        installation.displayName
      )}
      saving={savingProvider === installation.provider}
      updateError={updateErrors[installation.provider] ?? null}
      updating={updatingProvider === installation.provider}
    />
  );

  return (
    <section className="provider-panel" aria-labelledby="provider-panel-title">
      <section
        aria-labelledby="enabled-providers-title"
        className="provider-selection-panel"
      >
        <div>
          <p className="card-label">{t('providers.settings.scope-eyebrow')}</p>
          <h2 id="enabled-providers-title">{t('providers.settings.enabled-title')}</h2>
          <p>{t('providers.settings.enabled-description')}</p>
        </div>
        <div className="provider-selection-grid">
          {PROVIDER_DEFINITIONS.map((definition) => {
            const checked = enabledProviderDraft.includes(definition.provider);
            return (
              <label className="provider-selection-option" key={definition.provider}>
                <input
                  aria-label={t('providers.settings.use-provider', { provider: definition.displayName })}
                  checked={checked}
                  disabled={
                    generalSettingsSaving ||
                    (checked && enabledProviderDraft.length === 1)
                  }
                  onChange={(event) =>
                    toggleProvider(
                      definition.provider,
                      event.currentTarget.checked
                    )
                  }
                  type="checkbox"
                />
                <span>{definition.displayName}</span>
              </label>
            );
          })}
        </div>
        <div className="provider-selection-actions">
          <button
            aria-label={t('providers.settings.save-selection-label')}
            className="refresh-button"
            disabled={
              generalSettingsSaving ||
              !enabledProviderSelectionChanged ||
              enabledProviderDraft.length === 0
            }
            onClick={() => {
              void onSaveEnabledProviders(enabledProviderDraft);
            }}
            type="button"
          >
            {t(generalSettingsSaving ? 'providers.settings.saving-selection' : 'providers.settings.save-selection')}
          </button>
          <span>{t('providers.settings.enabled-count', { count: enabledProviderDraft.length })}</span>
        </div>
        {generalSettingsSaveError === null ? null : (
          <p className="general-setting-error" role="alert">
            {generalSettingsSaveError}
          </p>
        )}
      </section>

      {scope !== 'local' || enabledStructuredPreferences.length === 0 ? null : (
        <section
          aria-labelledby="structured-provider-title"
          className="provider-selection-panel structured-provider-panel"
        >
          <div className="structured-provider-heading">
            <div>
              <p className="card-label">
                {t('providers.settings.unified-eyebrow')}
              </p>
              <h2 id="structured-provider-title">
                {t('providers.settings.unified-title')}
              </h2>
              <p>{t('providers.settings.unified-description')}</p>
            </div>
            <button
              className="secondary-button"
              disabled={structuredBusy}
              onClick={() => refreshStructuredProviders(true)}
              type="button"
            >
              {t(structuredBusy
                ? 'providers.settings.unified-checking'
                : 'providers.settings.unified-refresh')}
            </button>
          </div>
          <div className="structured-provider-grid">
            {enabledStructuredPreferences.map((preference) => {
              const definition = providerDefinition(preference.providerId);
              const report = structuredReports.find(
                (candidate) => candidate.providerId === preference.providerId
              );
              return (
                <article className="structured-provider-option" key={preference.providerId}>
                  <div>
                    <strong>{definition.displayName}</strong>
                    <p>
                      {report?.state === 'verified'
                        ? t('providers.settings.unified-verified', {
                            integration: STRUCTURED_INTEGRATION_LABELS[report.integration]
                          })
                        : report === undefined
                          ? t('providers.settings.unified-fallback')
                          : t(STRUCTURED_FALLBACK_LABELS[report.state])}
                    </p>
                    {report === undefined || report.issue === null ? null : (
                      <div className="structured-provider-recovery">
                        <p>{report.issue.message}</p>
                        <p>{report.issue.recovery}</p>
                      </div>
                    )}
                  </div>
                  <label className="settings-switch">
                    <span>
                      {t('providers.settings.use-unified', {
                        provider: definition.displayName
                      })}
                    </span>
                    <input
                      aria-label={t('providers.settings.use-unified', {
                        provider: definition.displayName
                      })}
                      checked={preference.useUnifiedWhenAvailable}
                      disabled={structuredBusy}
                      onChange={(event) => saveStructuredPreference(
                        preference,
                        { useUnifiedWhenAvailable: event.currentTarget.checked }
                      )}
                      type="checkbox"
                    />
                    <span aria-hidden="true" className="settings-switch-track">
                      <span className="settings-switch-thumb" />
                    </span>
                  </label>
                  <details className="structured-provider-advanced">
                    <summary>{t('providers.settings.unified-advanced')}</summary>
                    <label>
                      <span>{t('providers.settings.unified-executable-label')}</span>
                      <input
                        aria-label={t('providers.settings.unified-executable-aria', {
                          provider: definition.displayName
                        })}
                        disabled={structuredBusy}
                        maxLength={32_768}
                        onChange={(event) => {
                          const value = event.currentTarget.value;
                          setStructuredOverrideDrafts((current) => ({
                            ...current,
                            [preference.providerId]: value
                          }));
                        }}
                        placeholder={t('providers.settings.unified-executable-placeholder')}
                        type="text"
                        value={structuredOverrideDrafts[preference.providerId] ?? ''}
                      />
                    </label>
                    <p>{t('providers.settings.unified-executable-help')}</p>
                    <div className="catalog-actions">
                      <button
                        aria-label={t('providers.settings.unified-executable-save-aria', {
                          provider: definition.displayName
                        })}
                        className="secondary-button"
                        data-lumora-command
                        disabled={structuredBusy}
                        onClick={() => saveStructuredPreference(preference, {
                          executablePathOverride:
                            structuredOverrideDrafts[preference.providerId]?.trim() || null
                        })}
                        type="button"
                      >
                        {t('providers.settings.unified-executable-save')}
                      </button>
                      <button
                        className="text-button"
                        data-lumora-command
                        disabled={structuredBusy || preference.executablePathOverride === null}
                        onClick={() => {
                          setStructuredOverrideDrafts((current) => ({
                            ...current,
                            [preference.providerId]: ''
                          }));
                          saveStructuredPreference(preference, {
                            executablePathOverride: null
                          });
                        }}
                        type="button"
                      >
                        {t('providers.settings.unified-executable-reset')}
                      </button>
                    </div>
                  </details>
                </article>
              );
            })}
          </div>
          {structuredError ? (
            <p className="catalog-operation-error" role="alert">
              {t('providers.settings.unified-error')}
            </p>
          ) : null}
        </section>
      )}

      <div className="provider-panel-header">
        <div>
          <p className="card-label">
            {t(scope === 'remote' ? 'providers.settings.remote-registry' : 'providers.settings.local-registry')}
          </p>
          <h2 id="provider-panel-title">{t('providers.settings.installations')}</h2>
          <p>{t(scope === 'remote' ? 'providers.settings.registry-description-remote' : 'providers.settings.registry-description-local')}</p>
        </div>
        <div className="provider-panel-actions">
          <button
            className="refresh-button"
            disabled={
              status.state === 'loading' ||
              updatingProvider !== null ||
              installingProviders.size > 0
            }
            onClick={() => {
              void onRefresh();
            }}
            type="button"
          >
            <ScanIcon />
            {t(refreshing ? 'providers.settings.refreshing' : 'providers.settings.refresh')}
          </button>
          <button
            aria-label={t('providers.settings.check-updates-label')}
            className="secondary-button"
            disabled={
              updatesStatus.state === 'loading' ||
              updatesRefreshing ||
              updatingProvider !== null ||
              installingProviders.size > 0
            }
            onClick={() => {
              void onRefreshUpdates();
            }}
            type="button"
          >
            {t('providers.settings.check-updates')}
          </button>
        </div>
      </div>

      {status.state === 'loading' ? (
        <div className="provider-panel-state" role="status">
          <span className="status-dot" aria-hidden="true" />
          {t('providers.settings.scanning')}
        </div>
      ) : status.state === 'error' ? (
        <div className="provider-panel-state provider-panel-error" role="alert">
          <span className="status-warning-icon" aria-hidden="true">!</span>
          <div>
            <strong>{t('providers.settings.details-unavailable')}</strong>
            <p>{t('providers.settings.scan-failed')}</p>
          </div>
        </div>
      ) : (
        <>
          {status.scan.providers.some((provider) => provider.state === 'ready') ? (
            <section
              aria-labelledby="installed-providers-title"
              className="provider-group"
            >
              <h3 id="installed-providers-title">{t('providers.settings.installed')}</h3>
              <div className="provider-grid">
                {status.scan.providers
                  .filter((provider) => provider.state === 'ready')
                  .map(renderProviderCard)}
              </div>
            </section>
          ) : null}
          {status.scan.providers.some((provider) => provider.state !== 'ready') ? (
            <section
              aria-labelledby="available-providers-title"
              className="provider-group"
            >
              <h3 id="available-providers-title">{t('providers.settings.available')}</h3>
              <div className="provider-grid">
                {status.scan.providers
                  .filter((provider) => provider.state !== 'ready')
                  .map(renderProviderCard)}
              </div>
            </section>
          ) : null}
          <p className="provider-scan-time">
            <time dateTime={status.scan.scannedAt}>
              {t('providers.settings.last-checked', { date: `${formatDate(new Date(status.scan.scannedAt))} ${formatTime(new Date(status.scan.scannedAt))}` })}
            </time>
          </p>
          {commandError === null ? null : (
            <p className="catalog-operation-error" role="alert">{commandError}</p>
          )}
        </>
      )}
    </section>
  );
}
