import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode
} from 'react';

import type {
  AgentRuntimeStartResult,
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
import { resolveTerminalFontFamily } from '../appearance/font-family';
import { LaunchSettingsPanel } from '../settings/LaunchSettingsPanel';
import {
  LumoraShell,
  type LumoraShellAppearance
} from '../shell/LumoraShell';
import {
  readSidebarExpanded,
  writeSidebarExpanded
} from '../sidebar/sidebar-preference';
import { SidebarSessionList } from '../sidebar/SidebarSessionList';
import { projectSidebarSessions } from '../sidebar/sidebar-sessions';
import {
  readRemoteTargetErrorCode,
  type RemoteTargetErrorCode
} from '../../../shared/remote-target-errors';
import { NewSessionDialog } from '../terminal/NewSessionDialog';
import { ResumeSessionDialog } from '../terminal/ResumeSessionDialog';
import { TerminalWorkspace } from '../terminal/TerminalWorkspace';
import { DirectSessionLaunchWorkspace } from '../terminal/DirectSessionLaunchWorkspace';
import { useDirectSessionLaunch } from '../terminal/useDirectSessionLaunch';
import { indexLiveSessionRuntimes } from '../terminal/live-session-runtime';
import {
  formatShortcutChord,
  keyboardEventMatchesChord
} from '../keyboard/shortcut';
import { ProviderSettings } from '../providers/ProviderSettings';
import { useProviderUpdates } from '../providers/useProviderUpdates';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { GeneralSettingsPanel } from '../settings/GeneralSettingsPanel';
import { AboutPanel } from '../settings/AboutPanel';
import { WorkspaceTrustPanel } from '../settings/WorkspaceTrustPanel';
import { useLocalization } from '../localization/useLocalization';

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
    id: 'home', labelKey: 'shell.navigation.home', icon: 'home', eyebrowKey: 'remote.shell.home-eyebrow',
    descriptionKey: 'remote.shell.home-description'
  },
  {
    id: 'workspaces', labelKey: 'shell.navigation.workspaces', icon: 'workspace',
    eyebrowKey: 'remote.shell.workspaces-eyebrow',
    descriptionKey: 'remote.shell.workspaces-description'
  },
  {
    id: 'sessions', labelKey: 'shell.navigation.sessions', icon: 'sessions',
    eyebrowKey: 'remote.shell.sessions-eyebrow',
    descriptionKey: 'remote.shell.sessions-description'
  },
  {
    id: 'settings', labelKey: 'shell.navigation.settings', icon: 'settings',
    eyebrowKey: 'remote.shell.settings-eyebrow',
    descriptionKey: 'remote.shell.settings-description'
  }
] as const;

const REMOTE_CONNECTION_ERROR_KEYS: Record<RemoteTargetErrorCode, string> = {
  REMOTE_TARGET_AUTHENTICATION_FAILED: 'remote.connection-errors.authentication-failed',
  REMOTE_TARGET_HOST_KEY_CHANGED: 'remote.connection-errors.host-key-changed',
  REMOTE_TARGET_SSH_TIMEOUT: 'remote.connection-errors.timeout',
  REMOTE_TARGET_SSH_CONNECTION_FAILED: 'remote.connection-errors.connection-failed',
  REMOTE_TARGET_PLATFORM_PROBE_FAILED: 'remote.connection-errors.platform-probe-failed',
  REMOTE_TARGET_HELPER_BUNDLE_FAILED: 'remote.connection-errors.helper-bundle-failed',
  REMOTE_TARGET_FILE_TRANSFER_FAILED: 'remote.connection-errors.file-transfer-failed',
  REMOTE_TARGET_HELPER_INSPECTION_FAILED: 'remote.connection-errors.helper-inspection-failed',
  REMOTE_TARGET_CREDENTIAL_REQUIRED: 'remote.connection-errors.credential-required',
  REMOTE_TARGET_CREDENTIAL_UNAVAILABLE: 'remote.connection-errors.credential-unavailable',
  REMOTE_TARGET_OPERATION_FAILED: 'remote.connection-errors.operation-failed'
};

function remoteConnectionErrorMessage(error: unknown, t: (key: string) => string): string {
  return t(REMOTE_CONNECTION_ERROR_KEYS[readRemoteTargetErrorCode(error)]);
}

function endpoint(summary: RemoteTargetSummary, sshConfigLabel = 'SSH config'): string {
  const profile = summary.profile;
  return profile.route === 'direct'
    ? `${profile.username}@${profile.host}:${profile.port}`
    : `${sshConfigLabel} · ${profile.sshConfigHost}`;
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
  const { t } = useLocalization();
  return (
    <article className={`remote-discovery-card state-${status.state}`}>
      <header>
        <div>
          <p className="card-label">{t('remote.environment.prerequisite')}</p>
          <h3>{displayName}</h3>
        </div>
        <span className={`remote-state state-${status.state}`}>
          {t(`remote.environment.states.${status.state.replaceAll('_', '-')}`)}
        </span>
      </header>
      {status.state === 'ready' ? (
        <dl className="remote-discovery-details">
          <div><dt>{t('common.labels.version')}</dt><dd>{status.version}</dd></div>
          <div><dt>{t('remote.environment.executable')}</dt><dd>{status.executablePath}</dd></div>
        </dl>
      ) : status.state === 'probe_failed' ? (
        <>
          <p>{t('remote.environment.probe-failed', {
            name: displayName,
            command: `${command} --version`
          })}</p>
          <p className="remote-discovery-path">{status.executablePath}</p>
        </>
      ) : (
        <p>{t('remote.environment.not-found', { name: displayName })}</p>
      )}
    </article>
  );
}

export function RemoteTargetWindow({
  executionTargetId,
  api = window.lumora,
  appearance = DEFAULT_REMOTE_APPEARANCE
}: RemoteTargetWindowProps) {
  const { t } = useLocalization();
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
  const [generalSettingsLoaded, setGeneralSettingsLoaded] = useState(false);
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
      setError(t('remote.errors.close-connection'));
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
        setError(current === null ? t('remote.errors.target-unavailable') : null);
      } catch {
        if (active) setError(t('remote.errors.load-target'));
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
      setError(t('remote.errors.inspect-helper'));
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
          setError(remoteConnectionErrorMessage(connectionError, t));
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
          setGeneralSettingsLoaded(true);
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
          setError(t('remote.errors.load-runtime'));
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
            setGeneralSettingsLoaded(true);
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

  const handleDirectSessionStarted = useCallback((
    result: AgentRuntimeStartResult | RuntimeSummary,
    preview: LaunchPreview,
    activate: boolean
  ) => {
    if ('mode' in result && result.mode !== 'pty') return;
    const runtime = 'mode' in result ? result.runtime : result;
    updateRuntime(runtime);
    setOpenRuntimeIds((current) =>
      current.includes(runtime.id) ? current : [...current, runtime.id]
    );
    setLaunchPreviews((current) => {
      const next = new Map(current);
      next.set(runtime.id, preview);
      return next;
    });
    if (activate) {
      activateRuntime(runtime.id);
      setTerminalFocusRequestKey((current) => current + 1);
    }
  }, [activateRuntime, updateRuntime]);

  const directSessionLaunch = useDirectSessionLaunch({
    api,
    autoTrustWorkspaces: generalSettings.autoTrustWorkspaces,
    mode: 'pty',
    onStarted: handleDirectSessionStarted
  });

  useEffect(() => {
    directSessionLaunch.hide();
  }, [directSessionLaunch.hide, page, selectedWorkspaceId]);

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
  const providerUpdates = useProviderUpdates({
    api,
    enabled:
      generalSettingsLoaded &&
      generalSettings.checkProviderUpdatesAutomatically,
    discoveryReady: discovery.state === 'ready'
  });
  const enabledProviders = preferences?.enabledProviders ?? draftProviders;
  const availableProviderUpdates =
    generalSettings.checkProviderUpdatesAutomatically &&
    providerUpdates.status.state === 'ready'
    ? providerUpdates.status.check.providers
        .filter((provider) =>
          provider.state === 'update_available' &&
          enabledProviders.includes(provider.provider)
        )
        .map((provider) => provider.provider)
      : [];
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
          <p className="eyebrow">{t('remote.window.title')}</p>
          <h1>{t('remote.window.connecting-manager')}</h1>
          <p>{error ?? t('remote.window.loading-workspace')}</p>
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
          <p className="eyebrow">{t('remote.window.title')}</p>
          <h1>
            {showAutomaticConnecting
              ? t('remote.window.connecting-target', { target: summary.target.displayName })
              : t('remote.window.preparing-target', { target: summary.target.displayName })}
          </h1>
          <p>
            {showAutomaticConnecting
              ? t('remote.window.establishing-remembered')
              : t('remote.window.checking-preferences')}
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
      setError(t('remote.errors.forget-credential'));
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
      setError(t('remote.errors.update-auto-connect'));
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
          setError(t('remote.errors.auto-connect-after-connection'));
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
      setError(remoteConnectionErrorMessage(connectionError, t));
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
      setError(t('remote.errors.disconnect'));
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
      setError(t('remote.errors.install-helper'));
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
      setProviderSaveError(t('remote.errors.save-providers'));
      return false;
    } finally {
      setSavingProviders(false);
    }
  };

  const renderOverview = () => (
    <section className="remote-window-panel">
      <dl className="remote-facts">
        <div><dt>{t('common.labels.platform')}</dt><dd>{summary.target.platform}</dd></div>
        <div><dt>{t('remote.overview.architecture')}</dt><dd>{summary.target.architecture}</dd></div>
        <div><dt>{t('remote.overview.home')}</dt><dd>{details?.homeDirectory ?? t('remote.overview.detected-after-connection')}</dd></div>
        <div><dt>{t('remote.overview.shell')}</dt><dd>{details?.defaultShell ?? t('remote.overview.detected-after-connection')}</dd></div>
      </dl>

      {!trusted && (
        <p className="inline-notice warning">
          {t('remote.overview.verify-first')}
        </p>
      )}
      {error !== null && <p className="inline-notice error">{error}</p>}

      {!connected && !helperPending && authentication.method === 'password' && (
        <label className="remote-secret-field">
          <span>{t('remote.authentication.ssh-password')}</span>
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
          <span>{t('remote.authentication.passphrase-optional')}</span>
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
                    ? t('remote.authentication.remember-password')
                    : t('remote.authentication.remember-passphrase')}
                </strong>
                <small>
                  {t('remote.authentication.secure-storage-description')}
                </small>
              </span>
              <span className="settings-switch">
                <input
                  aria-label={authentication.method === 'password'
                    ? t('remote.authentication.remember-password')
                    : t('remote.authentication.remember-passphrase')}
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
              <strong>{t('remote.profile.auto-connect')}</strong>
              <small>{t('remote.authentication.auto-connect-description')}</small>
            </span>
            <span className="settings-switch">
              <input
                aria-label={t('remote.profile.auto-connect')}
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
                {t('remote.authentication.storage-unavailable')}
              </p>
            )}
        </div>
      )}

      <div className="remote-window-actions">
        {connected ? (
          <button className="secondary-button" disabled={busy} onClick={() => void disconnect()}>
            {t(busy ? 'common.states.disconnecting' : 'common.actions.disconnect')}
          </button>
        ) : helperPending ? (
          <>
            <button className="secondary-button" disabled={busy} onClick={() => void disconnect()}>
              {t('common.actions.disconnect')}
            </button>
            <button
              className="refresh-button"
              disabled={busy || helperInstall === null}
              onClick={() => setShowHelperInstall(true)}
            >
              {t('remote.helper.install-lumora')}
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
            {t(busy ? 'common.states.connecting' : 'remote.profile.connect')}
          </button>
        )}
      </div>
    </section>
  );

  const renderEnvironment = () => (
    <section className="remote-window-panel">
      <div className="remote-panel-heading">
        <div>
          <p className="card-label">{t('remote.environment.prerequisites')}</p>
          <h2>{t('settings.tabs.environment')}</h2>
          <p>{t('remote.environment.description')}</p>
        </div>
        <button
          className="refresh-button"
          disabled={!discoverySupported || discovery.state === 'loading'}
          onClick={() => void refreshDiscovery()}
        >
          {t(discovery.state === 'loading' ? 'remote.environment.scanning' : 'common.actions.refresh')}
        </button>
      </div>
      {discovery.state === 'loading' && (
        <p className="remote-discovery-message" aria-live="polite">
          {t('remote.environment.scanning-environment')}
        </p>
      )}
      {discovery.state === 'unsupported' && (
        <p className="inline-notice warning">
          {t('remote.environment.unsupported')}
        </p>
      )}
      {discovery.state === 'error' && (
        <p className="inline-notice error">
          {t('remote.environment.scan-error')}
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
      onRefresh={refreshDiscovery}
      onRefreshUpdates={providerUpdates.refresh}
      onSaveEnabledProviders={saveProviders}
      scope="remote"
      updatesRefreshing={providerUpdates.refreshing}
      updatesStatus={providerUpdates.status}
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
      setGeneralSettingsSaveError(t('remote.errors.save-setting'));
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
        t('remote.errors.hide-workspace')
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
        t('remote.errors.restore-workspaces')
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
        t('remote.errors.restore-all-workspaces')
      );
    } finally {
      setWorkspaceVisibilityBusy(false);
    }
  };

  const renderRemoteSettings = () => {
    const categories = [
      { id: 'general' as const, label: t('settings.tabs.general') },
      { id: 'providers' as const, label: t('settings.tabs.providers') },
      { id: 'environment' as const, label: t('settings.tabs.environment') },
      { id: 'launch' as const, label: t('settings.tabs.launch') },
      { id: 'security' as const, label: t('settings.tabs.security') },
      { id: 'about' as const, label: t('settings.tabs.about') }
    ];
    return (
      <div className="settings-layout">
        <div
          aria-label={t('settings.categories-label')}
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
                : settingsCategory === 'security'
                  ? (
                    <WorkspaceTrustPanel
                      api={api}
                      onSettingsChange={(next) => void updateGeneralSettings(next)}
                      saving={generalSettingsSaving}
                      settings={generalSettings}
                      workspaces={
                        sessionCatalog.state === 'ready'
                          ? sessionCatalog.catalog.snapshot.workspaces
                          : []
                      }
                    />
                  )
                  : renderOverview()}
        </section>
      </div>
    );
  };

  if (connected || shellOpened) {
    const translatedRoutes = REMOTE_ROUTES.map((route) => ({
      id: route.id,
      icon: route.icon,
      label: t(route.labelKey),
      eyebrow: t(route.eyebrowKey),
      description: t(route.descriptionKey)
    }));
    const activeRoute = translatedRoutes.find((route) => route.id === page)!;
    const primaryRoutes = translatedRoutes.filter((route) => route.id !== 'settings');
    const settingsRoute = translatedRoutes.find((route) => route.id === 'settings')!;
    const catalogSnapshot = baseCatalogStatus.state === 'ready'
      ? baseCatalogStatus.snapshot
      : null;
    const resumeSession = (session: SessionSummary) => {
      const workspace = catalogSnapshot?.workspaces.find(
        (candidate) => candidate.id === session.workspaceId
      );
      if (workspace === undefined) return;
      setNewSessionIntent(null);
      setResumeIntent(null);
      const runningRuntime = liveRuntimeBySessionId.get(session.id);
      if (runningRuntime !== undefined) {
        directSessionLaunch.hide();
        activateRuntime(runningRuntime.id);
        setTerminalFocusRequestKey((current) => current + 1);
        return;
      }
      directSessionLaunch.open(session, workspace);
    };
    const resumeSessionOptions = (session: SessionSummary) => {
      const workspace = catalogSnapshot?.workspaces.find(
        (candidate) => candidate.id === session.workspaceId
      );
      if (workspace === undefined || liveRuntimeBySessionId.has(session.id)) return;
      directSessionLaunch.hide();
      setNewSessionIntent(null);
      setResumeIntent({ session, workspace });
    };
    const openRuntimes = openRuntimeIds
      .map((id) => runtimes.find((runtime) => runtime.id === id))
      .filter((runtime): runtime is RuntimeSummary => runtime !== undefined);
    const liveRuntimes = runtimes.filter((runtime) =>
      runtime.state === 'launching' || runtime.state === 'running'
    );
    const sidebarSessions = projectSidebarSessions({
      runtimes: liveRuntimes,
      sessions: workspaceCatalogPresentation?.snapshot.sessions ?? []
    });
    const directSessionLaunchActive = directSessionLaunch.launch !== null;
    const terminalActive = directSessionLaunchActive || (
      activeRuntimeId !== null && openRuntimes.length > 0
    );
    const main = page === 'home' ? (
      <CatalogHomeSummary
        availableProviderUpdates={availableProviderUpdates}
        onOpenProviderUpdates={() => {
          setPage('settings');
          setSettingsCategory('providers');
        }}
        onResume={resumeSession}
        onResumeOptions={resumeSessionOptions}
        profiles={terminalProfiles}
        providerScan={providerScan}
        providerSummary={
          providerScan === null
            ? t('remote.catalog.scanning-providers')
            : t('remote.catalog.providers-ready', {
                ready: providerScan.providers.filter((provider) => provider.state === 'ready').length,
                total: providerScan.providers.length
              })
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
          scopeLabel={t('remote.catalog.provider-folders')}
          status={visibleWorkspaceCatalogStatus}
        />
      ) : (
        <WorkspaceSessionsView
          isRefreshing={sessionCatalog.state === 'loading'}
          onBack={() => setSelectedWorkspaceId(null)}
          onRefresh={() => void refreshSessions()}
          onResume={resumeSession}
          onResumeOptions={resumeSessionOptions}
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
        onResumeOptions={resumeSessionOptions}
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
              <strong>{t('remote.window.connection-lost')}</strong>
              <span>{t('remote.window.cached-catalog')}</span>
            </div>
            <button
              className="refresh-button"
              onClick={() => {
                setError(null);
                setShellOpened(false);
              }}
              type="button"
            >{t('remote.connection.reconnect')}</button>
          </section>
        ) : null}
        className={terminalActive ? 'terminal-active' : ''}
        hidePageHeader={terminalActive}
        main={(
          <>
            <div className="route-surface" hidden={terminalActive}>{main}</div>
            {directSessionLaunch.launch === null ? null : (
              <div className="terminal-surface">
                <DirectSessionLaunchWorkspace
                  launch={directSessionLaunch.launch}
                  onClose={directSessionLaunch.hide}
                  onOpenOptions={() => {
                    const currentLaunch = directSessionLaunch.launch;
                    if (currentLaunch === null) return;
                    const { session } = currentLaunch;
                    resumeSessionOptions(session);
                  }}
                  onRetry={directSessionLaunch.retry}
                  onTrustAndContinue={directSessionLaunch.trustAndContinue}
                />
              </div>
            )}
            {openRuntimes.length > 0 && !directSessionLaunchActive ? (
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
                  fontFamily={resolveTerminalFontFamily(
                    generalSettings.appearance.terminalFontFamily
                  )}
                  fontSize={generalSettings.appearance.terminalFontSize}
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
                  showTabBar={!sidebarExpanded}
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
          ariaLabel: t('shell.navigation.primary'),
          label: t('remote.shell.remote-group'),
          routes: primaryRoutes
        }}
        secondaryNavigation={{
          label: t('shell.navigation.application-group'),
          routes: [
            {
              ...settingsRoute,
              shortcut: formatShortcutChord(
                keyboardSettings.openSettings,
                summary.target.platform === 'unknown'
                  ? 'linux'
                  : summary.target.platform
              )
            }
          ]
        }}
        sidebarContent={(
          <SidebarSessionList
            activeRuntimeId={activeRuntimeId}
            onActivateRuntime={activateRuntime}
            onResumeSession={resumeSession}
            onResumeSessionOptions={resumeSessionOptions}
            preferenceScope={`remote:${summary.target.id}`}
            recent={sidebarSessions.recent}
            running={sidebarSessions.running}
          />
        )}
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
                {t('remote.window.active-agents', { count: liveRuntimes.length })}
              </span>
              <span className="status-divider" aria-hidden="true" />
              <span className="status-item">
                {t(connected ? 'remote.window.helper-connected' : 'remote.window.connection-unavailable')}
              </span>
            </div>
          </footer>
        }
        topbar={{
          context: endpoint(summary, t('remote.profile.ssh-config-short')),
          kicker: t('remote.window.title'),
          actions: (
            connected ? (
              <>
                {!terminalActive && liveRuntimes.length > 0 ? (
                  <button
                    className="secondary-button"
                    onClick={openLiveTerminals}
                    type="button"
                  >{t('remote.window.open-terminals')}</button>
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
                  >{t('remote.window.new-session')}</button>
                ) : null}
                <button
                  className="secondary-button"
                  disabled={busy}
                  onClick={() => void disconnect()}
                  type="button"
                >
                  {t(busy ? 'common.states.disconnecting' : 'common.actions.disconnect')}
                </button>
              </>
            ) : undefined
          )
        }}
        floatingContent={(
          <>
            {windowCloseRequest !== null ? (
              <ConfirmDialog
                cancelLabel={t('remote.close-warning.keep-running')}
                confirmLabel={t('remote.close-warning.disconnect-close')}
                description={t('remote.close-warning.description', {
                  count: windowCloseRequest.activeTerminalCount
                })}
                heading={t('remote.close-warning.heading')}
                onCancel={() => void resolveWindowClose('keep_running')}
                onConfirm={() => void resolveWindowClose('disconnect')}
                suppression={{
                  checked: suppressRemoteDisconnectWarning,
                  label: t('remote.close-warning.suppress'),
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
                generalSettings={generalSettings}
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
            <p className="eyebrow">{t('remote.window.isolated-target')}</p>
            <h1>{summary.target.displayName}</h1>
            <p>{endpoint(summary, t('remote.profile.ssh-config-short'))}</p>
          </div>
          <span className={`remote-state state-${summary.target.connectionState}`}>
            {t(`remote.states.${summary.target.connectionState}`)}
          </span>
        </header>

        {renderOverview()}

        <footer className="remote-phase-note">
          {t('remote.window.isolation-note')}
        </footer>
      </section>
      {showHelperInstall && helperInstall !== null && (
        <div className="dialog-backdrop" role="presentation">
          <section
            aria-label={t('remote.helper.install-lumora')}
            aria-modal="true"
            className="new-session-dialog remote-helper-install-dialog"
            role="dialog"
          >
            <header>
              <div>
                <p className="card-label">{t('remote.helper.eyebrow')}</p>
                <h2>{t('remote.helper.install-lumora')}</h2>
              </div>
              <button
                aria-label={t('remote.helper.close-installation')}
                className="text-button"
                disabled={busy}
                onClick={() => setShowHelperInstall(false)}
                type="button"
              >{t('common.actions.close')}</button>
            </header>
            <div className="dialog-body remote-helper-dialog-body">
              <p>{t('remote.helper.install-description', { target: summary.target.displayName })}</p>
              <dl className="remote-helper-install-facts">
                <div><dt>{t('common.labels.version')}</dt><dd>{helperInstall.helperVersion}</dd></div>
                <div><dt>{t('remote.helper.location')}</dt><dd>{helperInstall.installLocation}</dd></div>
              </dl>
              {helperInstall.status === 'invalid' && (
                <p className="inline-notice warning">
                  {t('remote.helper.invalid-replace')}
                </p>
              )}
            </div>
            <footer className="modal-actions">
              <button
                className="secondary-button"
                disabled={busy}
                onClick={() => setShowHelperInstall(false)}
              >{t('common.actions.cancel')}</button>
              <button
                className="refresh-button"
                disabled={busy}
                onClick={() => void installHelper()}
              >{t(busy ? 'remote.helper.installing-short' : 'remote.helper.install')}</button>
            </footer>
          </section>
        </div>
      )}
    </main>
  );
}
