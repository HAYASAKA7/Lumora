import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

import { ProviderCard } from './provider-card';

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
import {
  PROVIDER_LIFECYCLE_BUSY_CODE,
  DEFAULT_GENERAL_SETTINGS,
  STRUCTURED_AGENT_PROVIDER_IDS
} from '../../../shared/contracts';
import {
  PROVIDER_DEFINITIONS,
  providerDefinition,
  supportsManagedProviderUpdate
} from '../../../shared/provider-definitions';
import type { ProviderUpdatesStatus } from './useProviderUpdates';
import { STRUCTURED_PREFERENCES_CHANGED_EVENT } from '../catalog/SessionRouteChoiceContext';
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
  'updateProvider' |
  'cancelProviderUpdate'
> & Partial<Pick<
  LumoraApi,
  'scanStructuredProviderCapabilities' |
  'getStructuredProviderPreferences' |
  'saveStructuredProviderPreference'
>>;

const STRUCTURED_INTEGRATION_LABELS = {
  codex_app_server: 'Codex app-server',
  claude_agent_sdk: 'Claude Agent SDK',
  gemini_acp: 'Gemini ACP',
  opencode_acp: 'OpenCode ACP',
  cursor_acp: 'Cursor ACP',
  copilot_acp: 'GitHub Copilot ACP',
  qwen_acp: 'Qwen ACP',
  kimi_acp: 'Kimi ACP',
  goose_acp: 'goose ACP'
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


export function ProviderSettings({
  status,
  onRefresh,
  api = window.lumora,
  scope = 'local',
  generalSettings = DEFAULT_GENERAL_SETTINGS,
  generalSettingsSaving = false,
  generalSettingsSaveError = null,
  onGeneralSettingsChange = () => undefined,
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
  onGeneralSettingsChange?: (settings: GeneralSettings) => void;
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
  const [structuredPreferencesLoading, setStructuredPreferencesLoading] = useState(false);
  const [structuredReportsLoading, setStructuredReportsLoading] = useState(false);
  const [structuredSaving, setStructuredSaving] = useState(false);
  const [structuredError, setStructuredError] = useState(false);
  const [structuredDialogOpen, setStructuredDialogOpen] = useState(false);
  const structuredDetailsButtonRef = useRef<HTMLButtonElement | null>(null);
  const structuredReportsRequestRef = useRef(0);
  const structuredBusy =
    structuredPreferencesLoading || structuredReportsLoading || structuredSaving;
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
    setStructuredError(false);
    setStructuredPreferencesLoading(true);
    void api.getStructuredProviderPreferences().then(
      (preferences) => {
        setStructuredPreferences(preferences);
        setStructuredPreferencesLoading(false);
      },
      () => {
        setStructuredError(true);
        setStructuredPreferencesLoading(false);
      }
    );
    const requestId = ++structuredReportsRequestRef.current;
    setStructuredReportsLoading(true);
    void api.scanStructuredProviderCapabilities(fresh).then(
      (reports) => {
        if (structuredReportsRequestRef.current !== requestId) return;
        setStructuredReports(reports);
        setStructuredReportsLoading(false);
      },
      () => {
        if (structuredReportsRequestRef.current !== requestId) return;
        setStructuredError(true);
        setStructuredReportsLoading(false);
      }
    );
  };

  const closeStructuredDialog = () => {
    setStructuredDialogOpen(false);
    window.requestAnimationFrame(() => structuredDetailsButtonRef.current?.focus());
  };

  useEffect(() => {
    if (!structuredDialogOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      closeStructuredDialog();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [structuredDialogOpen]);

  const saveStructuredPreference = (
    preference: StructuredProviderPreference,
    update: Partial<Pick<
      StructuredProviderPreference,
      'useUnifiedWhenAvailable' | 'executablePathOverride'
    >>
  ) => {
    if (api.saveStructuredProviderPreference === undefined) return;
    setStructuredSaving(true);
    setStructuredError(false);
    void api.saveStructuredProviderPreference({
      ...preference,
      ...update
      }).then((preferences) => {
        setStructuredPreferences(preferences);
        window.dispatchEvent(new Event(STRUCTURED_PREFERENCES_CHANGED_EVENT));
        setStructuredSaving(false);
        if (api.scanStructuredProviderCapabilities !== undefined) {
          const requestId = ++structuredReportsRequestRef.current;
          setStructuredReportsLoading(true);
          void api.scanStructuredProviderCapabilities(true).then(
            (reports) => {
              if (structuredReportsRequestRef.current !== requestId) return;
              setStructuredReports(reports);
              setStructuredReportsLoading(false);
            },
            () => {
              if (structuredReportsRequestRef.current !== requestId) return;
              setStructuredError(true);
              setStructuredReportsLoading(false);
            }
          );
        }
      }).catch(() => {
        setStructuredError(true);
        setStructuredSaving(false);
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

  const updateFailure = (
    error: unknown,
    provider: ProviderId,
    displayName: string
  ): string => {
    const reason = String(
      (error as { message?: unknown } | null)?.message ?? error
    );
    if (reason.includes(PROVIDER_LIFECYCLE_BUSY_CODE)) {
      return t('providers.settings.update-busy', { provider: displayName });
    }
    return t('providers.settings.update-error', {
      provider: displayName,
      command: provider
    });
  };

  const cancelUpdate = (provider: ProviderId) => {
    void api.cancelProviderUpdate(provider).catch(() => undefined);
  };

  const updateProvider = (provider: ProviderId, displayName: string) => {
    setUpdatingProvider(provider);
    setUpdateErrors((current) => ({ ...current, [provider]: undefined }));
    void api.updateProvider(provider).then(
      async (outcome) => {
        setUpdatingProvider(null);
        if (outcome.outcome === 'cancelled') {
          setUpdateErrors((current) => ({
            ...current,
            [provider]: t('providers.settings.update-cancelled', {
              provider: displayName
            })
          }));
          /**
           * Cancelling stops npm partway through replacing the package, so the
           * version on the card is no longer known to be what is on disk.
           */
          await onRefresh();
          return;
        }
        await onRefresh();
        await onRefreshUpdates();
      },
      (error: unknown) => {
        setUpdateErrors((current) => ({
          ...current,
          [provider]: updateFailure(error, provider, displayName)
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
      async (outcome) => {
        finish();
        if (outcome.outcome === 'cancelled') {
          await onRefresh();
          return;
        }
        await onRefresh();
        await onRefreshUpdates();
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
  const enabledStructuredProviderIds = STRUCTURED_AGENT_PROVIDER_IDS.filter(
    (providerId) => generalSettings.enabledProviders.includes(providerId)
  );

  /**
   * The switch on a card applies at once, the way every other switch in
   * Settings does, so there is no separate selection to save.
   */
  const toggleProvider = (provider: ProviderId, enabled: boolean) => {
    const next = PROVIDER_DEFINITIONS
      .filter(({ provider: candidate }) =>
        candidate === provider
          ? enabled
          : enabledProviderDraft.includes(candidate)
      )
      .map(({ provider: candidate }) => candidate);
    if (next.length === 0) return;
    setEnabledProviderDraft(next);
    void onSaveEnabledProviders(next);
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
      enabled={enabledProviderDraft.includes(installation.provider)}
      enableLocked={
        generalSettingsSaving ||
        (enabledProviderDraft.includes(installation.provider) &&
          enabledProviderDraft.length === 1)
      }
      onEnabledChange={(next) => toggleProvider(installation.provider, next)}
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
      onCancelUpdate={() => cancelUpdate(installation.provider)}
      onUpdate={() => updateProvider(
        installation.provider,
        installation.displayName
      )}
      saving={savingProvider === installation.provider}
      updateError={updateErrors[installation.provider] ?? null}
      updating={updatingProvider === installation.provider}
    />
  );

  /**
   * Every provider Lumora supports gets a card, whether or not the scan saw it.
   * A disabled provider is left out of the scan, and without its own card there
   * would be no switch to turn it back on.
   */
  const scanned = status.state === 'ready' ? status.scan.providers : [];
  const allProviders: readonly ProviderInstallation[] = PROVIDER_DEFINITIONS
    .map(({ provider, displayName }) =>
      scanned.find((candidate) => candidate.provider === provider) ?? {
        provider,
        displayName,
        state: 'not_found' as const,
        executablePath: null,
        version: null,
        issue: {
          code: 'PROVIDER_NOT_FOUND' as const,
          message: t('providers.settings.not-scanned', { provider: displayName }),
          recovery: t('providers.settings.not-scanned-recovery'),
          retryable: true
        }
      }
    );

  return (
    <section className="provider-panel" aria-labelledby="provider-panel-title">
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
          {allProviders.some((provider) => provider.state === 'ready') ? (
            <section
              aria-labelledby="installed-providers-title"
              className="provider-group"
            >
              <h3 id="installed-providers-title">{t('providers.settings.installed')}</h3>
              <div className="provider-grid">
                {allProviders
                  .filter((provider) => provider.state === 'ready')
                  .map(renderProviderCard)}
              </div>
            </section>
          ) : null}
          {allProviders.some((provider) => provider.state !== 'ready') ? (
            <section
              aria-labelledby="available-providers-title"
              className="provider-group"
            >
              <h3 id="available-providers-title">{t('providers.settings.available')}</h3>
              <div className="provider-grid">
                {allProviders
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

      {scope !== 'local' || enabledStructuredProviderIds.length === 0 ? null : (
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
            <label className="settings-switch structured-provider-master-toggle">
              <input
                aria-label={t('providers.settings.unified-master-label')}
                checked={generalSettings.unifiedAgentUiEnabled}
                disabled={generalSettingsSaving}
                onChange={(event) => onGeneralSettingsChange({
                  ...generalSettings,
                  unifiedAgentUiEnabled: event.currentTarget.checked
                })}
                type="checkbox"
              />
              <span aria-hidden="true" className="settings-switch-track">
                <span className="settings-switch-thumb" />
              </span>
            </label>
          </div>
          <div className="structured-provider-panel-actions">
            <button
              aria-label={t('providers.settings.unified-details-open-aria')}
              className="secondary-button"
              data-lumora-command
              onClick={() => {
                setStructuredDialogOpen(true);
                refreshStructuredProviders(false);
              }}
              ref={structuredDetailsButtonRef}
              type="button"
            >
              {t('providers.settings.unified-details-open')}
            </button>
          </div>
        </section>
      )}
      {!structuredDialogOpen ? null : createPortal(
        <div className="dialog-backdrop" role="presentation">
          <section
            aria-labelledby="structured-provider-dialog-title"
            aria-modal="true"
            className="new-session-dialog structured-provider-settings-dialog"
            role="dialog"
          >
            <header>
              <div>
                <p className="card-label">
                  {t('providers.settings.unified-eyebrow')}
                </p>
                <h2 id="structured-provider-dialog-title">
                  {t('providers.settings.unified-details-title')}
                </h2>
              </div>
              <button
                aria-label={t('providers.settings.unified-details-close-aria')}
                className="text-button"
                data-lumora-command
                onClick={closeStructuredDialog}
                type="button"
              >
                {t('common.actions.close')}
              </button>
            </header>
            <div className="dialog-body structured-provider-settings-dialog-body">
              <div className="structured-provider-dialog-actions">
                <p>{t('providers.settings.unified-details-description')}</p>
                <button
                  className="secondary-button"
                  data-lumora-command
                  disabled={structuredBusy}
                  onClick={() => refreshStructuredProviders(true)}
                  type="button"
                >
                  {t(structuredBusy
                    ? 'providers.settings.unified-checking'
                    : 'providers.settings.unified-refresh')}
                </button>
              </div>
              {structuredPreferencesLoading && enabledStructuredPreferences.length === 0 ? (
                <div className="provider-panel-state" role="status">
                  <span className="status-dot" aria-hidden="true" />
                  {t('providers.settings.unified-checking')}
                </div>
              ) : (
                <div className="structured-provider-grid">
                  {enabledStructuredPreferences.map((preference) => {
                    const definition = providerDefinition(preference.providerId);
                    const report = structuredReports.find(
                      (candidate) => candidate.providerId === preference.providerId
                    );
                    return (
                      <article className="structured-provider-option" key={preference.providerId}>
                        <div className="structured-provider-option-header">
                          <strong>{definition.displayName}</strong>
                          <label className="settings-switch structured-provider-toggle">
                            <input
                              aria-label={t('providers.settings.use-unified', {
                                provider: definition.displayName
                              })}
                              checked={preference.useUnifiedWhenAvailable}
                              disabled={structuredSaving}
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
                        </div>
                        <div className="structured-provider-copy">
                          <p>
                            {report?.state === 'verified'
                              ? t('providers.settings.unified-verified', {
                                  integration: STRUCTURED_INTEGRATION_LABELS[report.integration]
                                })
                              : report === undefined
                                ? t(structuredReportsLoading
                                  ? 'providers.settings.unified-checking'
                                  : 'providers.settings.unified-fallback')
                                : t(STRUCTURED_FALLBACK_LABELS[report.state])}
                          </p>
                          {report === undefined || report.issue === null ? null : (
                            <div className="structured-provider-recovery">
                              <p>{report.issue.message}</p>
                              <p>{report.issue.recovery}</p>
                            </div>
                          )}
                        </div>
                      </article>
                    );
                  })}
                </div>
              )}
              {structuredError ? (
                <p className="catalog-operation-error" role="alert">
                  {t('providers.settings.unified-error')}
                </p>
              ) : null}
            </div>
          </section>
        </div>,
        document.body
      )}
    </section>
  );
}
