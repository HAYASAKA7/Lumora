import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode
} from 'react';

import type {
  DeveloperToolStatus,
  GeneralSettings,
  KeyboardSettings,
  LaunchPreview,
  LumoraApi,
  ProviderId,
  RemoteCredentialStatus,
  RemoteDiscoverySnapshot,
  RemoteHelperInstallDetails,
  RemoteLifecycleSnapshot,
  RemoteExecutionTargetId,
  RemoteProviderPreferences,
  RemoteWindowCloseRequest,
  RemoteSessionCatalog,
  RemoteTargetConnectionDetails,
  RemoteTargetCredentials,
  RemoteTargetSummary,
  RuntimeSummary,
  SessionSummary,
  TerminalProfile,
  WorkspaceSummary,
  WorkspaceVisibilityMode,
  WorkspaceVisibilityPolicy
} from '../../../shared/contracts';
import {
  DEFAULT_GENERAL_SETTINGS,
  DEFAULT_KEYBOARD_SETTINGS
} from '../../../shared/contracts';
import { PROVIDER_DEFINITIONS } from '../../../shared/provider-definitions';
import {
  CatalogHomeSummary,
  SessionsView,
  WorkspacesView,
  type CatalogViewStatus
} from '../catalog/CatalogViews';
import { WorkspaceSessionsView } from '../catalog/WorkspaceSessionsView';
import { HiddenWorkspacesDialog } from '../catalog/HiddenWorkspacesDialog';
import { HideWorkspaceDialog } from '../catalog/HideWorkspaceDialog';
import { projectCatalogVisibility } from '../catalog/catalog-visibility';
import { terminalThemeFor } from '../appearance/theme';
import { LaunchSettingsPanel } from '../settings/LaunchSettingsPanel';
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
import { NewSessionDialog } from '../terminal/NewSessionDialog';
import { ResumeSessionDialog } from '../terminal/ResumeSessionDialog';
import { TerminalWorkspace } from '../terminal/TerminalWorkspace';
import { indexLiveSessionRuntimes } from '../terminal/live-session-runtime';
import {
  formatShortcutChord,
  keyboardEventMatchesChord
} from '../keyboard/shortcut';
import { ProviderSettings } from '../providers/ProviderSettings';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { GeneralSettingsPanel } from '../settings/GeneralSettingsPanel';
import { AboutPanel } from '../settings/AboutPanel';

interface RemoteTargetWindowProps {
  executionTargetId: RemoteExecutionTargetId;
  api?: LumoraApi;
  appearance?: LumoraShellAppearance;
}

type RemotePage = 'home' | 'workspaces' | 'sessions' | 'settings';
type RemoteSettingsCategory =
  | 'general'
  | 'providers'
  | 'environment'
  | 'launch'
  | 'security'
  | 'about';
interface NewSessionIntent {
  initialWorkspaceId: string | null;
}
interface ResumeIntent {
  session: SessionSummary;
  workspace: WorkspaceSummary;
}
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

function normalizeRemoteGeneralSettings(
  settings: GeneralSettings
): GeneralSettings {
  return {
    ...DEFAULT_GENERAL_SETTINGS,
    ...settings,
    appearance: {
      ...DEFAULT_GENERAL_SETTINGS.appearance,
      ...settings.appearance
    }
  };
}

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
    description: 'Search and resume provider-owned sessions from this computer.'
  },
  {
    id: 'settings', label: 'Settings', icon: 'settings',
    eyebrow: 'Remote settings',
    description: 'Configure target-scoped providers and inspect this connection.'
  }
] as const;

const REMOTE_PRIMARY_ROUTES = REMOTE_ROUTES.filter(
  (route) => route.id !== 'settings'
);
const REMOTE_SETTINGS_ROUTE = REMOTE_ROUTES.find(
  (route) => route.id === 'settings'
)!;

const TOOL_STATE_LABELS: Record<DeveloperToolStatus['state'], string> = {
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
  REMOTE_TARGET_CREDENTIAL_REQUIRED:
    'Lumora needs the SSH credential again. Enter it below to reconnect manually.',
  REMOTE_TARGET_CREDENTIAL_UNAVAILABLE:
    'The remembered SSH credential is unavailable. Enter it below to reconnect manually.',
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
  const [workspaceVisibilityPolicies, setWorkspaceVisibilityPolicies] =
    useState<readonly WorkspaceVisibilityPolicy[] | null | undefined>(undefined);
  const [workspaceVisibilityBusy, setWorkspaceVisibilityBusy] = useState(false);
  const [workspaceVisibilityError, setWorkspaceVisibilityError] =
    useState<string | null>(null);
  const [hideWorkspaceIntent, setHideWorkspaceIntent] =
    useState<WorkspaceSummary | null>(null);
  const [hiddenWorkspacesOpen, setHiddenWorkspacesOpen] = useState(false);
  const [secret, setSecret] = useState('');
  const [credentialStatus, setCredentialStatus] =
    useState<RemoteCredentialStatus | null>(null);
  const [rememberCredential, setRememberCredential] = useState(false);
  const [autoConnectDraft, setAutoConnectDraft] = useState(false);
  const [autoConnectOnOpen, setAutoConnectOnOpen] = useState<boolean | null>(null);
  const [credentialPreferenceBusy, setCredentialPreferenceBusy] = useState(false);
  const [busy, setBusy] = useState(false);
  const [automaticConnectionPending, setAutomaticConnectionPending] = useState(false);
  const [savingProviders, setSavingProviders] = useState(false);
  const [providerSaveError, setProviderSaveError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [shellOpened, setShellOpened] = useState(false);
  const [terminalProfiles, setTerminalProfiles] = useState<TerminalProfile[]>([]);
  const [generalSettings, setGeneralSettings] = useState<GeneralSettings>({
    ...DEFAULT_GENERAL_SETTINGS,
    crossAgentWorkflowEnabled: false
  });
  const [generalSettingsSaving, setGeneralSettingsSaving] = useState(false);
  const [generalSettingsSaveError, setGeneralSettingsSaveError] =
    useState<string | null>(null);
  const [keyboardSettings, setKeyboardSettings] = useState<KeyboardSettings>(
    DEFAULT_KEYBOARD_SETTINGS
  );
  const [runtimes, setRuntimes] = useState<RuntimeSummary[]>([]);
  const [openRuntimeIds, setOpenRuntimeIds] = useState<string[]>([]);
  const [activeRuntimeId, setActiveRuntimeId] = useState<string | null>(null);
  const [launchPreviews, setLaunchPreviews] = useState(
    () => new Map<string, LaunchPreview>()
  );
  const [terminalFocusRequestKey, setTerminalFocusRequestKey] = useState(0);
  const [newSessionIntent, setNewSessionIntent] =
    useState<NewSessionIntent | null>(null);
  const [resumeIntent, setResumeIntent] = useState<ResumeIntent | null>(null);
  const [windowCloseRequest, setWindowCloseRequest] =
    useState<RemoteWindowCloseRequest | null>(null);
  const [suppressRemoteDisconnectWarning, setSuppressRemoteDisconnectWarning] =
    useState(false);
  const autoScannedKey = useRef<string | null>(null);
  const automaticConnectionAttempted = useRef(false);
  const componentMounted = useRef(false);
  const generalSettingsRequestId = useRef(0);

  useEffect(() => {
    componentMounted.current = true;
    return () => {
      componentMounted.current = false;
    };
  }, []);

  const applyLifecycleSnapshot = useCallback((
    snapshot: RemoteLifecycleSnapshot
  ) => {
    setSummary(snapshot.summary);
    if (snapshot.discovery !== null) {
      setDiscovery({ state: 'ready', snapshot: snapshot.discovery });
    } else if (snapshot.discoveryState === 'refreshing') {
      setDiscovery({ state: 'loading' });
    } else if (snapshot.discoveryState === 'error') {
      setDiscovery({ state: 'error' });
    }
    if (snapshot.catalog !== null) {
      setSessionCatalog({ state: 'ready', catalog: snapshot.catalog });
    } else if (snapshot.catalogState === 'refreshing') {
      setSessionCatalog({ state: 'loading' });
    } else if (snapshot.catalogState === 'error') {
      setSessionCatalog({ state: 'error' });
    }
  }, []);

  useEffect(() => {
    writeSidebarExpanded(window, sidebarExpanded);
  }, [sidebarExpanded]);

  useEffect(() => {
    if (typeof api.onRemoteWindowCloseRequest !== 'function') return;
    return api.onRemoteWindowCloseRequest((request) => {
      if (request.executionTargetId === executionTargetId) {
        setSuppressRemoteDisconnectWarning(false);
        setWindowCloseRequest(request);
      }
    });
  }, [api, executionTargetId]);

  const resolveWindowClose = useCallback(async (
    action: 'keep_running' | 'disconnect'
  ) => {
    if (typeof api.resolveRemoteWindowClose !== 'function') return;
    try {
      const closed = await api.resolveRemoteWindowClose({
        action,
        suppressFutureWarning: action === 'disconnect' &&
          suppressRemoteDisconnectWarning
      });
      if (!closed) setWindowCloseRequest(null);
    } catch {
      setError('Lumora could not close this remote connection safely.');
    }
  }, [api, suppressRemoteDisconnectWarning]);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        if (typeof api.listRemoteLifecycleSnapshots === 'function') {
          const snapshots = await api.listRemoteLifecycleSnapshots();
          if (!active) return;
          const lifecycle = snapshots.find(
            ({ summary: item }) => item.target.id === executionTargetId
          );
          if (lifecycle !== undefined) {
            applyLifecycleSnapshot(lifecycle);
            setError(null);
            return;
          }
        }
        const targets = await api.listRemoteTargets();
        if (!active) return;
        const current = targets.find(
          ({ target }) => target.id === executionTargetId
        ) ?? null;
        setSummary(current);
        setError(current === null ? 'This remote target is unavailable.' : null);
      } catch {
        if (active) setError('Lumora could not load this remote target.');
      }
    })();
    return () => { active = false; };
  }, [api, applyLifecycleSnapshot, executionTargetId]);

  useEffect(() => {
    if (typeof api.onRemoteLifecycleEvent !== 'function') return;
    return api.onRemoteLifecycleEvent((event) => {
      if (event.executionTargetId === executionTargetId) {
        applyLifecycleSnapshot(event.snapshot);
      }
    });
  }, [api, applyLifecycleSnapshot, executionTargetId]);

  useEffect(() => {
    if (typeof api.getRemoteCredentialStatus !== 'function') return;
    let active = true;
    void api.getRemoteCredentialStatus(executionTargetId).then(
      (status) => {
        if (!active) return;
        setCredentialStatus(status);
        setRememberCredential(status.credentialState === 'remembered');
        setAutoConnectDraft(status.autoConnect);
        setAutoConnectOnOpen((current) => current ?? status.autoConnect);
      },
      () => {
        if (!active) return;
        setCredentialStatus({
          executionTargetId,
          storageState: 'temporarily-unavailable',
          credentialState: 'needs-attention',
          autoConnect: false
        });
      }
    );
    return () => { active = false; };
  }, [api, executionTargetId]);

  const applyConnectedDetails = useCallback(async (
    connectedDetails: RemoteTargetConnectionDetails
  ) => {
    if (!componentMounted.current) return;
    setSummary({
      target: connectedDetails.target,
      profile: connectedDetails.profile
    });
    setDetails(connectedDetails);
    setSecret('');
    if (
      connectedDetails.target.connectionState !== 'helper-missing' &&
      connectedDetails.target.connectionState !== 'helper-incompatible'
    ) {
      setHelperInstall(null);
      return;
    }

    try {
      const install = await api.getRemoteHelperInstallDetails();
      if (componentMounted.current) setHelperInstall(install);
    } catch {
      if (!componentMounted.current) return;
      setHelperInstall(null);
      setError('Lumora could not inspect the remote helper installation.');
    }
  }, [api]);

  useEffect(() => {
    const eligible =
      summary !== null &&
      autoConnectOnOpen === true &&
      summary.profile.verifiedHostFingerprint !== null &&
      summary.target.connectionState !== 'ready' &&
      summary.target.connectionState !== 'helper-missing' &&
      summary.target.connectionState !== 'helper-incompatible';
    if (
      automaticConnectionAttempted.current ||
      !eligible
    ) return;

    automaticConnectionAttempted.current = true;
    setAutomaticConnectionPending(true);
    setBusy(true);
    setError(null);
    void api.connectRemoteTarget({ executionTargetId, mode: 'automatic' }).then(
      (connectedDetails) => {
        if (!componentMounted.current) return;
        return applyConnectedDetails(connectedDetails);
      },
      (connectionError) => {
        if (componentMounted.current) {
          setError(remoteConnectionErrorMessage(connectionError));
        }
      }
    ).finally(() => {
      if (componentMounted.current) {
        setAutomaticConnectionPending(false);
        setBusy(false);
      }
    });
  }, [api, applyConnectedDetails, autoConnectOnOpen, executionTargetId, summary]);

  const refreshDiscovery = useCallback(async () => {
    setDiscovery({ state: 'loading' });
    try {
      const snapshot = await api.scanRemoteDiscovery();
      setDiscovery({ state: 'ready', snapshot });
    } catch {
      setDiscovery({ state: 'error' });
    }
  }, [api]);

  const loadRemoteState = useCallback(async (
    supported: boolean,
    scanDiscovery: boolean
  ) => {
    if (scanDiscovery) {
      setDiscovery(supported ? { state: 'loading' } : { state: 'unsupported' });
    }
    try {
      const nextPreferences = await api.getRemoteProviderPreferences();
      setPreferences(nextPreferences);
      setDraftProviders([...nextPreferences.enabledProviders]);
      if (supported && scanDiscovery) {
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
    void loadRemoteState(
      summary.target.capabilities.includes('provider-scan'),
      discovery.state !== 'ready'
    );
  }, [discovery.state, loadRemoteState, summary]);

  useEffect(() => {
    if (
      !['home', 'workspaces', 'sessions'].includes(page) ||
      summary?.target.connectionState !== 'ready'
    ) return;
    if (sessionCatalog.state !== 'idle') return;
    if (
      summary.target.capabilities.includes('provider-scan') &&
      (discovery.state === 'idle' || discovery.state === 'loading')
    ) return;
    if (!summary.target.capabilities.includes('session-scan')) {
      setSessionCatalog({ state: 'unsupported' });
      return;
    }
    void refreshSessions();
  }, [discovery.state, page, refreshSessions, sessionCatalog.state, summary]);

  useEffect(() => {
    if (summary?.target.connectionState === 'ready') setShellOpened(true);
  }, [summary?.target.connectionState]);

  const updateRuntime = useCallback((runtime: RuntimeSummary) => {
    setRuntimes((current) => {
      const existing = current.findIndex((item) => item.id === runtime.id);
      if (existing === -1) return [runtime, ...current];
      const next = [...current];
      next[existing] = runtime;
      return next;
    });
  }, []);

  const activateRuntime = useCallback((runtimeId: string) => {
    setOpenRuntimeIds((current) =>
      current.includes(runtimeId) ? current : [...current, runtimeId]
    );
    setActiveRuntimeId(runtimeId);
  }, []);

  const liveRuntimeBySessionId = useMemo(
    () => indexLiveSessionRuntimes(runtimes),
    [runtimes]
  );
  const runningSessionIds = useMemo(
    () => new Set(liveRuntimeBySessionId.keys()),
    [liveRuntimeBySessionId]
  );

  const closeRuntimeTab = useCallback((runtimeId: string) => {
    setOpenRuntimeIds((current) => {
      const next = current.filter((id) => id !== runtimeId);
      setActiveRuntimeId((active) =>
        active === runtimeId ? (next[0] ?? null) : active
      );
      return next;
    });
  }, []);

  const openLiveTerminals = useCallback(() => {
    const liveIds = runtimes
      .filter((runtime) =>
        runtime.state === 'launching' || runtime.state === 'running'
      )
      .map((runtime) => runtime.id);
    if (liveIds.length === 0) return;
    setOpenRuntimeIds((current) => [
      ...current,
      ...liveIds.filter((id) => !current.includes(id))
    ]);
    setActiveRuntimeId((current) =>
      current !== null && liveIds.includes(current) ? current : liveIds[0]!
    );
    setTerminalFocusRequestKey((current) => current + 1);
  }, [runtimes]);

  useEffect(() => {
    if (summary?.target.connectionState !== 'ready') return;
    let active = true;
    if (typeof api.getWorkspaceVisibilityPolicies !== 'function') {
      setWorkspaceVisibilityPolicies([]);
      return;
    }
    void api.getWorkspaceVisibilityPolicies().then(
      (policies) => {
        if (active) setWorkspaceVisibilityPolicies(policies);
      },
      () => {
        if (active) setWorkspaceVisibilityPolicies(null);
      }
    );
    return () => {
      active = false;
    };
  }, [api, summary?.target.connectionState]);

  useEffect(() => {
    if (summary?.target.connectionState !== 'ready') return;
    if (
      typeof api.getTerminalProfiles !== 'function' ||
      typeof api.listRuntimes !== 'function' ||
      typeof api.getGeneralSettings !== 'function' ||
      typeof api.onRuntimeEvent !== 'function'
    ) return;
    let active = true;
    const settingsRequest = ++generalSettingsRequestId.current;
    void Promise.all([
      api.getTerminalProfiles(),
      api.listRuntimes(),
      api.getGeneralSettings(),
      typeof api.getKeyboardSettings === 'function'
        ? api.getKeyboardSettings()
        : Promise.resolve(DEFAULT_KEYBOARD_SETTINGS)
    ]).then(
      ([profiles, runtimeValues, settings, shortcuts]) => {
        if (!active) return;
        setTerminalProfiles(profiles);
        if (settingsRequest === generalSettingsRequestId.current) {
          setGeneralSettings(normalizeRemoteGeneralSettings(settings));
        }
        setKeyboardSettings(shortcuts);
        setRuntimes(runtimeValues);
        const liveIds = runtimeValues
          .filter((runtime) =>
            runtime.state === 'launching' || runtime.state === 'running'
          )
          .map((runtime) => runtime.id);
        setOpenRuntimeIds(liveIds);
        setActiveRuntimeId((current) =>
          current !== null && liveIds.includes(current)
            ? current
            : (liveIds[0] ?? null)
        );
      },
      () => {
        if (active) {
          setError('Lumora could not load the remote terminal runtime.');
        }
      }
    );
    const unsubscribe = api.onRuntimeEvent((event) => {
      if (event.type !== 'state') return;
      updateRuntime(event.runtime);
      if (
        event.runtime.state === 'completed' ||
        event.runtime.state === 'failed' ||
        event.runtime.state === 'runtime_lost'
      ) {
        closeRuntimeTab(event.runtimeId);
        void refreshSessions();
      }
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [
    api,
    closeRuntimeTab,
    refreshSessions,
    summary?.target.connectionState,
    updateRuntime
  ]);

  useEffect(() => {
    if (
      typeof api.getGeneralSettings !== 'function' ||
      typeof api.onGeneralSettingsChanged !== 'function'
    ) return;
    let active = true;
    const unsubscribe = api.onGeneralSettingsChanged(() => {
      const request = ++generalSettingsRequestId.current;
      void api.getGeneralSettings().then(
        (settings) => {
          if (active && request === generalSettingsRequestId.current) {
            setGeneralSettings(normalizeRemoteGeneralSettings(settings));
          }
        },
        () => undefined
      );
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [api]);

  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (
        event.target instanceof Element &&
        event.target.closest('.shortcut-recorder[aria-pressed="true"]') !== null
      ) return;
      if (event.repeat) return;

      if (keyboardEventMatchesChord(event, keyboardSettings.toggleSidebar)) {
        event.preventDefault();
        event.stopPropagation();
        setSidebarExpanded((current) => !current);
        return;
      }
      if (keyboardEventMatchesChord(event, keyboardSettings.openTerminals)) {
        const hasLiveRuntime = runtimes.some((runtime) =>
          runtime.state === 'launching' || runtime.state === 'running'
        );
        if (!hasLiveRuntime) return;
        event.preventDefault();
        event.stopPropagation();
        openLiveTerminals();
        return;
      }
      if (keyboardEventMatchesChord(event, keyboardSettings.terminalSwitcher)) {
        if (activeRuntimeId === null || openRuntimeIds.length === 0) return;
        event.preventDefault();
        event.stopPropagation();
        const currentIndex = activeRuntimeId === null
          ? -1
          : openRuntimeIds.indexOf(activeRuntimeId);
        activateRuntime(
          openRuntimeIds[(currentIndex + 1) % openRuntimeIds.length]!
        );
        setTerminalFocusRequestKey((current) => current + 1);
        return;
      }

      const routeShortcuts: ReadonlyArray<
        readonly [KeyboardSettings['openHome'], RemotePage, RemoteSettingsCategory?]
      > = [
        [keyboardSettings.openHome, 'home'],
        [keyboardSettings.openWorkspaces, 'workspaces'],
        [keyboardSettings.openSessions, 'sessions'],
        [keyboardSettings.openProfiles, 'settings', 'launch'],
        [keyboardSettings.openSettings, 'settings', 'providers']
      ];
      const destination = routeShortcuts.find(([shortcut]) =>
        keyboardEventMatchesChord(event, shortcut)
      );
      if (destination === undefined) return;
      event.preventDefault();
      event.stopPropagation();
      setPage(destination[1]);
      setActiveRuntimeId(null);
      setSelectedWorkspaceId(null);
      if (destination[2] !== undefined) setSettingsCategory(destination[2]);
    };

    window.addEventListener('keydown', keydown, true);
    return () => window.removeEventListener('keydown', keydown, true);
  }, [
    activeRuntimeId,
    activateRuntime,
    keyboardSettings,
    openLiveTerminals,
    openRuntimeIds,
    runtimes
  ]);

  const handleRuntimeStarted = useCallback((
    runtime: RuntimeSummary,
    preview: LaunchPreview
  ) => {
    updateRuntime(runtime);
    setLaunchPreviews((current) => {
      const next = new Map(current);
      next.set(runtime.id, preview);
      return next;
    });
    activateRuntime(runtime.id);
    setNewSessionIntent(null);
    setResumeIntent(null);
    setTerminalFocusRequestKey((current) => current + 1);
  }, [activateRuntime, updateRuntime]);

  const reorderRuntimeTab = useCallback((
    runtimeId: string,
    destinationIndex: number
  ) => {
    setOpenRuntimeIds((current) => {
      const sourceIndex = current.indexOf(runtimeId);
      if (
        sourceIndex === -1 ||
        destinationIndex < 0 ||
        destinationIndex >= current.length ||
        sourceIndex === destinationIndex
      ) return current;
      const next = [...current];
      next.splice(sourceIndex, 1);
      next.splice(destinationIndex, 0, runtimeId);
      return next;
    });
  }, []);

  const providerScan = discovery.state === 'ready'
    ? discovery.snapshot.providers
    : null;
  const baseCatalogStatus: CatalogViewStatus = sessionCatalog.state === 'ready'
    ? { state: 'ready', snapshot: sessionCatalog.catalog.snapshot }
    : sessionCatalog.state === 'error' || sessionCatalog.state === 'unsupported'
      ? { state: 'error' }
      : { state: 'loading' };
  const visibilityCatalogStatus: CatalogViewStatus =
    baseCatalogStatus.state === 'ready' && workspaceVisibilityPolicies === undefined
      ? { state: 'loading' }
      : baseCatalogStatus;
  const catalogPresentation = useMemo(() =>
    baseCatalogStatus.state === 'ready' && workspaceVisibilityPolicies !== undefined
      ? projectCatalogVisibility({
          snapshot: baseCatalogStatus.snapshot,
          policies: workspaceVisibilityPolicies,
          settings: generalSettings,
          providerScan,
          profiles: terminalProfiles,
          query: { text: sessionSearch, provider: sessionProvider }
        })
      : null,
  [
    baseCatalogStatus,
    generalSettings,
    providerScan,
    sessionProvider,
    sessionSearch,
    terminalProfiles,
    workspaceVisibilityPolicies
  ]);
  const workspaceCatalogPresentation = useMemo(() =>
    baseCatalogStatus.state === 'ready' && workspaceVisibilityPolicies !== undefined
      ? projectCatalogVisibility({
          snapshot: baseCatalogStatus.snapshot,
          policies: workspaceVisibilityPolicies,
          settings: generalSettings,
          providerScan,
          profiles: terminalProfiles,
          query: { text: '', provider: null }
        })
      : null,
  [
    baseCatalogStatus,
    generalSettings,
    providerScan,
    terminalProfiles,
    workspaceVisibilityPolicies
  ]);
  const visibleCatalogStatus: CatalogViewStatus = catalogPresentation === null
    ? visibilityCatalogStatus
    : { state: 'ready', snapshot: catalogPresentation.snapshot };
  const visibleWorkspaceCatalogStatus: CatalogViewStatus =
    workspaceCatalogPresentation === null
      ? visibilityCatalogStatus
      : { state: 'ready', snapshot: workspaceCatalogPresentation.snapshot };

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

  const automaticConnectionEligible =
    autoConnectOnOpen === true &&
    summary.profile.verifiedHostFingerprint !== null &&
    summary.target.connectionState !== 'ready' &&
    summary.target.connectionState !== 'helper-missing' &&
    summary.target.connectionState !== 'helper-incompatible';
  const showAutomaticConnecting = automaticConnectionPending || (
    !automaticConnectionAttempted.current && automaticConnectionEligible
  );

  const credentialStatusLoading =
    typeof api.getRemoteCredentialStatus === 'function' &&
    credentialStatus === null;

  if (credentialStatusLoading || showAutomaticConnecting) {
    return (
      <main className="remote-window-shell">
        <section className="remote-window-card" aria-live="polite">
          <p className="eyebrow">Remote Lumora</p>
          <h1>
            {showAutomaticConnecting
              ? `Connecting to ${summary.target.displayName}`
              : `Preparing ${summary.target.displayName}`}
          </h1>
          <p>
            {showAutomaticConnecting
              ? 'Establishing the remembered SSH connection…'
              : 'Checking secure connection preferences…'}
          </p>
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

  const changeRememberCredential = async (enabled: boolean) => {
    if (credentialPreferenceBusy) return;
    if (enabled) {
      setRememberCredential(true);
      return;
    }

    setRememberCredential(false);
    if (credentialStatus?.credentialState !== 'remembered' ||
        typeof api.forgetRemoteCredential !== 'function') return;
    setCredentialPreferenceBusy(true);
    setError(null);
    try {
      const status = await api.forgetRemoteCredential(executionTargetId);
      setCredentialStatus(status);
      setAutoConnectDraft(status.autoConnect);
    } catch {
      setRememberCredential(true);
      setError('Lumora could not forget the remembered SSH credential.');
    } finally {
      setCredentialPreferenceBusy(false);
    }
  };

  const changeAutoConnect = async (enabled: boolean) => {
    if (credentialPreferenceBusy) return;
    setAutoConnectDraft(enabled);

    const awaitsManualCredential = authentication.method === 'password' &&
      credentialStatus?.credentialState !== 'remembered';
    if (enabled && awaitsManualCredential) return;
    if (typeof api.setRemoteAutoConnect !== 'function') return;

    setCredentialPreferenceBusy(true);
    setError(null);
    try {
      const status = await api.setRemoteAutoConnect(executionTargetId, enabled);
      setCredentialStatus(status);
      setAutoConnectDraft(status.autoConnect);
    } catch {
      setAutoConnectDraft(!enabled);
      setError('Lumora could not update automatic connection for this profile.');
    } finally {
      setCredentialPreferenceBusy(false);
    }
  };

  const syncCredentialPreferencesAfterConnection = () => {
    if (autoConnectDraft && typeof api.setRemoteAutoConnect === 'function') {
      void api.setRemoteAutoConnect(executionTargetId, true).then(
        (status) => {
          setCredentialStatus(status);
          setRememberCredential(status.credentialState === 'remembered');
          setAutoConnectDraft(status.autoConnect);
        },
        () => {
          setAutoConnectDraft(false);
          setError(
            'The SSH connection succeeded, but automatic connection could not be enabled.'
          );
        }
      );
      return;
    }

    if (typeof api.getRemoteCredentialStatus !== 'function') return;
    void api.getRemoteCredentialStatus(executionTargetId).then(
      (status) => {
        setCredentialStatus(status);
        setRememberCredential(status.credentialState === 'remembered');
      },
      () => {
        // A valid SSH connection remains usable when the OS vault is unavailable.
      }
    );
  };

  const connect = async () => {
    if (!trusted || busy) return;
    setBusy(true);
    setError(null);
    try {
      const usesRememberedCredential =
        authentication.method !== 'agent' &&
        secret.length === 0 &&
        credentialStatus?.credentialState === 'remembered';
      const connectedDetails = await api.connectRemoteTarget(
        usesRememberedCredential
          ? { executionTargetId, mode: 'remembered' }
          : {
              executionTargetId,
              mode: 'manual',
              credentials: credentials(),
              rememberCredential
            }
        );
      await applyConnectedDetails(connectedDetails);
      syncCredentialPreferencesAfterConnection();
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

  const saveProviders = async (
    providers: readonly ProviderId[]
  ): Promise<boolean> => {
    if (savingProviders || providers.length === 0) return false;
    setSavingProviders(true);
    setProviderSaveError(null);
    try {
      const saved = await api.saveRemoteProviderPreferences({
        enabledProviders: canonicalProviders(providers)
      });
      setPreferences(saved);
      setDraftProviders([...saved.enabledProviders]);
      setSessionCatalog({ state: 'idle' });
      await refreshDiscovery();
      return true;
    } catch {
      setProviderSaveError('The remote provider selection could not be saved.');
      return false;
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

      {!connected && !helperPending && credentialStatus !== null && (
        <div className="remote-connection-options">
          {authentication.method !== 'agent' && (
            <label className="remote-connection-option">
              <span>
                <strong>
                  {authentication.method === 'password'
                    ? 'Remember password'
                    : 'Remember passphrase'}
                </strong>
                <small>
                  Protect this credential with the operating system's secure storage.
                </small>
              </span>
              <span className="settings-switch">
                <input
                  aria-label={authentication.method === 'password'
                    ? 'Remember password'
                    : 'Remember passphrase'}
                  checked={rememberCredential}
                  disabled={
                    credentialPreferenceBusy ||
                    (credentialStatus.storageState !== 'available' &&
                      !rememberCredential)
                  }
                  role="switch"
                  type="checkbox"
                  onChange={(event) => {
                    void changeRememberCredential(event.target.checked);
                  }}
                />
                <span aria-hidden="true" className="settings-switch-track">
                  <span className="settings-switch-thumb" />
                </span>
              </span>
            </label>
          )}
          <label className="remote-connection-option">
            <span>
              <strong>Connect automatically</strong>
              <small>Attempt this profile once when its remote Lumora window opens.</small>
            </span>
            <span className="settings-switch">
              <input
                aria-label="Connect automatically"
                checked={autoConnectDraft}
                disabled={
                  credentialPreferenceBusy ||
                  (authentication.method === 'password' &&
                    credentialStatus.credentialState !== 'remembered' &&
                    !(rememberCredential && secret.length > 0))
                }
                role="switch"
                type="checkbox"
                onChange={(event) => {
                  void changeAutoConnect(event.target.checked);
                }}
              />
              <span aria-hidden="true" className="settings-switch-track">
                <span className="settings-switch-thumb" />
              </span>
            </span>
          </label>
          {credentialStatus.storageState !== 'available' &&
            authentication.method !== 'agent' && (
              <p className="remote-credential-help">
                Secure credential storage is unavailable. Lumora will keep this
                credential in memory for the current connection only.
              </p>
            )}
        </div>
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
              (authentication.method === 'password' &&
                secret.length === 0 &&
                credentialStatus?.credentialState !== 'remembered')
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
    <ProviderSettings
      api={api}
      generalSettings={{
        ...generalSettings,
        enabledProviders: preferences?.enabledProviders ?? draftProviders
      }}
      generalSettingsSaveError={providerSaveError}
      generalSettingsSaving={savingProviders}
      onRefresh={() => void refreshDiscovery()}
      onSaveEnabledProviders={saveProviders}
      scope="remote"
      status={
        discovery.state === 'ready'
          ? { state: 'ready', scan: discovery.snapshot.providers }
          : discovery.state === 'loading' || discovery.state === 'idle'
            ? { state: 'loading' }
            : { state: 'error' }
      }
    />
  );

  const updateGeneralSettings = async (next: GeneralSettings) => {
    if (generalSettingsSaving || typeof api.saveGeneralSettings !== 'function') return;
    const previous = generalSettings;
    setGeneralSettings(next);
    setGeneralSettingsSaving(true);
    setGeneralSettingsSaveError(null);
    try {
      const saved = await api.saveGeneralSettings(next);
      setGeneralSettings(normalizeRemoteGeneralSettings(saved));
    } catch {
      setGeneralSettings(previous);
      setGeneralSettingsSaveError('Lumora could not save this remote setting.');
    } finally {
      setGeneralSettingsSaving(false);
    }
  };

  const hideWorkspace = async (mode: WorkspaceVisibilityMode) => {
    if (
      hideWorkspaceIntent === null ||
      workspaceVisibilityBusy ||
      typeof api.setWorkspaceVisibilityPolicy !== 'function'
    ) return;
    setWorkspaceVisibilityBusy(true);
    setWorkspaceVisibilityError(null);
    try {
      const policies = await api.setWorkspaceVisibilityPolicy({
        workspaceId: hideWorkspaceIntent.id,
        mode
      });
      setWorkspaceVisibilityPolicies(policies);
      if (selectedWorkspaceId === hideWorkspaceIntent.id) {
        setSelectedWorkspaceId(null);
      }
      setHideWorkspaceIntent(null);
    } catch {
      setWorkspaceVisibilityError(
        'Lumora could not hide this remote workspace. Try again.'
      );
    } finally {
      setWorkspaceVisibilityBusy(false);
    }
  };

  const restoreWorkspaceVisibility = async (workspaceIds: readonly string[]) => {
    if (
      workspaceIds.length === 0 ||
      workspaceVisibilityBusy ||
      typeof api.restoreWorkspaceVisibility !== 'function'
    ) return;
    setWorkspaceVisibilityBusy(true);
    setWorkspaceVisibilityError(null);
    try {
      setWorkspaceVisibilityPolicies(await api.restoreWorkspaceVisibility({
        workspaceIds: [...workspaceIds]
      }));
    } catch {
      setWorkspaceVisibilityError(
        'Lumora could not restore the selected remote workspaces. Try again.'
      );
    } finally {
      setWorkspaceVisibilityBusy(false);
    }
  };

  const restoreAllWorkspaceVisibility = async () => {
    if (
      workspaceVisibilityBusy ||
      typeof api.restoreAllWorkspaceVisibility !== 'function'
    ) return;
    setWorkspaceVisibilityBusy(true);
    setWorkspaceVisibilityError(null);
    try {
      setWorkspaceVisibilityPolicies(await api.restoreAllWorkspaceVisibility());
    } catch {
      setWorkspaceVisibilityError(
        'Lumora could not restore hidden remote workspaces. Try again.'
      );
    } finally {
      setWorkspaceVisibilityBusy(false);
    }
  };

  const renderRemoteSettings = () => {
    const categories = [
      { id: 'general' as const, label: 'General' },
      { id: 'providers' as const, label: 'Providers' },
      { id: 'environment' as const, label: 'Environment' },
      { id: 'launch' as const, label: 'Launch' },
      { id: 'security' as const, label: 'Security' },
      { id: 'about' as const, label: 'About' }
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
          {settingsCategory === 'general'
            ? (
              <GeneralSettingsPanel
                onChange={(next) => void updateGeneralSettings(next)}
                saveError={generalSettingsSaveError}
                saving={generalSettingsSaving}
                settings={generalSettings}
              />
            )
            : settingsCategory === 'providers'
            ? renderProviders()
            : settingsCategory === 'environment'
              ? renderEnvironment()
              : settingsCategory === 'launch'
                ? (
                  <LaunchSettingsPanel
                    api={api}
                    enabledProviders={
                      preferences?.enabledProviders ?? draftProviders
                    }
                    profiles={terminalProfiles}
                    sessions={
                      sessionCatalog.state === 'ready'
                        ? sessionCatalog.catalog.snapshot.sessions
                        : []
                    }
                    workspaces={
                      sessionCatalog.state === 'ready'
                        ? sessionCatalog.catalog.snapshot.workspaces
                        : []
                    }
                  />
                )
              : settingsCategory === 'about'
                ? (
                  <AboutPanel
                    active
                    api={api}
                    remoteTarget={{
                      connectionState: summary!.target.connectionState,
                      platform: summary!.target.platform,
                      architecture: summary!.target.architecture,
                      helperVersion: summary!.target.helperVersion
                    }}
                  />
                )
                : renderOverview()}
        </section>
      </div>
    );
  };

  if (connected || shellOpened) {
    const activeRoute = REMOTE_ROUTES.find((route) => route.id === page)!;
    const catalogSnapshot = baseCatalogStatus.state === 'ready'
      ? baseCatalogStatus.snapshot
      : null;
    const resumeSession = (session: SessionSummary) => {
      const workspace = catalogSnapshot?.workspaces.find(
        (candidate) => candidate.id === session.workspaceId
      );
      if (workspace === undefined) return;
      setNewSessionIntent(null);
      const runningRuntime = liveRuntimeBySessionId.get(session.id);
      if (runningRuntime !== undefined) {
        setResumeIntent(null);
        activateRuntime(runningRuntime.id);
        setTerminalFocusRequestKey((current) => current + 1);
        return;
      }
      setResumeIntent({ session, workspace });
    };
    const openRuntimes = openRuntimeIds
      .map((id) => runtimes.find((runtime) => runtime.id === id))
      .filter((runtime): runtime is RuntimeSummary => runtime !== undefined);
    const liveRuntimes = runtimes.filter((runtime) =>
      runtime.state === 'launching' || runtime.state === 'running'
    );
    const terminalActive = activeRuntimeId !== null && openRuntimes.length > 0;
    const main = page === 'home' ? (
      <CatalogHomeSummary
        onResume={resumeSession}
        profiles={terminalProfiles}
        providerScan={providerScan}
        providerSummary={
          providerScan === null
            ? 'Scanning remote providers'
            : `${providerScan.providers.filter((provider) => provider.state === 'ready').length} of ${providerScan.providers.length} providers ready`
        }
        runtimes={runtimes}
        runningSessionIds={runningSessionIds}
        status={visibleWorkspaceCatalogStatus}
        workspaceById={workspaceCatalogPresentation?.workspaceById}
      />
    ) : page === 'workspaces' ? (
      selectedWorkspaceId === null ? (
        <WorkspacesView
          hiddenWorkspaceCount={workspaceCatalogPresentation?.hiddenWorkspaces.length ?? 0}
          isRefreshing={sessionCatalog.state === 'loading'}
          onHideWorkspace={(workspace) => {
            setWorkspaceVisibilityError(null);
            setHideWorkspaceIntent(workspace);
          }}
          onManageHiddenWorkspaces={() => {
            setWorkspaceVisibilityError(null);
            setHiddenWorkspacesOpen(true);
          }}
          onOpenWorkspace={setSelectedWorkspaceId}
          onRefresh={() => void refreshSessions()}
          scopeLabel="Remote provider folders"
          status={visibleWorkspaceCatalogStatus}
        />
      ) : (
        <WorkspaceSessionsView
          isRefreshing={sessionCatalog.state === 'loading'}
          onBack={() => setSelectedWorkspaceId(null)}
          onRefresh={() => void refreshSessions()}
          onResume={resumeSession}
          onRetry={() => void refreshSessions()}
          operationError={null}
          profiles={terminalProfiles}
          providerScan={providerScan}
          runningSessionIds={runningSessionIds}
          status={visibleWorkspaceCatalogStatus}
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
        onResume={resumeSession}
        onSearchChange={setSessionSearch}
        profiles={terminalProfiles}
        provider={sessionProvider}
        providerScan={providerScan}
        queryText={sessionSearch}
        runningSessionIds={runningSessionIds}
        showInformationalNotices={generalSettings.showInformationalNotices}
        status={visibleCatalogStatus}
        workspaceById={catalogPresentation?.workspaceById}
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
        className={terminalActive ? 'terminal-active' : ''}
        hidePageHeader={terminalActive}
        main={(
          <>
            <div className="route-surface" hidden={terminalActive}>{main}</div>
            {openRuntimes.length > 0 ? (
              <div className="terminal-surface" hidden={!terminalActive}>
                <TerminalWorkspace
                  activeRuntimeId={activeRuntimeId ?? openRuntimes[0]!.id}
                  api={api}
                  backgroundOpacity={
                    appearance.backgroundActive
                      ? generalSettings.appearance.terminalOpacity
                      : 1
                  }
                  focusRequestKey={terminalFocusRequestKey}
                  onActivate={activateRuntime}
                  onReorder={reorderRuntimeTab}
                  onRuntimeChange={updateRuntime}
                  platform={
                    summary.target.platform === 'unknown'
                      ? 'linux'
                      : summary.target.platform
                  }
                  previews={launchPreviews}
                  runtimes={openRuntimes}
                  theme={terminalThemeFor(
                    appearance.theme,
                    generalSettings.appearance.lightTerminalInLightMode
                  )}
                  visible={terminalActive}
                  workspaces={catalogSnapshot?.workspaces ?? []}
                />
              </div>
            ) : null}
          </>
        )}
        mainClassName={terminalActive ? 'terminal-main-content' : ''}
        navigationActive={!terminalActive}
        onNavigate={(route) => {
          setPage(route);
          if (route !== 'workspaces') setSelectedWorkspaceId(null);
          if (generalSettings.autoExpandSidebar) setSidebarExpanded(true);
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
          routes: REMOTE_PRIMARY_ROUTES
        }}
        secondaryNavigation={{
          label: 'Application',
          routes: [
            {
              ...REMOTE_SETTINGS_ROUTE,
              shortcut: formatShortcutChord(
                keyboardSettings.openSettings,
                summary.target.platform === 'unknown'
                  ? 'linux'
                  : summary.target.platform
              )
            }
          ]
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
              <span className="status-item">
                {liveRuntimes.length} remote {liveRuntimes.length === 1 ? 'agent' : 'agents'}
              </span>
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
              <>
                {!terminalActive && liveRuntimes.length > 0 ? (
                  <button
                    className="secondary-button"
                    onClick={openLiveTerminals}
                    type="button"
                  >Open terminals</button>
                ) : null}
                {!terminalActive && workspaceCatalogPresentation?.snapshot.workspaces.some(
                  (workspace) => workspace.available
                ) ? (
                  <button
                    className="refresh-button"
                    onClick={() => {
                      setResumeIntent(null);
                      setNewSessionIntent({
                        initialWorkspaceId:
                          page === 'workspaces' ? selectedWorkspaceId : null
                      });
                    }}
                    type="button"
                  >New session</button>
                ) : null}
                <button
                  className="secondary-button"
                  disabled={busy}
                  onClick={() => void disconnect()}
                  type="button"
                >
                  {busy ? 'Disconnecting…' : 'Disconnect'}
                </button>
              </>
            ) : undefined
          )
        }}
        floatingContent={(
          <>
            {windowCloseRequest !== null ? (
              <ConfirmDialog
                cancelLabel="Keep running"
                confirmLabel="Disconnect and close"
                description={(
                  <>
                    This remote computer has {windowCloseRequest.activeTerminalCount}{' '}
                    active terminal {windowCloseRequest.activeTerminalCount === 1
                      ? 'session'
                      : 'sessions'}. Disconnecting will stop the SSH connection
                    and those terminal sessions.
                  </>
                )}
                heading="Disconnect remote computer?"
                onCancel={() => void resolveWindowClose('keep_running')}
                onConfirm={() => void resolveWindowClose('disconnect')}
                suppression={{
                  checked: suppressRemoteDisconnectWarning,
                  label: "Don't show this warning again",
                  onChange: setSuppressRemoteDisconnectWarning
                }}
              />
            ) : null}
            {hideWorkspaceIntent === null ? null : (
              <HideWorkspaceDialog
                busy={workspaceVisibilityBusy}
                error={workspaceVisibilityError}
                onClose={() => {
                  if (workspaceVisibilityBusy) return;
                  setWorkspaceVisibilityError(null);
                  setHideWorkspaceIntent(null);
                }}
                onHide={(mode) => void hideWorkspace(mode)}
                workspace={hideWorkspaceIntent}
              />
            )}
            {!hiddenWorkspacesOpen || workspaceCatalogPresentation === null ? null : (
              <HiddenWorkspacesDialog
                busy={workspaceVisibilityBusy}
                entries={workspaceCatalogPresentation.hiddenWorkspaces}
                error={workspaceVisibilityError}
                onClose={() => {
                  if (workspaceVisibilityBusy) return;
                  setWorkspaceVisibilityError(null);
                  setHiddenWorkspacesOpen(false);
                }}
                onRestore={(workspaceIds) => void restoreWorkspaceVisibility(workspaceIds)}
                onRestoreAll={() => void restoreAllWorkspaceVisibility()}
              />
            )}
            {newSessionIntent !== null && workspaceCatalogPresentation !== null ? (
              <NewSessionDialog
                api={api}
                initialWorkspaceId={newSessionIntent.initialWorkspaceId}
                onClose={() => setNewSessionIntent(null)}
                onStarted={handleRuntimeStarted}
                profiles={terminalProfiles}
                providerScan={providerScan}
                workspaces={workspaceCatalogPresentation.snapshot.workspaces}
              />
            ) : null}
            {resumeIntent !== null ? (
              <ResumeSessionDialog
                api={api}
                generalSettings={{
                  ...generalSettings,
                  crossAgentWorkflowEnabled: false
                }}
                onClose={() => setResumeIntent(null)}
                onStarted={handleRuntimeStarted}
                profiles={terminalProfiles}
                providerScan={providerScan}
                session={resumeIntent.session}
                sourceSessionActive={liveRuntimes.some(
                  (runtime) => runtime.sessionId === resumeIntent.session.id
                )}
                workspace={resumeIntent.workspace}
              />
            ) : null}
          </>
        )}
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
          Environment, providers, launch settings, sessions, and terminals stay
          isolated to this target.
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
