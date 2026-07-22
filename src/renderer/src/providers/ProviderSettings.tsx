import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode
} from 'react';

import type {
  GeneralSettings,
  ProviderId,
  ProviderInstallation,
  ProviderLaunchConfig,
  ProviderScanResult,
  ProviderUpdateCheckResult,
  ProviderUpdateStatus
} from '../../../shared/contracts';
import { DEFAULT_GENERAL_SETTINGS } from '../../../shared/contracts';
import {
  PROVIDER_DEFINITIONS,
  providerDefinition
} from '../../../shared/provider-definitions';

export type ProviderScanStatus =
  | { state: 'loading' }
  | { state: 'ready'; scan: ProviderScanResult }
  | { state: 'error' };

export type ProviderUpdatesStatus =
  | { state: 'idle' }
  | { state: 'loading' }
  | { state: 'ready'; check: ProviderUpdateCheckResult }
  | { state: 'error' };

const PROVIDER_STATE_LABELS: Record<ProviderInstallation['state'], string> = {
  ready: 'Detected',
  not_found: 'Not found',
  probe_failed: 'Probe failed'
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
  const [confirmingInstall, setConfirmingInstall] = useState(false);
  const [confirmingUpdate, setConfirmingUpdate] = useState(false);
  const definition = providerDefinition(installation.provider);
  return (
    <article className={`provider-card provider-card-${installation.state}`}>
      <header className="provider-card-header">
        <div>
          <p className="card-label">Native CLI</p>
          <h4>{installation.displayName}</h4>
        </div>
        <span className={`provider-state provider-state-${installation.state}`}>
          <span aria-hidden="true" />
          {PROVIDER_STATE_LABELS[installation.state]}
        </span>
      </header>
      <p className="provider-session-capability">
        Saved sessions:{' '}
        {definition.sessionSupport === 'complete'
          ? 'Full session support'
          : 'Launch only'}
      </p>

      {installation.state === 'ready' ? (
        <dl className="provider-details">
          <div>
            <dt>Version</dt>
            <dd>{installation.version}</dd>
          </div>
          <div>
            <dt>Executable</dt>
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
              aria-label={`Open ${installation.displayName} installation guide`}
              className="secondary-button"
              disabled={installing}
              onClick={onOpenGuide}
              type="button"
            >
              Installation guide
            </button>
          ) : confirmingInstall ? (
            <div className="provider-install-confirmation">
              <p>
                Install {installation.displayName} globally with npm?
              </p>
              <div>
                <button
                  aria-label={`Confirm install ${installation.displayName}`}
                  className="refresh-button"
                  disabled={installing}
                  onClick={() => {
                    setConfirmingInstall(false);
                    onInstall();
                  }}
                  type="button"
                >
                  {installing ? 'Installing…' : 'Confirm install'}
                </button>
                <button
                  className="text-button"
                  disabled={installing}
                  onClick={() => setConfirmingInstall(false)}
                  type="button"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button
              aria-label={`Install ${installation.displayName}`}
              className="secondary-button"
              disabled={installing}
              onClick={() => setConfirmingInstall(true)}
              type="button"
            >
              {installing ? 'Installing…' : 'Install'}
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
            Updates not checked
          </p>
        ) : releaseChecking ? (
          <p className="provider-release-status provider-release-checking">
            <span className="status-dot" aria-hidden="true" />
            Checking latest version…
          </p>
        ) : release === null || release.state === 'unavailable' ? (
          <div>
            <p className="provider-release-status provider-release-unavailable">
              Latest version unavailable
            </p>
            <p className="provider-release-recovery">
              {release?.issue.recovery ?? 'Refresh to try the release check again.'}
            </p>
          </div>
        ) : (
          <div className="provider-release-ready">
            <p
              className={`provider-release-status provider-release-${release.state}`}
            >
              {release.state === 'update_available'
                ? `Update available · ${release.latestVersion}`
                : `Up to date · ${release.latestVersion}`}
            </p>
            {release.state === 'update_available' && confirmingUpdate ? (
              <div className="provider-install-confirmation">
                <p>
                  Lumora will run a global npm update. If {installation.displayName} was
                  installed another way, this may create a separate installation.
                </p>
                <div>
                  <button
                    aria-label={'Confirm update ' + installation.displayName + ' with npm'}
                    className="refresh-button"
                    disabled={updating}
                    onClick={() => {
                      setConfirmingUpdate(false);
                      onUpdate();
                    }}
                    type="button"
                  >
                    Confirm update
                  </button>
                  <button
                    className="text-button"
                    disabled={updating}
                    onClick={() => setConfirmingUpdate(false)}
                    type="button"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : release.state === 'update_available' ? (
              <button
                aria-label={
                  updating
                    ? `Updating ${installation.displayName}`
                    : `Update ${installation.displayName} with npm to ${release.latestVersion}`
                }
                className="secondary-button provider-update-button"
                disabled={updating}
                onClick={() => setConfirmingUpdate(true)}
                type="button"
              >
                {updating ? 'Updating…' : `Update with npm to ${release.latestVersion}`}
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
          <span>{installation.displayName} start command</span>
          <input
            aria-label={`${installation.displayName} start command`}
            disabled={saving}
            maxLength={4096}
            onChange={(event) => onCommandChange(event.currentTarget.value)}
            placeholder={installation.executablePath ?? installation.provider}
            type="text"
            value={command}
          />
        </label>
        <p>
          Provider layer override. Leave blank to use the detected executable.
        </p>
        <div className="provider-command-actions">
          <button
            aria-label={`Save ${installation.displayName} start command`}
            className="secondary-button"
            disabled={saving}
            onClick={onSaveCommand}
            type="button"
          >
            {saving ? 'Saving' : 'Save command'}
          </button>
          <button
            aria-label={`Reset ${installation.displayName} start command`}
            className="text-button"
            disabled={saving || command === ''}
            onClick={onResetCommand}
            type="button"
          >
            Use detected CLI
          </button>
        </div>
      </div>
    </article>
  );
}

export function ProviderSettings({
  status,
  onRefresh,
  generalSettings = DEFAULT_GENERAL_SETTINGS,
  generalSettingsSaving = false,
  generalSettingsSaveError = null,
  onSaveEnabledProviders = async () => true
}: {
  status: ProviderScanStatus;
  onRefresh: () => void;
  generalSettings?: GeneralSettings;
  generalSettingsSaving?: boolean;
  generalSettingsSaveError?: string | null;
  onSaveEnabledProviders?: (
    providers: readonly ProviderId[]
  ) => Promise<boolean>;
}): ReactNode {
  const [enabledProviderDraft, setEnabledProviderDraft] = useState<
    readonly ProviderId[]
  >(generalSettings.enabledProviders);
  const [commands, setCommands] = useState<
    Partial<Record<ProviderId, string>>
  >({});
  const [savingProvider, setSavingProvider] = useState<ProviderId | null>(null);
  const [commandError, setCommandError] = useState<string | null>(null);
  const [updatesStatus, setUpdatesStatus] = useState<ProviderUpdatesStatus>({
    state: generalSettings.checkProviderUpdatesAutomatically
      ? 'loading'
      : 'idle'
  });
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
  const updatesRequestId = useRef(0);

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
    void window.lumora.getProviderLaunchConfigs().then(
      (configs) => {
        if (active) applyConfigs(configs);
      },
      () => {
        if (active) setCommandError('Provider start commands could not be loaded.');
      }
    );
    return () => { active = false; };
  }, []);

  const refreshUpdates = useCallback(async (): Promise<void> => {
    const requestId = updatesRequestId.current + 1;
    updatesRequestId.current = requestId;
    setUpdatesStatus({ state: 'loading' });
    try {
      const check = await window.lumora.checkProviderUpdates();
      if (updatesRequestId.current === requestId) {
        setUpdatesStatus({ state: 'ready', check });
      }
    } catch {
      if (updatesRequestId.current === requestId) {
        setUpdatesStatus({ state: 'error' });
      }
    }
  }, []);

  useEffect(() => {
    if (!generalSettings.checkProviderUpdatesAutomatically) {
      updatesRequestId.current += 1;
      setUpdatesStatus({ state: 'idle' });
      return;
    }
    void refreshUpdates();
    return () => {
      updatesRequestId.current += 1;
    };
  }, [generalSettings.checkProviderUpdatesAutomatically, refreshUpdates]);

  const saveCommand = (provider: ProviderId, command: string | null) => {
    setSavingProvider(provider);
    setCommandError(null);
    void window.lumora.saveProviderLaunchConfig({ provider, command }).then(
      (configs) => {
        applyConfigs(configs);
        setSavingProvider(null);
      },
      () => {
        setCommandError('The provider start command could not be saved.');
        setSavingProvider(null);
      }
    );
  };

  const updateProvider = (provider: ProviderId, displayName: string) => {
    setUpdatingProvider(provider);
    setUpdateErrors((current) => ({ ...current, [provider]: undefined }));
    void window.lumora.updateProvider(provider).then(
      async () => {
        onRefresh();
        if (generalSettings.checkProviderUpdatesAutomatically) {
          await refreshUpdates();
        } else {
          setUpdatesStatus({ state: 'idle' });
        }
        setUpdatingProvider(null);
      },
      () => {
        setUpdateErrors((current) => ({
          ...current,
          [provider]: `${displayName} could not be updated. Run ${provider} update manually or try again.`
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
    void window.lumora.installProvider(provider).then(
      async () => {
        onRefresh();
        if (generalSettings.checkProviderUpdatesAutomatically) {
          await refreshUpdates();
        } else {
          setUpdatesStatus({ state: 'idle' });
        }
        finish();
      },
      () => {
        setInstallErrors((current) => ({
          ...current,
          [provider]: `${displayName} could not be installed. Open its installation guide or try again.`
        }));
        finish();
      }
    );
  };

  const openInstallGuide = (provider: ProviderId, displayName: string) => {
    setInstallErrors((current) => ({ ...current, [provider]: undefined }));
    void window.lumora.openProviderInstallGuide(provider).catch(() => {
      setInstallErrors((current) => ({
        ...current,
        [provider]: `${displayName}'s installation guide could not be opened.`
      }));
    });
  };

  const enabledProviderSelectionChanged =
    enabledProviderDraft.length !== generalSettings.enabledProviders.length ||
    enabledProviderDraft.some(
      (provider, index) => provider !== generalSettings.enabledProviders[index]
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
      releaseChecking={updatesStatus.state === 'loading'}
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
          <p className="card-label">Lumora scope</p>
          <h2 id="enabled-providers-title">Enabled providers</h2>
          <p>
            Choose which providers Lumora scans and displays. Disabling one
            never removes its CLI, settings, or saved session data.
          </p>
        </div>
        <div className="provider-selection-grid">
          {PROVIDER_DEFINITIONS.map((definition) => {
            const checked = enabledProviderDraft.includes(definition.provider);
            return (
              <label className="provider-selection-option" key={definition.provider}>
                <input
                  aria-label={`Use ${definition.displayName}`}
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
            aria-label="Save provider selection"
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
            {generalSettingsSaving ? 'Saving…' : 'Save selection'}
          </button>
          <span>{enabledProviderDraft.length} enabled</span>
        </div>
        {generalSettingsSaveError === null ? null : (
          <p className="general-setting-error" role="alert">
            {generalSettingsSaveError}
          </p>
        )}
      </section>

      <div className="provider-panel-header">
        <div>
          <p className="card-label">Local provider registry</p>
          <h2 id="provider-panel-title">Provider installations</h2>
          <p>
            Lumora reads the effective PATH and checks public release metadata.
            It only modifies a provider after you explicitly confirm an action.
          </p>
        </div>
        <div className="provider-panel-actions">
          <button
            className="refresh-button"
            disabled={
              status.state === 'loading' ||
              updatingProvider !== null ||
              installingProviders.size > 0
            }
            onClick={onRefresh}
            type="button"
          >
            <ScanIcon />
            Refresh
          </button>
          <button
            aria-label="Check for provider updates"
            className="secondary-button"
            disabled={
              updatesStatus.state === 'loading' ||
              updatingProvider !== null ||
              installingProviders.size > 0
            }
            onClick={() => {
              void refreshUpdates();
            }}
            type="button"
          >
            Check for updates
          </button>
        </div>
      </div>

      {status.state === 'loading' ? (
        <div className="provider-panel-state" role="status">
          <span className="status-dot" aria-hidden="true" />
          Scanning provider installations
        </div>
      ) : status.state === 'error' ? (
        <div className="provider-panel-state provider-panel-error" role="alert">
          <span className="status-warning-icon" aria-hidden="true">!</span>
          <div>
            <strong>Provider details are unavailable</strong>
            <p>The scan could not be completed. Refresh to try again.</p>
          </div>
        </div>
      ) : (
        <>
          {status.scan.providers.some((provider) => provider.state === 'ready') ? (
            <section
              aria-labelledby="installed-providers-title"
              className="provider-group"
            >
              <h3 id="installed-providers-title">Installed providers</h3>
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
              <h3 id="available-providers-title">Available providers</h3>
              <div className="provider-grid">
                {status.scan.providers
                  .filter((provider) => provider.state !== 'ready')
                  .map(renderProviderCard)}
              </div>
            </section>
          ) : null}
          <p className="provider-scan-time">
            Last checked{' '}
            <time dateTime={status.scan.scannedAt}>
              {new Date(status.scan.scannedAt).toLocaleString()}
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
