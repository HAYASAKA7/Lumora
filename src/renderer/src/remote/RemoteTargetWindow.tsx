import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode
} from 'react';

import type {
  DeveloperToolStatus,
  LumoraApi,
  ProviderId,
  ProviderInstallation,
  RemoteDiscoverySnapshot,
  RemoteHelperInstallDetails,
  RemoteExecutionTargetId,
  RemoteProviderPreferences,
  RemoteSessionCatalog,
  RemoteTargetConnectionDetails,
  RemoteTargetCredentials,
  RemoteTargetSummary
} from '../../../shared/contracts';
import { PROVIDER_DEFINITIONS } from '../../../shared/provider-definitions';
import {
  CatalogHomeSummary,
  SessionsView,
  WorkspacesView,
  type CatalogViewStatus
} from '../catalog/CatalogViews';
import { WorkspaceSessionsView } from '../catalog/WorkspaceSessionsView';
import {
  LumoraShell,
  type LumoraShellAppearance
} from '../shell/LumoraShell';
import {
  readSidebarExpanded,
  writeSidebarExpanded
} from '../sidebar/sidebar-preference';
import {
  readRemoteTargetErrorCode,
  type RemoteTargetErrorCode
} from '../../../shared/remote-target-errors';

interface RemoteTargetWindowProps {
  executionTargetId: RemoteExecutionTargetId;
  api?: LumoraApi;
  appearance?: LumoraShellAppearance;
}

type RemotePage = 'home' | 'workspaces' | 'sessions' | 'settings';
type RemoteSettingsCategory = 'providers' | 'environment' | 'security';
type DiscoveryStatus =
  | { state: 'idle' }
  | { state: 'loading' }
  | { state: 'ready'; snapshot: RemoteDiscoverySnapshot }
  | { state: 'unsupported' }
  | { state: 'error' };
type SessionCatalogStatus =
  | { state: 'idle' }
  | { state: 'loading' }
  | { state: 'ready'; catalog: RemoteSessionCatalog }
  | { state: 'unsupported' }
  | { state: 'error' };

const DEFAULT_REMOTE_APPEARANCE: LumoraShellAppearance = {
  backgroundActive: false,
  backgroundStyle: undefined,
  hasSurfaceMosaic: false,
  shellStyle: undefined,
  theme: 'lumora'
};

const REMOTE_ROUTES = [
  {
    id: 'home', label: 'Home', icon: 'home', eyebrow: 'Remote computer',
    description: 'Review the connected target and its most recent provider sessions.'
  },
  {
    id: 'workspaces', label: 'Workspaces', icon: 'workspace',
    eyebrow: 'Remote workspace index',
    description: 'Browse provider-owned workspace groupings discovered on this computer.'
  },
  {
    id: 'sessions', label: 'All sessions', icon: 'sessions',
    eyebrow: 'Remote session catalog',
    description: 'Search bounded, read-only session metadata from this computer.'
  },
  {
    id: 'settings', label: 'Settings', icon: 'settings',
    eyebrow: 'Remote settings',
    description: 'Configure target-scoped providers and inspect this connection.'
  }
] as const;

const TOOL_STATE_LABELS: Record<DeveloperToolStatus['state'], string> = {
  ready: 'Detected',
  not_found: 'Not found',
  probe_failed: 'Probe failed'
};

const PROVIDER_STATE_LABELS: Record<ProviderInstallation['state'], string> = {
  ready: 'Detected',
  not_found: 'Not found',
  probe_failed: 'Probe failed'
};

const REMOTE_CONNECTION_ERROR_MESSAGES: Record<RemoteTargetErrorCode, string> = {
  REMOTE_TARGET_AUTHENTICATION_FAILED:
    'SSH authentication failed. Check the profile username and enter the same credential that works in a native SSH client.',
  REMOTE_TARGET_HOST_KEY_CHANGED:
    'The remote computer identity changed. Return to local Lumora and verify its host fingerprint before reconnecting.',
  REMOTE_TARGET_SSH_TIMEOUT:
    'The SSH connection timed out. Check that the remote computer is reachable and its SSH service is responding.',
  REMOTE_TARGET_SSH_CONNECTION_FAILED:
    'Lumora could not establish the SSH connection. Check the host, port, SSH service, and network route.',
  REMOTE_TARGET_PLATFORM_PROBE_FAILED:
    'SSH connected, but Lumora could not identify the remote operating system. Check that the account can run non-interactive shell commands.',
  REMOTE_TARGET_HELPER_BUNDLE_FAILED:
    'SSH connected, but Lumora could not verify a helper for this operating system and architecture. Rebuild the helper bundle or use a packaged Lumora build.',
  REMOTE_TARGET_FILE_TRANSFER_FAILED:
    'SSH connected, but Lumora could not open the remote file-transfer service. Check that the SSH server has SFTP enabled.',
  REMOTE_TARGET_HELPER_INSPECTION_FAILED:
    'SSH connected, but Lumora could not inspect the remote helper installation. Check the remote account permissions and try again.',
  REMOTE_TARGET_OPERATION_FAILED:
    'Lumora could not connect to this remote computer. Check the profile and try again.'
};

function remoteConnectionErrorMessage(error: unknown): string {
  return REMOTE_CONNECTION_ERROR_MESSAGES[readRemoteTargetErrorCode(error)];
}

function endpoint(summary: RemoteTargetSummary): string {
  const profile = summary.profile;
  return profile.route === 'direct'
    ? `${profile.username}@${profile.host}:${profile.port}`
    : `SSH config · ${profile.sshConfigHost}`;
}

function canonicalProviders(providers: readonly ProviderId[]): ProviderId[] {
  const selected = new Set(providers);
  return PROVIDER_DEFINITIONS
    .map(({ provider }) => provider)
    .filter((provider) => selected.has(provider));
}

function ToolCard({
  displayName,
  command,
  status
}: {
  displayName: string;
  command: 'node' | 'npm';
  status: DeveloperToolStatus;
}): ReactNode {
  return (
    <article className={`remote-discovery-card state-${status.state}`}>
      <header>
        <div>
          <p className="card-label">Remote prerequisite</p>
          <h3>{displayName}</h3>
        </div>
        <span className={`remote-state state-${status.state}`}>
          {TOOL_STATE_LABELS[status.state]}
        </span>
      </header>
      {status.state === 'ready' ? (
        <dl className="remote-discovery-details">
          <div><dt>Version</dt><dd>{status.version}</dd></div>
          <div><dt>Executable</dt><dd>{status.executablePath}</dd></div>
        </dl>
      ) : status.state === 'probe_failed' ? (
        <>
          <p>
            Lumora found {displayName}, but <code>{command} --version</code> did
            not complete successfully on the remote computer.
          </p>
          <p className="remote-discovery-path">{status.executablePath}</p>
        </>
      ) : (
        <p>
          Install or repair {displayName} on the remote computer, then refresh
          this page.
        </p>
      )}
    </article>
  );
}

function ProviderCard({
  enabled,
  installation,
  provider,
  onlyEnabled,
  onToggle
}: {
  enabled: boolean;
  installation: ProviderInstallation | null;
  provider: (typeof PROVIDER_DEFINITIONS)[number];
  onlyEnabled: boolean;
  onToggle(provider: ProviderId, enabled: boolean): void;
}): ReactNode {
  const state = enabled && installation !== null ? installation.state : 'not-scanned';
  return (
    <article className={`remote-provider-card state-${state}`}>
      <header>
        <div>
          <p className="card-label">Remote provider</p>
          <h3>{provider.displayName}</h3>
        </div>
        <label className="remote-provider-toggle">
          <span>{enabled ? 'Enabled' : 'Disabled'}</span>
          <span className="settings-switch">
            <input
              aria-label={`Enable ${provider.displayName}`}
              checked={enabled}
              disabled={enabled && onlyEnabled}
              onChange={(event) => onToggle(provider.provider, event.target.checked)}
              role="switch"
              type="checkbox"
            />
            <span aria-hidden="true" className="settings-switch-track">
              <span className="settings-switch-thumb" />
            </span>
          </span>
        </label>
      </header>
      {!enabled || installation === null ? (
        <p className="remote-provider-unscanned">Not scanned</p>
      ) : installation.state === 'ready' ? (
        <dl className="remote-discovery-details">
          <div><dt>Status</dt><dd>{PROVIDER_STATE_LABELS[installation.state]}</dd></div>
          <div><dt>Version</dt><dd>{installation.version}</dd></div>
          <div><dt>Executable</dt><dd>{installation.executablePath}</dd></div>
        </dl>
      ) : (
        <div className="remote-provider-issue">
          <strong>{PROVIDER_STATE_LABELS[installation.state]}</strong>
          <p>{installation.issue.message}</p>
          <p>{installation.issue.recovery}</p>
        </div>
      )}
    </article>
  );
}

export function RemoteTargetWindow({
  executionTargetId,
  api = window.lumora,
  appearance = DEFAULT_REMOTE_APPEARANCE
}: RemoteTargetWindowProps) {
  const [summary, setSummary] = useState<RemoteTargetSummary | null>(null);
  const [details, setDetails] = useState<RemoteTargetConnectionDetails | null>(null);
  const [helperInstall, setHelperInstall] = useState<RemoteHelperInstallDetails | null>(null);
  const [showHelperInstall, setShowHelperInstall] = useState(false);
  const [page, setPage] = useState<RemotePage>('home');
  const [settingsCategory, setSettingsCategory] =
    useState<RemoteSettingsCategory>('providers');
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string | null>(null);
  const [sessionSearch, setSessionSearch] = useState('');
  const [sessionProvider, setSessionProvider] = useState<ProviderId | null>(null);
  const [dismissedDiagnostics, setDismissedDiagnostics] = useState<Set<string>>(
    () => new Set()
  );
  const [sidebarExpanded, setSidebarExpanded] = useState(() =>
    readSidebarExpanded(window)
  );
  const [preferences, setPreferences] = useState<RemoteProviderPreferences | null>(null);
  const [draftProviders, setDraftProviders] = useState<ProviderId[]>([]);
  const [discovery, setDiscovery] = useState<DiscoveryStatus>({ state: 'idle' });
  const [sessionCatalog, setSessionCatalog] = useState<SessionCatalogStatus>({
    state: 'idle'
  });
  const [secret, setSecret] = useState('');
  const [busy, setBusy] = useState(false);
  const [savingProviders, setSavingProviders] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shellOpened, setShellOpened] = useState(false);
  const autoScannedKey = useRef<string | null>(null);

  useEffect(() => {
    writeSidebarExpanded(window, sidebarExpanded);
  }, [sidebarExpanded]);

  useEffect(() => {
    let active = true;
    void api.listRemoteTargets().then(
      (targets) => {
        if (!active) return;
        const current = targets.find(
          ({ target }) => target.id === executionTargetId
        ) ?? null;
        setSummary(current);
        setError(current === null ? 'This remote target is unavailable.' : null);
      },
      () => {
        if (active) setError('Lumora could not load this remote target.');
      }
    );
    return () => { active = false; };
  }, [api, executionTargetId]);

  const refreshDiscovery = useCallback(async () => {
    setDiscovery({ state: 'loading' });
    try {
      const snapshot = await api.scanRemoteDiscovery();
      setDiscovery({ state: 'ready', snapshot });
    } catch {
      setDiscovery({ state: 'error' });
    }
  }, [api]);

  const loadRemoteState = useCallback(async (supported: boolean) => {
    setDiscovery(supported ? { state: 'loading' } : { state: 'unsupported' });
    try {
      const nextPreferences = await api.getRemoteProviderPreferences();
      setPreferences(nextPreferences);
      setDraftProviders([...nextPreferences.enabledProviders]);
      if (supported) {
        const snapshot = await api.scanRemoteDiscovery();
        setDiscovery({ state: 'ready', snapshot });
      }
    } catch {
      setDiscovery({ state: 'error' });
    }
  }, [api]);

  const refreshSessions = useCallback(async () => {
    setSessionCatalog({ state: 'loading' });
    try {
      const catalog = await api.scanRemoteSessions();
      setSessionCatalog({ state: 'ready', catalog });
    } catch {
      setSessionCatalog({ state: 'error' });
    }
  }, [api]);

  useEffect(() => {
    if (summary?.target.connectionState !== 'ready') return;
    const key = `${summary.target.id}:${summary.target.helperVersion ?? 'unknown'}`;
    if (autoScannedKey.current === key) return;
    autoScannedKey.current = key;
    void loadRemoteState(summary.target.capabilities.includes('provider-scan'));
  }, [loadRemoteState, summary]);

  useEffect(() => {
    if (
      !['home', 'workspaces', 'sessions'].includes(page) ||
      summary?.target.connectionState !== 'ready'
    ) return;
    if (sessionCatalog.state !== 'idle') return;
    if (!summary.target.capabilities.includes('session-scan')) {
      setSessionCatalog({ state: 'unsupported' });
      return;
    }
    void refreshSessions();
  }, [page, refreshSessions, sessionCatalog.state, summary]);

  useEffect(() => {
    if (summary?.target.connectionState === 'ready') setShellOpened(true);
  }, [summary?.target.connectionState]);

  useEffect(() => {
    if (!shellOpened) return;
    let active = true;
    const refreshConnectionState = () => {
      void api.listRemoteTargets().then(
        (targets) => {
          if (!active) return;
          const current = targets.find(
            ({ target }) => target.id === executionTargetId
          );
          if (current !== undefined) setSummary(current);
        },
        () => undefined
      );
    };
    const interval = window.setInterval(refreshConnectionState, 4_000);
    window.addEventListener('focus', refreshConnectionState);
    return () => {
      active = false;
      window.clearInterval(interval);
      window.removeEventListener('focus', refreshConnectionState);
    };
  }, [api, executionTargetId, shellOpened]);

  if (summary === null) {
    return (
      <main className="remote-window-shell">
        <section className="remote-window-card" aria-live="polite">
          <p className="eyebrow">Remote Lumora</p>
          <h1>Connecting to target manager</h1>
          <p>{error ?? 'Loading the isolated remote workspace…'}</p>
        </section>
      </main>
    );
  }

  const authentication = summary.profile.authentication;
  const credentials = (): RemoteTargetCredentials => {
    if (authentication.method === 'password') {
      return { method: 'password', password: secret };
    }
    if (authentication.method === 'private-key') {
      return { method: 'private-key', passphrase: secret || null };
    }
    return { method: 'agent' };
  };
  const trusted = summary.profile.verifiedHostFingerprint !== null;
  const connected = summary.target.connectionState === 'ready';
  const discoverySupported = connected &&
    summary.target.capabilities.includes('provider-scan');
  const helperPending = summary.target.connectionState === 'helper-missing' ||
    summary.target.connectionState === 'helper-incompatible';
  const providerResults = discovery.state === 'ready'
    ? new Map(discovery.snapshot.providers.providers.map((item) => [item.provider, item]))
    : new Map<ProviderId, ProviderInstallation>();
  const providersChanged = preferences !== null &&
    draftProviders.join('\0') !== preferences.enabledProviders.join('\0');

  const loadHelperInstall = async () => {
    try {
      setHelperInstall(await api.getRemoteHelperInstallDetails());
    } catch {
      setError('Lumora could not inspect the remote helper installation.');
    }
  };

  const connect = async () => {
    if (!trusted || busy) return;
    setBusy(true);
    setError(null);
    try {
      const connectedDetails = await api.connectRemoteTarget({
        executionTargetId,
        credentials: credentials()
      });
      setSummary({
        target: connectedDetails.target,
        profile: connectedDetails.profile
      });
      setDetails(connectedDetails);
      setSecret('');
      if (
        connectedDetails.target.connectionState === 'helper-missing' ||
        connectedDetails.target.connectionState === 'helper-incompatible'
      ) {
        await loadHelperInstall();
      } else {
        setHelperInstall(null);
      }
    } catch (connectionError) {
      setError(remoteConnectionErrorMessage(connectionError));
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      setSummary(await api.disconnectRemoteTarget(executionTargetId));
      setDetails(null);
      setHelperInstall(null);
      setShowHelperInstall(false);
      autoScannedKey.current = null;
    } catch {
      setError('Lumora could not disconnect this remote computer cleanly.');
    } finally {
      setBusy(false);
    }
  };

  const installHelper = async () => {
    if (busy || helperInstall === null) return;
    setBusy(true);
    setError(null);
    try {
      const connectedDetails = await api.installRemoteHelper();
      setSummary({
        target: connectedDetails.target,
        profile: connectedDetails.profile
      });
      setDetails(connectedDetails);
      setHelperInstall(null);
      setShowHelperInstall(false);
    } catch {
      setError('Lumora could not install or start the remote helper.');
    } finally {
      setBusy(false);
    }
  };

  const toggleProvider = (provider: ProviderId, enabled: boolean) => {
    setDraftProviders((current) => canonicalProviders(
      enabled
        ? [...current, provider]
        : current.filter((candidate) => candidate !== provider)
    ));
  };

  const saveProviders = async () => {
    if (savingProviders || draftProviders.length === 0) return;
    setSavingProviders(true);
    try {
      const saved = await api.saveRemoteProviderPreferences({
        enabledProviders: draftProviders
      });
      setPreferences(saved);
      setDraftProviders([...saved.enabledProviders]);
      setSessionCatalog({ state: 'idle' });
      await refreshDiscovery();
    } catch {
      setDiscovery({ state: 'error' });
    } finally {
      setSavingProviders(false);
    }
  };

  const renderOverview = () => (
    <section className="remote-window-panel">
      <dl className="remote-facts">
        <div><dt>Platform</dt><dd>{summary.target.platform}</dd></div>
        <div><dt>Architecture</dt><dd>{summary.target.architecture}</dd></div>
        <div><dt>Home</dt><dd>{details?.homeDirectory ?? 'Detected after connection'}</dd></div>
        <div><dt>Shell</dt><dd>{details?.defaultShell ?? 'Detected after connection'}</dd></div>
      </dl>

      {!trusted && (
        <p className="inline-notice warning">
          Verify this computer in the local Lumora window before authentication.
        </p>
      )}
      {error !== null && <p className="inline-notice error">{error}</p>}

      {!connected && !helperPending && authentication.method === 'password' && (
        <label className="remote-secret-field">
          <span>SSH password</span>
          <input
            autoComplete="off"
            type="password"
            value={secret}
            onChange={(event) => setSecret(event.target.value)}
          />
        </label>
      )}
      {!connected && !helperPending && authentication.method === 'private-key' && (
        <label className="remote-secret-field">
          <span>Private-key passphrase (optional)</span>
          <input
            autoComplete="off"
            type="password"
            value={secret}
            onChange={(event) => setSecret(event.target.value)}
          />
        </label>
      )}

      <div className="remote-window-actions">
        {connected ? (
          <button className="secondary-button" disabled={busy} onClick={() => void disconnect()}>
            {busy ? 'Disconnecting…' : 'Disconnect'}
          </button>
        ) : helperPending ? (
          <>
            <button className="secondary-button" disabled={busy} onClick={() => void disconnect()}>
              Disconnect
            </button>
            <button
              className="refresh-button"
              disabled={busy || helperInstall === null}
              onClick={() => setShowHelperInstall(true)}
            >
              Install Lumora helper
            </button>
          </>
        ) : (
          <button
            className="refresh-button"
            disabled={
              busy || !trusted ||
              (authentication.method === 'password' && secret.length === 0)
            }
            onClick={() => void connect()}
          >
            {busy ? 'Connecting…' : 'Connect'}
          </button>
        )}
      </div>
    </section>
  );

  const renderEnvironment = () => (
    <section className="remote-window-panel">
      <div className="remote-panel-heading">
        <div>
          <p className="card-label">Remote prerequisites</p>
          <h2>Environment</h2>
          <p>Node.js and npm are checked on this remote computer only.</p>
        </div>
        <button
          className="refresh-button"
          disabled={!discoverySupported || discovery.state === 'loading'}
          onClick={() => void refreshDiscovery()}
        >
          {discovery.state === 'loading' ? 'Scanning…' : 'Refresh'}
        </button>
      </div>
      {discovery.state === 'loading' && (
        <p className="remote-discovery-message" aria-live="polite">
          Scanning the remote environment…
        </p>
      )}
      {discovery.state === 'unsupported' && (
        <p className="inline-notice warning">
          This remote helper cannot scan providers yet. Reconnect and update the
          Lumora helper from Overview.
        </p>
      )}
      {discovery.state === 'error' && (
        <p className="inline-notice error">
          Lumora could not scan this remote computer. The SSH connection remains open.
        </p>
      )}
      {discovery.state === 'ready' && (
        <div className="remote-environment-grid">
          <ToolCard displayName="Node.js" command="node" status={discovery.snapshot.environment.node} />
          <ToolCard displayName="npm" command="npm" status={discovery.snapshot.environment.npm} />
        </div>
      )}
    </section>
  );

  const renderProviders = () => (
    <section className="remote-window-panel">
      <div className="remote-panel-heading">
        <div>
          <p className="card-label">Target-scoped selection</p>
          <h2>Providers</h2>
          <p>
            Lumora scans only enabled providers. Install or repair CLIs directly
            on the remote computer.
          </p>
        </div>
        <div className="remote-provider-actions">
          <button
            className="secondary-button"
            disabled={!discoverySupported || discovery.state === 'loading'}
            onClick={() => void refreshDiscovery()}
          >Refresh</button>
          <button
            className="refresh-button"
            disabled={
              !discoverySupported || !providersChanged ||
              savingProviders || draftProviders.length === 0
            }
            onClick={() => void saveProviders()}
          >{savingProviders ? 'Saving…' : 'Save and scan'}</button>
        </div>
      </div>
      {discovery.state === 'unsupported' && (
        <p className="inline-notice warning">
          Provider discovery requires the current Lumora helper. Reconnect this
          target from Overview to update it.
        </p>
      )}
      {discovery.state === 'error' && (
        <p className="inline-notice error">
          Lumora could not scan providers on this remote computer. You can retry
          without reconnecting.
        </p>
      )}
      <div className="remote-provider-grid">
        {PROVIDER_DEFINITIONS.map((provider) => {
          const enabled = draftProviders.includes(provider.provider);
          return (
            <ProviderCard
              enabled={enabled}
              installation={providerResults.get(provider.provider) ?? null}
              key={provider.provider}
              onToggle={toggleProvider}
              onlyEnabled={draftProviders.length === 1}
              provider={provider}
            />
          );
        })}
      </div>
    </section>
  );

  const renderRemoteSettings = () => {
    const categories = [
      { id: 'providers' as const, label: 'Providers' },
      { id: 'environment' as const, label: 'Environment' },
      { id: 'security' as const, label: 'Security' }
    ];
    return (
      <div className="settings-layout">
        <div
          aria-label="Settings categories"
          className="settings-category-tabs"
          role="tablist"
        >
          {categories.map((category) => (
            <button
              aria-controls={`remote-settings-panel-${category.id}`}
              aria-selected={settingsCategory === category.id}
              className="settings-category-tab"
              id={`remote-settings-tab-${category.id}`}
              key={category.id}
              onClick={() => setSettingsCategory(category.id)}
              role="tab"
              tabIndex={settingsCategory === category.id ? 0 : -1}
              type="button"
            >
              {category.label}
            </button>
          ))}
        </div>
        <section
          aria-labelledby={`remote-settings-tab-${settingsCategory}`}
          className="settings-category-panel"
          id={`remote-settings-panel-${settingsCategory}`}
          role="tabpanel"
        >
          {settingsCategory === 'providers'
            ? renderProviders()
            : settingsCategory === 'environment'
              ? renderEnvironment()
              : renderOverview()}
        </section>
      </div>
    );
  };

  if (connected || shellOpened) {
    const activeRoute = REMOTE_ROUTES.find((route) => route.id === page)!;
    const providerScan = discovery.state === 'ready'
      ? discovery.snapshot.providers
      : null;
    const baseCatalogStatus: CatalogViewStatus = sessionCatalog.state === 'ready'
      ? { state: 'ready', snapshot: sessionCatalog.catalog.snapshot }
      : sessionCatalog.state === 'error' || sessionCatalog.state === 'unsupported'
        ? { state: 'error' }
        : { state: 'loading' };
    const filteredCatalogStatus: CatalogViewStatus =
      baseCatalogStatus.state !== 'ready'
        ? baseCatalogStatus
        : {
            state: 'ready',
            snapshot: {
              ...baseCatalogStatus.snapshot,
              sessions: baseCatalogStatus.snapshot.sessions.filter((session) => {
                if (sessionProvider !== null && session.provider !== sessionProvider) {
                  return false;
                }
                const query = sessionSearch.trim().toLocaleLowerCase();
                if (query.length === 0) return true;
                const workspace = baseCatalogStatus.snapshot.workspaces.find(
                  (candidate) => candidate.id === session.workspaceId
                );
                return [
                  session.title,
                  workspace?.displayName ?? '',
                  workspace?.canonicalPath ?? ''
                ].some((value) => value.toLocaleLowerCase().includes(query));
              })
            }
          };
    const main = page === 'home' ? (
      <CatalogHomeSummary
        profiles={[]}
        providerScan={providerScan}
        providerSummary={
          providerScan === null
            ? 'Scanning remote providers'
            : `${providerScan.providers.filter((provider) => provider.state === 'ready').length} of ${providerScan.providers.length} providers ready`
        }
        status={baseCatalogStatus}
      />
    ) : page === 'workspaces' ? (
      selectedWorkspaceId === null ? (
        <WorkspacesView
          isRefreshing={sessionCatalog.state === 'loading'}
          onOpenWorkspace={setSelectedWorkspaceId}
          onRefresh={() => void refreshSessions()}
          scopeLabel="Remote provider folders"
          status={baseCatalogStatus}
        />
      ) : (
        <WorkspaceSessionsView
          isRefreshing={sessionCatalog.state === 'loading'}
          onBack={() => setSelectedWorkspaceId(null)}
          onRefresh={() => void refreshSessions()}
          onRetry={() => void refreshSessions()}
          operationError={null}
          profiles={[]}
          providerScan={providerScan}
          status={baseCatalogStatus}
          workspaceId={selectedWorkspaceId}
        />
      )
    ) : page === 'sessions' ? (
      <SessionsView
        dismissedDiagnosticIds={dismissedDiagnostics}
        isRefreshing={sessionCatalog.state === 'loading'}
        onDismissDiagnostic={(identity) => setDismissedDiagnostics((current) => {
          const next = new Set(current);
          next.add(identity);
          return next;
        })}
        onProviderChange={setSessionProvider}
        onRefresh={() => void refreshSessions()}
        onSearchChange={setSessionSearch}
        profiles={[]}
        provider={sessionProvider}
        providerScan={providerScan}
        queryText={sessionSearch}
        showInformationalNotices
        status={filteredCatalogStatus}
      />
    ) : renderRemoteSettings();

    return (
      <LumoraShell
        activeRouteId={page}
        appearance={appearance}
        banner={!connected ? (
          <section className="remote-reconnect-banner" role="alert">
            <div>
              <strong>The connection to this remote computer was lost.</strong>
              <span>Your current page and cached catalog remain available.</span>
            </div>
            <button
              className="refresh-button"
              onClick={() => {
                setError(null);
                setShellOpened(false);
              }}
              type="button"
            >Reconnect</button>
          </section>
        ) : null}
        main={<div className="route-surface">{main}</div>}
        onNavigate={(route) => {
          setPage(route);
          if (route !== 'workspaces') setSelectedWorkspaceId(null);
        }}
        onToggleSidebar={() => setSidebarExpanded((current) => !current)}
        pageHeader={{
          description: activeRoute.description,
          eyebrow: activeRoute.eyebrow,
          label: activeRoute.label
        }}
        primaryNavigation={{
          ariaLabel: 'Primary navigation',
          label: 'Remote',
          routes: REMOTE_ROUTES
        }}
        sidebarExpanded={sidebarExpanded}
        statusBar={
          <footer className="status-bar" role="status" aria-live="polite">
            <div className="status-cluster">
              <span className="status-item status-ready">
                <span className="status-dot" aria-hidden="true" />
                {summary.target.platform} · {summary.target.architecture}
              </span>
              <span className="status-item">{summary.target.displayName}</span>
            </div>
            <div className="status-cluster status-cluster-secondary">
              <span className="status-item">Remote read-only catalog</span>
              <span className="status-divider" aria-hidden="true" />
              <span className="status-item">
                {connected ? 'SSH helper connected' : 'Connection unavailable'}
              </span>
            </div>
          </footer>
        }
        topbar={{
          context: endpoint(summary),
          kicker: 'Remote Lumora',
          actions: (
            connected ? (
              <button
                className="secondary-button"
                disabled={busy}
                onClick={() => void disconnect()}
                type="button"
              >
                {busy ? 'Disconnecting…' : 'Disconnect'}
              </button>
            ) : undefined
          )
        }}
      />
    );
  }

  return (
    <main className="remote-window-shell">
      <section className="remote-window-card">
        <header className="remote-window-header">
          <div>
            <p className="eyebrow">Remote Lumora · isolated target</p>
            <h1>{summary.target.displayName}</h1>
            <p>{endpoint(summary)}</p>
          </div>
          <span className={`remote-state state-${summary.target.connectionState}`}>
            {summary.target.connectionState}
          </span>
        </header>

        {renderOverview()}

        <footer className="remote-phase-note">
          Environment, providers, and session metadata stay isolated to this target.
          Remote terminals arrive in a later phase.
        </footer>
      </section>
      {showHelperInstall && helperInstall !== null && (
        <div className="dialog-backdrop" role="presentation">
          <section
            aria-label="Install Lumora helper"
            aria-modal="true"
            className="new-session-dialog remote-helper-install-dialog"
            role="dialog"
          >
            <header>
              <div>
                <p className="card-label">Remote helper</p>
                <h2>Install Lumora helper</h2>
              </div>
              <button
                aria-label="Close helper installation"
                className="text-button"
                disabled={busy}
                onClick={() => setShowHelperInstall(false)}
                type="button"
              >Close</button>
            </header>
            <div className="dialog-body remote-helper-dialog-body">
              <p>
                Lumora will install its lightweight helper for your account on
                <strong> {summary.target.displayName}</strong>. Administrator access is not required.
              </p>
              <dl className="remote-helper-install-facts">
                <div><dt>Version</dt><dd>{helperInstall.helperVersion}</dd></div>
                <div><dt>Location</dt><dd>{helperInstall.installLocation}</dd></div>
              </dl>
              {helperInstall.status === 'invalid' && (
                <p className="inline-notice warning">
                  The existing helper is invalid and will be replaced only after
                  the new copy has been verified.
                </p>
              )}
            </div>
            <footer className="modal-actions">
              <button
                className="secondary-button"
                disabled={busy}
                onClick={() => setShowHelperInstall(false)}
              >Cancel</button>
              <button
                className="refresh-button"
                disabled={busy}
                onClick={() => void installHelper()}
              >{busy ? 'Installing…' : 'Install helper'}</button>
            </footer>
          </section>
        </div>
      )}
    </main>
  );
}
