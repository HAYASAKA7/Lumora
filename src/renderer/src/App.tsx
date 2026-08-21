import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode
} from 'react';

import startupPosterUrl from './assets/lumora-startup-final.png';
import startupVideoUrl from './assets/lumora-startup.mp4';
import {
  DEFAULT_GENERAL_SETTINGS,
  DEFAULT_KEYBOARD_SETTINGS
} from '../../shared/contracts';
import type {
  AppearanceBackgroundState,
  ApplicationQuitRequest,
  CatalogQuery,
  GeneralSettings,
  ProviderId,
  KeyboardSettings,
  LaunchPreview,
  RemoteLifecycleSnapshot,
  RuntimeSummary,
  SessionSummary,
  SystemInfo,
  WorkspaceVisibilityMode,
  WorkspaceVisibilityPolicy,
  WorkspaceSummary
} from '../../shared/contracts';
import {
  CatalogHomeSummary,
  SessionsView,
  WorkspacesView,
  type CatalogViewStatus
} from './catalog/CatalogViews';
import { WorkspaceSessionsView } from './catalog/WorkspaceSessionsView';
import { HiddenWorkspacesDialog } from './catalog/HiddenWorkspacesDialog';
import { HideWorkspaceDialog } from './catalog/HideWorkspaceDialog';
import { projectCatalogVisibility } from './catalog/catalog-visibility';
import {
  buildAppearancePresentation
} from './appearance/presentation';
import { resolveAppearanceTheme, terminalThemeFor } from './appearance/theme';
import { useCatalogAutoRefresh } from './catalog/useCatalogAutoRefresh';
import { RegionErrorBoundary } from './errors/RegionErrorBoundary';
import type { ProviderScanStatus } from './providers/ProviderSettings';
import { RemoteTargetsView } from './remote/RemoteTargetsView';
import {
  DeveloperEnvironmentNotice,
  type DeveloperEnvironmentStatus
} from './environment/DeveloperEnvironment';
import {
  formatShortcutChord,
  isRequiredModifierKey,
  keyboardEventMatchesChord
} from './keyboard/shortcut';
import {
  SettingsView,
  type SettingsCategory
} from './settings/SettingsView';
import {
  readSidebarExpanded,
  writeSidebarExpanded
} from './sidebar/sidebar-preference';
import {
  LumoraShell,
  NavigationIcon as Icon,
  type NavigationIconName
} from './shell/LumoraShell';
import { StartupOverlay } from './startup/StartupOverlay';
import { ConfirmDialog } from './ui/ConfirmDialog';
import { NewSessionDialog } from './terminal/NewSessionDialog';
import { ResumeSessionDialog } from './terminal/ResumeSessionDialog';
import { RuntimeRecoveryDialog } from './terminal/RuntimeRecoveryDialog';
import {
  RuntimeSwitcher,
  buildRuntimeMru,
  nextRuntimeInOrder,
  reconcileRuntimeSwitch,
  touchRuntimeMru
} from './terminal/RuntimeSwitcher';
import type { RuntimeSwitcherState } from './terminal/RuntimeSwitcher';
import { TerminalProfiles } from './terminal/TerminalProfiles';
import { TerminalWorkspace } from './terminal/TerminalWorkspace';
import { moveRuntimeTab } from './terminal/runtime-tab-order';
import { indexLiveSessionRuntimes } from './terminal/live-session-runtime';
import { TooltipProvider } from './ui/Tooltip';

type RouteId =
  | 'home'
  | 'workspaces'
  | 'sessions'
  | 'profiles'
  | 'remote'
  | 'settings';

type NavigationShortcutKey =
  | 'openHome'
  | 'openWorkspaces'
  | 'openSessions'
  | 'openProfiles'
  | 'openRemote'
  | 'openSettings';

interface RouteDefinition {
  id: RouteId;
  label: string;
  eyebrow: string;
  description: string;
  icon: IconName;
  shortcut: NavigationShortcutKey | null;
}

type IconName = NavigationIconName;

type SystemStatus =
  | { state: 'loading' }
  | { state: 'ready'; info: SystemInfo }
  | { state: 'error' };

interface ResumeIntent {
  session: SessionSummary;
  workspace: WorkspaceSummary;
}

interface NewSessionIntent {
  initialWorkspaceId: string | null;
}

const EMPTY_CATALOG_QUERY: CatalogQuery = { text: '', provider: null };
type StartupTask =
  | 'system'
  | 'providers'
  | 'environment'
  | 'catalog'
  | 'workspaceVisibility'
  | 'profiles'
  | 'runtimes'
  | 'keyboard'
  | 'generalSettings'
  | 'appearanceBackground';

const INITIAL_STARTUP_TASKS: Record<StartupTask, boolean> = {
  system: false,
  providers: false,
  environment: false,
  catalog: false,
  workspaceVisibility: false,
  profiles: false,
  runtimes: false,
  keyboard: false,
  generalSettings: false,
  appearanceBackground: false
};

const ROUTES = [
  {
    id: 'home',
    label: 'Home',
    eyebrow: 'Command center',
    description:
      'A quiet overview of active work, recent sessions, and anything that needs your attention.',
    icon: 'home',
    shortcut: 'openHome'
  },
  {
    id: 'workspaces',
    label: 'Workspaces',
    eyebrow: 'Workspace index',
    description:
      'Organize repositories and see supported agent sessions in one dependable hierarchy.',
    icon: 'workspace',
    shortcut: 'openWorkspaces'
  },
  {
    id: 'sessions',
    label: 'All sessions',
    eyebrow: 'Session catalog',
    description:
      'Search and filter normalized provider sessions without changing provider-owned data.',
    icon: 'sessions',
    shortcut: 'openSessions'
  },
  {
    id: 'profiles',
    label: 'Terminal profiles',
    eyebrow: 'Shell profiles',
    description:
      'Review detected shells and define the terminal environment used for managed sessions.',
    icon: 'terminal',
    shortcut: 'openProfiles'
  },
  {
    id: 'remote',
    label: 'Remote computers',
    eyebrow: 'Remote Lumora',
    description:
      'Configure SSH access and open one isolated Lumora window for each remote computer.',
    icon: 'remote',
    shortcut: 'openRemote'
  },
  {
    id: 'settings',
    label: 'Settings',
    eyebrow: 'Application settings',
    description:
      'Configure providers, storage, security, appearance, and diagnostic behavior.',
    icon: 'settings',
    shortcut: 'openSettings'
  }
] as const satisfies readonly RouteDefinition[];

const PRIMARY_ROUTES = ROUTES.filter((route) => route.id !== 'settings');
const SETTINGS_ROUTE = ROUTES.find((route) => route.id === 'settings')!;

const PLATFORM_LABELS: Record<SystemInfo['platform'], string> = {
  win32: 'Windows',
  darwin: 'macOS',
  linux: 'Linux'
};

function providerSummary(status: ProviderScanStatus): string {
  if (status.state === 'loading') {
    return 'Scanning provider installations';
  }

  if (status.state === 'error') {
    return 'Provider details are unavailable';
  }

  const readyCount = status.scan.providers.filter(
    (provider) => provider.state === 'ready'
  ).length;
  return `${readyCount} of ${status.scan.providers.length} providers ready`;
}

function DestinationPlaceholder({ route }: { route: RouteDefinition }): ReactNode {
  return (
    <section className="destination-panel" aria-label={`${route.label} status`}>
      <div className="destination-icon">
        <Icon name={route.icon} />
      </div>
      <div>
        <p className="card-label">Foundation ready</p>
        <h2>{route.label} is the next connected view</h2>
        <p>
          The secure navigation surface is in place. Provider and catalog data will
          be connected here in the next implementation slice.
        </p>
      </div>
    </section>
  );
}

function SystemStatusBar({
  activeAgentCount,
  status
}: {
  activeAgentCount: number;
  status: SystemStatus;
}): ReactNode {
  let systemContent: ReactNode;

  if (status.state === 'loading') {
    systemContent = (
      <span className="status-item status-loading">
        <span className="status-dot" aria-hidden="true" />
        Reading local system
      </span>
    );
  } else if (status.state === 'error') {
    systemContent = (
      <span className="status-item status-warning">
        <span className="status-warning-icon" aria-hidden="true">!</span>
        System details unavailable
      </span>
    );
  } else {
    systemContent = (
      <>
        <span className="status-item status-ready">
          <span className="status-dot" aria-hidden="true" />
          {PLATFORM_LABELS[status.info.platform]} · {status.info.arch}
        </span>
        <span className="status-item">Lumora {status.info.appVersion}</span>
      </>
    );
  }

  return (
    <footer className="status-bar" role="status" aria-live="polite">
      <div className="status-cluster">{systemContent}</div>
      <div className="status-cluster status-cluster-secondary">
        <span className="status-item">
          {activeAgentCount} active {activeAgentCount === 1 ? 'agent' : 'agents'}
        </span>
        <span className="status-divider" aria-hidden="true" />
        <span className="status-item">Sandboxed renderer</span>
      </div>
    </footer>
  );
}

function AppContent(): ReactNode {
  const [startupShouldPlay, setStartupShouldPlay] = useState<boolean | null>(
    null
  );
  const [startupDismissed, setStartupDismissed] = useState(false);
  const [startupTasks, setStartupTasks] = useState(INITIAL_STARTUP_TASKS);
  const [activeRouteId, setActiveRouteId] = useState<RouteId>('home');
  const [systemStatus, setSystemStatus] = useState<SystemStatus>({
    state: 'loading'
  });
  const [providerStatus, setProviderStatus] = useState<ProviderScanStatus>({
    state: 'loading'
  });
  const [environmentStatus, setEnvironmentStatus] =
    useState<DeveloperEnvironmentStatus>({ state: 'loading' });
  const [isProviderRefreshing, setIsProviderRefreshing] = useState(false);
  const [isEnvironmentRefreshing, setIsEnvironmentRefreshing] = useState(false);
  const [catalogStatus, setCatalogStatus] = useState<CatalogViewStatus>({
    state: 'loading'
  });
  const [workspaceVisibilityPolicies, setWorkspaceVisibilityPolicies] =
    useState<readonly WorkspaceVisibilityPolicy[] | null | undefined>(undefined);
  const [workspaceVisibilityBusy, setWorkspaceVisibilityBusy] = useState(false);
  const [workspaceVisibilityError, setWorkspaceVisibilityError] =
    useState<string | null>(null);
  const [hideWorkspaceIntent, setHideWorkspaceIntent] =
    useState<WorkspaceSummary | null>(null);
  const [hiddenWorkspacesOpen, setHiddenWorkspacesOpen] = useState(false);
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string | null>(
    null
  );
  const [workspaceDetailStatus, setWorkspaceDetailStatus] =
    useState<CatalogViewStatus>({ state: 'loading' });
  const [isWorkspaceDetailRefreshing, setIsWorkspaceDetailRefreshing] =
    useState(false);
  const [workspaceDetailOperationError, setWorkspaceDetailOperationError] =
    useState<string | null>(null);
  const [isCatalogRefreshing, setIsCatalogRefreshing] = useState(false);
  const [catalogOperationError, setCatalogOperationError] = useState<
    string | null
  >(null);
  const [sessionSearch, setSessionSearch] = useState('');
  const [debouncedSessionSearch, setDebouncedSessionSearch] = useState('');
  const [sessionProvider, setSessionProvider] =
    useState<ProviderId | null>(null);
  const [dismissedSessionDiagnostics, setDismissedSessionDiagnostics] =
    useState<ReadonlySet<string>>(() => new Set());
  const [terminalProfiles, setTerminalProfiles] = useState<
    Awaited<ReturnType<typeof window.lumora.getTerminalProfiles>>
  >([]);
  const [runtimes, setRuntimes] = useState<RuntimeSummary[]>([]);
  const [openRuntimeIds, setOpenRuntimeIds] = useState<string[]>([]);
  const [activeRuntimeId, setActiveRuntimeId] = useState<string | null>(null);
  const [launchPreviews, setLaunchPreviews] = useState(
    () => new Map<string, LaunchPreview>()
  );
  const [keyboardSettings, setKeyboardSettings] = useState<KeyboardSettings>(
    DEFAULT_KEYBOARD_SETTINGS
  );
  const [generalSettings, setGeneralSettings] =
    useState<GeneralSettings | null>(null);
  const [generalSettingsSaving, setGeneralSettingsSaving] = useState(false);
  const [generalSettingsSaveError, setGeneralSettingsSaveError] =
    useState<string | null>(null);
  const [appearanceBackground, setAppearanceBackground] =
    useState<AppearanceBackgroundState>({ available: false, revision: null });
  const [appearanceBackgroundBusy, setAppearanceBackgroundBusy] =
    useState(false);
  const [appearanceBackgroundError, setAppearanceBackgroundError] =
    useState<string | null>(null);
  const [settingsCategory, setSettingsCategory] =
    useState<SettingsCategory>('general');
  const [sidebarExpanded, setSidebarExpanded] = useState(() =>
    readSidebarExpanded(window)
  );
  const [remoteLifecycleSnapshots, setRemoteLifecycleSnapshots] = useState(
    () => new Map<string, RemoteLifecycleSnapshot>()
  );
  const [terminalFocusRequestKey, setTerminalFocusRequestKey] = useState(0);
  const [runtimeMru, setRuntimeMru] = useState<string[]>([]);
  const [runtimeSwitcher, setRuntimeSwitcher] =
    useState<RuntimeSwitcherState | null>(null);
  const [newSessionIntent, setNewSessionIntent] =
    useState<NewSessionIntent | null>(null);
  const [resumeIntent, setResumeIntent] = useState<ResumeIntent | null>(null);
  const [recoveryRuntime, setRecoveryRuntime] =
    useState<RuntimeSummary | null>(null);
  const [applicationQuitRequest, setApplicationQuitRequest] =
    useState<ApplicationQuitRequest | null>(null);
  const [suppressApplicationQuitWarning, setSuppressApplicationQuitWarning] =
    useState(false);
  const providerRequestId = useRef(0);
  const environmentRequestId = useRef(0);
  const catalogRequestId = useRef(0);
  const workspaceDetailRequestId = useRef(0);
  const mainContentRef = useRef<HTMLElement | null>(null);
  const selectedWorkspaceIdRef = useRef<string | null>(selectedWorkspaceId);
  const lastActiveRuntimeIdRef = useRef<string | null>(null);

  useEffect(() => {
    writeSidebarExpanded(window, sidebarExpanded);
  }, [sidebarExpanded]);

  useEffect(() => window.lumora.onApplicationQuitRequest((request) => {
    setSuppressApplicationQuitWarning(false);
    setApplicationQuitRequest(request);
  }), []);

  const resolveApplicationQuit = useCallback(async (
    action: 'cancel' | 'exit'
  ) => {
    const suppressFutureWarning = action === 'exit' &&
      suppressApplicationQuitWarning;
    try {
      const accepted = await window.lumora.resolveApplicationQuit({
        action,
        suppressFutureWarning
      });
      if (accepted) setApplicationQuitRequest(null);
    } catch {
      setSuppressApplicationQuitWarning(false);
    }
  }, [suppressApplicationQuitWarning]);

  useEffect(() => {
    if (
      typeof window.lumora.listRemoteLifecycleSnapshots !== 'function' ||
      typeof window.lumora.onRemoteLifecycleEvent !== 'function'
    ) return;
    let active = true;
    const merge = (snapshots: readonly RemoteLifecycleSnapshot[]) => {
      if (!active) return;
      setRemoteLifecycleSnapshots((current) => {
        const next = new Map(current);
        for (const snapshot of snapshots) {
          const id = snapshot.summary.target.id;
          const existing = next.get(id);
          if (existing === undefined || snapshot.generation >= existing.generation) {
            next.set(id, snapshot);
          }
        }
        return next;
      });
    };
    const unsubscribe = window.lumora.onRemoteLifecycleEvent(({ snapshot }) => {
      merge([snapshot]);
    });
    void window.lumora.listRemoteLifecycleSnapshots().then(merge, () => undefined);
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  const resolvedTheme = resolveAppearanceTheme(
    generalSettings?.appearance.theme ?? DEFAULT_GENERAL_SETTINGS.appearance.theme
  );
  const resolvedTerminalTheme = terminalThemeFor(
    resolvedTheme,
    generalSettings?.appearance.lightTerminalInLightMode ?? false
  );

  useLayoutEffect(() => {
    document.documentElement.dataset.theme = resolvedTheme;
    document.documentElement.style.colorScheme =
      resolvedTheme === 'dark' ? 'dark' : 'light';
  }, [resolvedTheme]);

  const settleStartupTask = useCallback((task: StartupTask) => {
    setStartupTasks((current) =>
      current[task] ? current : { ...current, [task]: true }
    );
  }, []);
  selectedWorkspaceIdRef.current = selectedWorkspaceId;

  const activeRoute = useMemo(
    () => ROUTES.find((route) => route.id === activeRouteId) ?? ROUTES[0],
    [activeRouteId]
  );
  const onlineRemoteTargetCount = [...remoteLifecycleSnapshots.values()]
    .filter(({ summary }) => summary.target.connectionState === 'ready').length;

  useEffect(() => {
    if (mainContentRef.current !== null) {
      mainContentRef.current.scrollTop = 0;
    }
  }, [activeRouteId, activeRuntimeId, selectedWorkspaceId, settingsCategory]);

  const refreshProviders = useCallback(async () => {
    const requestId = providerRequestId.current + 1;
    providerRequestId.current = requestId;
    setIsProviderRefreshing(true);
    setProviderStatus((current) =>
      current.state === 'ready' ? current : { state: 'loading' }
    );

    return window.lumora.scanProviders().then(
      (scan) => {
        if (providerRequestId.current === requestId) {
          setProviderStatus({ state: 'ready', scan });
          setIsProviderRefreshing(false);
          return true;
        }
        return false;
      },
      () => {
        if (providerRequestId.current === requestId) {
          setProviderStatus((current) =>
            current.state === 'ready' ? current : { state: 'error' }
          );
          setIsProviderRefreshing(false);
          return true;
        }
        return false;
      }
    );
  }, []);

  const refreshEnvironment = useCallback(async () => {
    const requestId = environmentRequestId.current + 1;
    environmentRequestId.current = requestId;
    setIsEnvironmentRefreshing(true);
    setEnvironmentStatus((current) =>
      current.state === 'ready' ? current : { state: 'loading' }
    );

    return window.lumora.scanDeveloperEnvironment().then(
      (scan) => {
        if (environmentRequestId.current === requestId) {
          setEnvironmentStatus({ state: 'ready', scan });
          setIsEnvironmentRefreshing(false);
          return true;
        }
        return false;
      },
      () => {
        if (environmentRequestId.current === requestId) {
          setEnvironmentStatus((current) =>
            current.state === 'ready' ? current : { state: 'error' }
          );
          setIsEnvironmentRefreshing(false);
          return true;
        }
        return false;
      }
    );
  }, []);

  const openNodeDownload = useCallback(
    () => window.lumora.openNodeDownloadPage(),
    []
  );

  useEffect(() => {
    let isCurrent = true;
    void window.lumora.claimStartupPresentation().then(
      (shouldPlay) => {
        if (isCurrent) setStartupShouldPlay(shouldPlay);
      },
      () => {
        if (isCurrent) setStartupShouldPlay(false);
      }
    );
    return () => {
      isCurrent = false;
    };
  }, []);

  useEffect(() => {
    let isCurrent = true;

    void window.lumora.getSystemInfo().then(
      (info) => {
        if (isCurrent) {
          setSystemStatus({ state: 'ready', info });
          settleStartupTask('system');
        }
      },
      () => {
        if (isCurrent) {
          setSystemStatus({ state: 'error' });
          settleStartupTask('system');
        }
      }
    );

    return () => {
      isCurrent = false;
    };
  }, [settleStartupTask]);

  useEffect(() => {
    let isCurrent = true;
    void window.lumora.getKeyboardSettings().then(
      (settings) => {
        if (isCurrent) {
          setKeyboardSettings(settings);
          settleStartupTask('keyboard');
        }
      },
      () => {
        if (isCurrent) settleStartupTask('keyboard');
      }
    );
    return () => {
      isCurrent = false;
    };
  }, [settleStartupTask]);

  useEffect(() => {
    let isCurrent = true;
    let requestId = 0;
    const loadGeneralSettings = (startup: boolean) => {
      const currentRequest = ++requestId;
      void window.lumora.getGeneralSettings().then(
        (settings) => {
          if (isCurrent && currentRequest === requestId) {
            setGeneralSettings(settings);
          }
          if (startup && isCurrent) settleStartupTask('generalSettings');
        },
        () => {
          if (startup && isCurrent && currentRequest === requestId) {
            setGeneralSettings(DEFAULT_GENERAL_SETTINGS);
          }
          if (startup && isCurrent) settleStartupTask('generalSettings');
        }
      );
    };
    const unsubscribe = typeof window.lumora.onGeneralSettingsChanged === 'function'
      ? window.lumora.onGeneralSettingsChanged(() => loadGeneralSettings(false))
      : () => undefined;
    loadGeneralSettings(true);
    return () => {
      isCurrent = false;
      unsubscribe();
    };
  }, [settleStartupTask]);

  useEffect(() => {
    let isCurrent = true;
    void window.lumora.getWorkspaceVisibilityPolicies().then(
      (policies) => {
        if (isCurrent) {
          setWorkspaceVisibilityPolicies(policies);
          settleStartupTask('workspaceVisibility');
        }
      },
      () => {
        if (isCurrent) {
          setWorkspaceVisibilityPolicies(null);
          settleStartupTask('workspaceVisibility');
        }
      }
    );
    return () => {
      isCurrent = false;
    };
  }, [settleStartupTask]);

  useEffect(() => {
    let isCurrent = true;
    void window.lumora.getAppearanceBackground().then(
      (state) => {
        if (isCurrent) {
          setAppearanceBackground(state);
          settleStartupTask('appearanceBackground');
        }
      },
      () => {
        if (isCurrent) settleStartupTask('appearanceBackground');
      }
    );
    return () => {
      isCurrent = false;
    };
  }, [settleStartupTask]);

  useEffect(() => {
    void refreshProviders();
    settleStartupTask('providers');

    return () => {
      providerRequestId.current += 1;
    };
  }, [refreshProviders, settleStartupTask]);

  useEffect(() => {
    void refreshEnvironment();
    settleStartupTask('environment');

    return () => {
      environmentRequestId.current += 1;
    };
  }, [refreshEnvironment, settleStartupTask]);

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
    lastActiveRuntimeIdRef.current = runtimeId;
    setOpenRuntimeIds((current) =>
      current.includes(runtimeId) ? current : [...current, runtimeId]
    );
    setRuntimeMru((current) => touchRuntimeMru(current, runtimeId));
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

  const openCatalogSession = useCallback((
    session: SessionSummary,
    workspace: WorkspaceSummary
  ) => {
    setNewSessionIntent(null);
    setRecoveryRuntime(null);
    const runningRuntime = liveRuntimeBySessionId.get(session.id);
    if (runningRuntime !== undefined) {
      setResumeIntent(null);
      activateRuntime(runningRuntime.id);
      setTerminalFocusRequestKey((current) => current + 1);
      return;
    }
    setResumeIntent({ session, workspace });
  }, [activateRuntime, liveRuntimeBySessionId]);

  const reorderRuntimeTab = useCallback(
    (runtimeId: string, destinationIndex: number) => {
      setOpenRuntimeIds((current) => {
        const next = moveRuntimeTab(current, runtimeId, destinationIndex);
        return next === current ? current : [...next];
      });
    },
    []
  );

  const closeRuntimeTab = useCallback((runtimeId: string) => {
    setRuntimeMru((current) => current.filter((id) => id !== runtimeId));
    setOpenRuntimeIds((current) => {
      const next = current.filter((id) => id !== runtimeId);
      setActiveRuntimeId((active) =>
        active === runtimeId ? (next[0] ?? null) : active
      );
      return next;
    });
  }, []);

  const backgroundRefreshCatalog = useCallback(async () => {
    const fullSnapshot = await window.lumora.refreshCatalog(EMPTY_CATALOG_QUERY);
    const requestId = catalogRequestId.current + 1;
    catalogRequestId.current = requestId;
    if (catalogRequestId.current === requestId) {
      setCatalogStatus({ state: 'ready', snapshot: fullSnapshot });
      setCatalogOperationError(null);
    }
    if (selectedWorkspaceIdRef.current !== null) {
      workspaceDetailRequestId.current += 1;
      setWorkspaceDetailStatus({ state: 'ready', snapshot: fullSnapshot });
      setIsWorkspaceDetailRefreshing(false);
      setWorkspaceDetailOperationError(null);
    }
  }, []);
  const { scheduleAfterExit } = useCatalogAutoRefresh({
    refresh: backgroundRefreshCatalog
  });

  useEffect(() => {
    let current = true;
    void window.lumora.getTerminalProfiles().then(
      (profiles) => {
        if (current) {
          setTerminalProfiles(profiles);
          settleStartupTask('profiles');
        }
      },
      () => {
        if (current) settleStartupTask('profiles');
      }
    );
    void window.lumora.listRuntimes().then(
      (values) => {
        if (!current) return;
        setRuntimes(values);
        setOpenRuntimeIds(
          values
            .filter((runtime) =>
              runtime.state === 'launching' || runtime.state === 'running'
            )
            .map((runtime) => runtime.id)
        );
        settleStartupTask('runtimes');
      },
      () => {
        if (current) settleStartupTask('runtimes');
      }
    );
    const unsubscribe = window.lumora.onRuntimeEvent((event) => {
      if (event.type !== 'state') {
        return;
      }
      updateRuntime(event.runtime);
      if (
        event.runtime.state === 'completed' ||
        event.runtime.state === 'failed'
      ) {
        closeRuntimeTab(event.runtimeId);
        scheduleAfterExit();
      }
    });
    return () => {
      current = false;
      unsubscribe();
    };
  }, [closeRuntimeTab, scheduleAfterExit, settleStartupTask, updateRuntime]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedSessionSearch(sessionSearch.trim());
    }, 150);
    return () => window.clearTimeout(timer);
  }, [sessionSearch]);

  useEffect(() => {
    const requestId = catalogRequestId.current + 1;
    catalogRequestId.current = requestId;
    setCatalogStatus({ state: 'loading' });

    void window.lumora.getCatalog(EMPTY_CATALOG_QUERY).then(
      (snapshot) => {
        if (catalogRequestId.current !== requestId) {
          return;
        }
        setCatalogStatus({ state: 'ready', snapshot });
        settleStartupTask('catalog');

        const refreshRequestId = catalogRequestId.current + 1;
        catalogRequestId.current = refreshRequestId;
        setIsCatalogRefreshing(true);
        void window.lumora.refreshCatalog(EMPTY_CATALOG_QUERY).then(
          (refreshedSnapshot) => {
            if (catalogRequestId.current === refreshRequestId) {
              setCatalogStatus({ state: 'ready', snapshot: refreshedSnapshot });
              setCatalogOperationError(null);
              setIsCatalogRefreshing(false);
            }
          },
          () => {
            if (catalogRequestId.current === refreshRequestId) {
              setCatalogOperationError(
                'Catalog refresh failed. Last saved data is still shown.'
              );
              setIsCatalogRefreshing(false);
            }
          }
        );
      },
      () => {
        if (catalogRequestId.current === requestId) {
          setCatalogStatus({ state: 'error' });
          settleStartupTask('catalog');
        }
      }
    );

    return () => {
      catalogRequestId.current += 1;
    };
  }, [settleStartupTask]);

  const refreshCatalogWithQuery = useCallback((_query: CatalogQuery) => {
    const requestId = catalogRequestId.current + 1;
    catalogRequestId.current = requestId;
    setIsCatalogRefreshing(true);
    setCatalogOperationError(null);
    return window.lumora.refreshCatalog(EMPTY_CATALOG_QUERY).then(
      (snapshot) => {
        if (catalogRequestId.current === requestId) {
          setCatalogStatus({ state: 'ready', snapshot });
          setIsCatalogRefreshing(false);
          return true;
        }
        return false;
      },
      () => {
        if (catalogRequestId.current === requestId) {
          setCatalogOperationError(
            catalogStatus.state === 'ready'
              ? 'Catalog refresh failed. Last saved data is still shown.'
              : 'Catalog refresh failed. Try again.'
          );
          if (catalogStatus.state !== 'ready') {
            setCatalogStatus({ state: 'error' });
          }
          setIsCatalogRefreshing(false);
          return false;
        }
        return false;
      }
    );
  }, [catalogStatus.state]);

  const refreshCatalog = useCallback(
    () =>
      refreshCatalogWithQuery({
        text: debouncedSessionSearch,
        provider: sessionProvider
      }),
    [debouncedSessionSearch, refreshCatalogWithQuery, sessionProvider]
  );

  const addWorkspace = useCallback(() => {
    const requestId = catalogRequestId.current + 1;
    catalogRequestId.current = requestId;
    setCatalogOperationError(null);
    void window.lumora.chooseWorkspace().then(
      (snapshot) => {
        if (catalogRequestId.current !== requestId) {
          return;
        }
        setIsCatalogRefreshing(false);
        if (snapshot !== null) {
          setCatalogStatus({ state: 'ready', snapshot });
        }
      },
      () => {
        if (catalogRequestId.current === requestId) {
          setCatalogOperationError('Workspace could not be added. Try again.');
          setIsCatalogRefreshing(false);
        }
      }
    );
  }, []);

  const openWorkspaceDetail = useCallback((workspaceId: string) => {
    const requestId = workspaceDetailRequestId.current + 1;
    workspaceDetailRequestId.current = requestId;
    setSelectedWorkspaceId(workspaceId);
    setWorkspaceDetailStatus({ state: 'loading' });
    setIsWorkspaceDetailRefreshing(false);
    setWorkspaceDetailOperationError(null);

    void window.lumora.getCatalog(EMPTY_CATALOG_QUERY).then(
      (snapshot) => {
        if (workspaceDetailRequestId.current === requestId) {
          setWorkspaceDetailStatus({ state: 'ready', snapshot });
        }
      },
      () => {
        if (workspaceDetailRequestId.current === requestId) {
          setWorkspaceDetailStatus({ state: 'error' });
        }
      }
    );
  }, []);

  const closeWorkspaceDetail = useCallback(() => {
    workspaceDetailRequestId.current += 1;
    setIsWorkspaceDetailRefreshing(false);
    setWorkspaceDetailOperationError(null);
    setSelectedWorkspaceId(null);
  }, []);

  const refreshWorkspaceDetail = useCallback(() => {
    if (selectedWorkspaceId === null) {
      return;
    }

    const requestId = workspaceDetailRequestId.current + 1;
    workspaceDetailRequestId.current = requestId;
    setIsWorkspaceDetailRefreshing(true);
    setWorkspaceDetailOperationError(null);
    void window.lumora.refreshCatalog(EMPTY_CATALOG_QUERY).then(
      (snapshot) => {
        if (workspaceDetailRequestId.current === requestId) {
          setWorkspaceDetailStatus({ state: 'ready', snapshot });
          setIsWorkspaceDetailRefreshing(false);
        }
      },
      () => {
        if (workspaceDetailRequestId.current === requestId) {
          setWorkspaceDetailOperationError(
            'Workspace sessions refresh failed. Last saved data is still shown.'
          );
          setIsWorkspaceDetailRefreshing(false);
        }
      }
    );
  }, [selectedWorkspaceId]);

  const hideWorkspace = useCallback(async (mode: WorkspaceVisibilityMode) => {
    if (hideWorkspaceIntent === null || workspaceVisibilityBusy) return;
    setWorkspaceVisibilityBusy(true);
    setWorkspaceVisibilityError(null);
    try {
      const policies = await window.lumora.setWorkspaceVisibilityPolicy({
        workspaceId: hideWorkspaceIntent.id,
        mode
      });
      setWorkspaceVisibilityPolicies(policies);
      if (selectedWorkspaceIdRef.current === hideWorkspaceIntent.id) {
        closeWorkspaceDetail();
      }
      setHideWorkspaceIntent(null);
    } catch {
      setWorkspaceVisibilityError(
        'Lumora could not hide this workspace. Try again.'
      );
    } finally {
      setWorkspaceVisibilityBusy(false);
    }
  }, [closeWorkspaceDetail, hideWorkspaceIntent, workspaceVisibilityBusy]);

  const restoreWorkspaceVisibility = useCallback(async (
    workspaceIds: readonly string[]
  ) => {
    if (workspaceIds.length === 0 || workspaceVisibilityBusy) return;
    setWorkspaceVisibilityBusy(true);
    setWorkspaceVisibilityError(null);
    try {
      const policies = await window.lumora.restoreWorkspaceVisibility({
        workspaceIds: [...workspaceIds]
      });
      setWorkspaceVisibilityPolicies(policies);
    } catch {
      setWorkspaceVisibilityError(
        'Lumora could not restore the selected workspaces. Try again.'
      );
    } finally {
      setWorkspaceVisibilityBusy(false);
    }
  }, [workspaceVisibilityBusy]);

  const restoreAllWorkspaceVisibility = useCallback(async () => {
    if (workspaceVisibilityBusy) return;
    setWorkspaceVisibilityBusy(true);
    setWorkspaceVisibilityError(null);
    try {
      const policies = await window.lumora.restoreAllWorkspaceVisibility();
      setWorkspaceVisibilityPolicies(policies);
    } catch {
      setWorkspaceVisibilityError(
        'Lumora could not restore hidden workspaces. Try again.'
      );
    } finally {
      setWorkspaceVisibilityBusy(false);
    }
  }, [workspaceVisibilityBusy]);

  const handleRuntimeStarted = useCallback(
    (runtime: RuntimeSummary, preview: LaunchPreview) => {
      updateRuntime(runtime);
      setOpenRuntimeIds((current) =>
        current.includes(runtime.id) ? current : [...current, runtime.id]
      );
      setLaunchPreviews((current) => {
        const next = new Map(current);
        next.set(runtime.id, preview);
        return next;
      });
      activateRuntime(runtime.id);
      setNewSessionIntent(null);
      setResumeIntent(null);
      setRecoveryRuntime(null);
    },
    [activateRuntime, updateRuntime]
  );

  const resumeCatalogSession = useCallback(
    (session: SessionSummary) => {
      if (catalogStatus.state !== 'ready') {
        return;
      }
      const workspace = catalogStatus.snapshot.workspaces.find(
        (candidate) => candidate.id === session.workspaceId
      );
      if (workspace === undefined) {
        return;
      }
      openCatalogSession(session, workspace);
    },
    [catalogStatus, openCatalogSession]
  );

  const resumeWorkspaceSession = useCallback(
    (session: SessionSummary) => {
      if (workspaceDetailStatus.state !== 'ready') {
        return;
      }
      const workspace = workspaceDetailStatus.snapshot.workspaces.find(
        (candidate) => candidate.id === session.workspaceId
      );
      if (workspace === undefined) {
        return;
      }
      openCatalogSession(session, workspace);
    },
    [openCatalogSession, workspaceDetailStatus]
  );

  useEffect(() => {
    let current = true;
    const unsubscribe = window.lumora.onTrayResumeSessionRequested(
      (sessionId) => {
        void window.lumora.getCatalog(EMPTY_CATALOG_QUERY).then(
          (snapshot) => {
            if (!current) return;
            const session = snapshot.sessions.find(
              (candidate) => candidate.id === sessionId
            );
            const workspace = session === undefined
              ? undefined
              : snapshot.workspaces.find(
                  (candidate) => candidate.id === session.workspaceId
                );
            if (session === undefined || workspace === undefined) {
              setCatalogOperationError(
                'The selected recent session is no longer available.'
              );
              return;
            }
            setCatalogOperationError(null);
            openCatalogSession(session, workspace);
          },
          () => {
            if (current) {
              setCatalogOperationError(
                'The selected recent session could not be loaded.'
              );
            }
          }
        );
      }
    );
    return () => {
      current = false;
      unsubscribe();
    };
  }, [openCatalogSession]);

  const openRuntimes = openRuntimeIds
    .map((id) => runtimes.find((runtime) => runtime.id === id))
    .filter((runtime): runtime is RuntimeSummary => runtime !== undefined);
  const liveRuntimes = runtimes.filter(
    (runtime) => runtime.state === 'launching' || runtime.state === 'running'
  );
  const terminalActive = activeRuntimeId !== null && openRuntimes.length > 0;
  const liveRuntimesRef = useRef(liveRuntimes);
  liveRuntimesRef.current = liveRuntimes;
  const runtimeSwitcherRuntimes = runtimeSwitcher === null
    ? []
    : runtimeSwitcher.order
        .map((id) => openRuntimes.find((runtime) => runtime.id === id))
        .filter((runtime): runtime is RuntimeSummary => runtime !== undefined);
  const openLiveTerminals = useCallback(() => {
    const liveIds = liveRuntimesRef.current.map((runtime) => runtime.id);
    setOpenRuntimeIds((current) => [
      ...current,
      ...liveIds.filter((id) => !current.includes(id))
    ]);
    const rememberedRuntimeId = lastActiveRuntimeIdRef.current;
    const nextActive =
      rememberedRuntimeId !== null && liveIds.includes(rememberedRuntimeId)
        ? rememberedRuntimeId
        : (liveIds[0] ?? null);
    if (nextActive === null) {
      setActiveRuntimeId(null);
    } else {
      activateRuntime(nextActive);
      setTerminalFocusRequestKey((current) => current + 1);
    }
  }, [activateRuntime]);
  const navigateToRoute = useCallback(
    (routeId: RouteId) => {
      closeWorkspaceDetail();
      if (routeId === 'settings') {
        setSettingsCategory('general');
      }
      setActiveRouteId(routeId);
      setActiveRuntimeId(null);
      if (
        (generalSettings ?? DEFAULT_GENERAL_SETTINGS).autoExpandSidebar
      ) {
        setSidebarExpanded(true);
      }
    },
    [closeWorkspaceDetail, generalSettings]
  );

  useEffect(() => {
    setRuntimeMru((current) =>
      buildRuntimeMru(openRuntimeIds, current, activeRuntimeId)
    );
    setRuntimeSwitcher((current) => {
      if (current === null) return null;
      return reconcileRuntimeSwitch(current, openRuntimeIds);
    });
  }, [activeRuntimeId, openRuntimeIds]);

  useEffect(() => {
    const switcherChord = keyboardSettings.terminalSwitcher;
    const keydown = (event: KeyboardEvent) => {
      if (
        event.target instanceof Element &&
        event.target.closest('.shortcut-recorder[aria-pressed="true"]') !== null
      ) {
        return;
      }
      if (runtimeSwitcher !== null && event.code === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        setRuntimeSwitcher(null);
        return;
      }
      if (keyboardEventMatchesChord(event, switcherChord)) {
        if (openRuntimeIds.length === 0) return;

        event.preventDefault();
        event.stopPropagation();
        if (event.repeat) return;
        if (openRuntimeIds.length === 1) {
          activateRuntime(openRuntimeIds[0]!);
          setRuntimeSwitcher(null);
          return;
        }

        setRuntimeSwitcher((current) => {
          if (current !== null) {
            return {
              ...current,
              selectedRuntimeId:
                nextRuntimeInOrder(current.order, current.selectedRuntimeId) ??
                current.selectedRuntimeId
            };
          }
          const order = buildRuntimeMru(
            openRuntimeIds,
            runtimeMru,
            activeRuntimeId
          );
          const selectedRuntimeId =
            nextRuntimeInOrder(order, activeRuntimeId) ?? order[0];
          return selectedRuntimeId === undefined
            ? null
            : { order, selectedRuntimeId };
        });
        return;
      }

      if (event.repeat) return;
      if (
        keyboardEventMatchesChord(event, keyboardSettings.toggleSidebar)
      ) {
        event.preventDefault();
        event.stopPropagation();
        setSidebarExpanded((expanded) => !expanded);
        return;
      }

      if (
        keyboardEventMatchesChord(event, keyboardSettings.openTerminals) &&
        liveRuntimesRef.current.length > 0
      ) {
        event.preventDefault();
        event.stopPropagation();
        openLiveTerminals();
        return;
      }

      const routeShortcuts: ReadonlyArray<
        readonly [KeyboardSettings['terminalSwitcher'], RouteId]
      > = [
        [keyboardSettings.openHome, 'home'],
        [keyboardSettings.openWorkspaces, 'workspaces'],
        [keyboardSettings.openSessions, 'sessions'],
        [keyboardSettings.openProfiles, 'profiles'],
        [keyboardSettings.openRemote, 'remote'],
        [keyboardSettings.openSettings, 'settings']
      ];
      const destination = routeShortcuts.find(([shortcut]) =>
        keyboardEventMatchesChord(event, shortcut)
      )?.[1];
      if (destination !== undefined) {
        event.preventDefault();
        event.stopPropagation();
        navigateToRoute(destination);
      }
    };
    const keyup = (event: KeyboardEvent) => {
      if (runtimeSwitcher === null) return;
      if (!isRequiredModifierKey(event.code, switcherChord)) return;

      event.preventDefault();
      event.stopPropagation();
      const selectedRuntimeId = runtimeSwitcher.selectedRuntimeId;
      setRuntimeSwitcher(null);
      if (openRuntimeIds.includes(selectedRuntimeId)) {
        activateRuntime(selectedRuntimeId);
      }
    };

    window.addEventListener('keydown', keydown, true);
    window.addEventListener('keyup', keyup, true);
    return () => {
      window.removeEventListener('keydown', keydown, true);
      window.removeEventListener('keyup', keyup, true);
    };
  }, [
    activeRuntimeId,
    activateRuntime,
    keyboardSettings,
    liveRuntimes.length,
    navigateToRoute,
    openLiveTerminals,
    openRuntimeIds,
    runtimeMru,
    runtimeSwitcher,
    terminalActive
  ]);

  const sidebarToggleLabel = sidebarExpanded
    ? 'Collapse sidebar'
    : 'Expand sidebar';
  const shortcutPlatform =
    systemStatus.state === 'ready' ? systemStatus.info.platform : null;
  const sidebarToggleShortcut =
    shortcutPlatform === null
      ? undefined
      : formatShortcutChord(keyboardSettings.toggleSidebar, shortcutPlatform);
  const dismissSessionDiagnostic = useCallback((identity: string) => {
    setDismissedSessionDiagnostics((current) => {
      if (current.has(identity)) return current;
      const next = new Set(current);
      next.add(identity);
      return next;
    });
  }, []);
  const updateGeneralSettings = useCallback(
    async (next: GeneralSettings) => {
      const previous = generalSettings ?? DEFAULT_GENERAL_SETTINGS;
      setGeneralSettings(next);
      setGeneralSettingsSaving(true);
      setGeneralSettingsSaveError(null);

      try {
        setGeneralSettings(await window.lumora.saveGeneralSettings(next));
      } catch {
        setGeneralSettings(previous);
        setGeneralSettingsSaveError(
          previous.showInformationalNotices !== next.showInformationalNotices
            ? 'Lumora could not save the informational notice setting.'
            : 'Lumora could not save this setting.'
        );
      } finally {
        setGeneralSettingsSaving(false);
      }
    },
    [generalSettings]
  );
  const chooseAppearanceBackground = useCallback(async () => {
    setAppearanceBackgroundBusy(true);
    setAppearanceBackgroundError(null);
    try {
      const state = await window.lumora.chooseAppearanceBackground();
      setAppearanceBackground(state);
      if (state.available) {
        const current = generalSettings ?? DEFAULT_GENERAL_SETTINGS;
        if (!current.appearance.backgroundEnabled) {
          await updateGeneralSettings({
            ...current,
            appearance: { ...current.appearance, backgroundEnabled: true }
          });
        }
      }
    } catch {
      setAppearanceBackgroundError(
        'Lumora could not use that image. Choose a valid PNG, JPEG, or WebP file under 25 MB.'
      );
    } finally {
      setAppearanceBackgroundBusy(false);
    }
  }, [generalSettings, updateGeneralSettings]);
  const removeAppearanceBackground = useCallback(async () => {
    setAppearanceBackgroundBusy(true);
    setAppearanceBackgroundError(null);
    try {
      const state = await window.lumora.removeAppearanceBackground();
      setAppearanceBackground(state);
      const current = generalSettings ?? DEFAULT_GENERAL_SETTINGS;
      if (current.appearance.backgroundEnabled) {
        await updateGeneralSettings({
          ...current,
          appearance: { ...current.appearance, backgroundEnabled: false }
        });
      }
    } catch {
      setAppearanceBackgroundError('Lumora could not remove the managed image.');
    } finally {
      setAppearanceBackgroundBusy(false);
    }
  }, [generalSettings, updateGeneralSettings]);
  const saveEnabledProviders = useCallback(
    async (enabledProviders: readonly ProviderId[]): Promise<boolean> => {
      const previous = generalSettings ?? DEFAULT_GENERAL_SETTINGS;
      const next: GeneralSettings = {
        ...previous,
        enabledProviders: [...enabledProviders]
      };
      setGeneralSettings(next);
      setGeneralSettingsSaving(true);
      setGeneralSettingsSaveError(null);

      try {
        const saved = await window.lumora.saveGeneralSettings(next);
        setGeneralSettings(saved);
        const provider =
          sessionProvider !== null &&
          !saved.enabledProviders.includes(sessionProvider)
            ? null
            : sessionProvider;
        if (provider !== sessionProvider) {
          setSessionProvider(provider);
        }
        await Promise.all([
          refreshProviders(),
          refreshCatalogWithQuery({
            text: debouncedSessionSearch,
            provider
          })
        ]);
        return true;
      } catch {
        setGeneralSettings(previous);
        setGeneralSettingsSaveError(
          'Lumora could not save the provider selection.'
        );
        return false;
      } finally {
        setGeneralSettingsSaving(false);
      }
    },
    [
      debouncedSessionSearch,
      generalSettings,
      refreshCatalogWithQuery,
      refreshProviders,
      sessionProvider
    ]
  );
  const dismissStartupPresentation = useCallback(() => {
    setStartupDismissed(true);
    void window.lumora.completeStartupPresentation().catch(() => undefined);
  }, []);
  const startupReady = Object.values(startupTasks).every(Boolean);
  const startupPresentationActive =
    startupShouldPlay === true && !startupDismissed;
  const startupCatalogStatus: CatalogViewStatus =
    startupShouldPlay === true && !startupTasks.catalog
      ? { state: 'loading' }
      : catalogStatus;
  const catalogPresentation = useMemo(() =>
    startupCatalogStatus.state === 'ready' &&
    workspaceVisibilityPolicies !== undefined
      ? projectCatalogVisibility({
          snapshot: startupCatalogStatus.snapshot,
          policies: workspaceVisibilityPolicies,
          settings: generalSettings ?? DEFAULT_GENERAL_SETTINGS,
          providerScan:
            providerStatus.state === 'ready' ? providerStatus.scan : null,
          profiles: terminalProfiles,
          query: {
            text: debouncedSessionSearch,
            provider: sessionProvider
          }
        })
      : null,
  [
    debouncedSessionSearch,
    generalSettings,
    providerStatus,
    sessionProvider,
    startupCatalogStatus,
    terminalProfiles,
    workspaceVisibilityPolicies
  ]);
  const visibilityCatalogStatus: CatalogViewStatus =
    startupCatalogStatus.state === 'ready' &&
    workspaceVisibilityPolicies === undefined
      ? { state: 'loading' }
      : startupCatalogStatus;
  const visibleCatalogStatus: CatalogViewStatus = catalogPresentation === null
    ? visibilityCatalogStatus
    : { state: 'ready', snapshot: catalogPresentation.snapshot };
  useEffect(() => {
    if (
      catalogPresentation !== null &&
      sessionProvider !== null &&
      !catalogPresentation.snapshot.providerFacets.some(
        ({ provider }) => provider === sessionProvider
      )
    ) {
      setSessionProvider(null);
    }
  }, [catalogPresentation, sessionProvider]);
  const visibleWorkspaceDetailStatus = useMemo<CatalogViewStatus>(() => {
    if (workspaceDetailStatus.state !== 'ready') return workspaceDetailStatus;
    if (workspaceVisibilityPolicies === undefined) return { state: 'loading' };
    return {
      state: 'ready',
      snapshot: projectCatalogVisibility({
        snapshot: workspaceDetailStatus.snapshot,
        policies: workspaceVisibilityPolicies,
        settings: generalSettings ?? DEFAULT_GENERAL_SETTINGS,
        providerScan:
          providerStatus.state === 'ready' ? providerStatus.scan : null,
        profiles: terminalProfiles,
        query: EMPTY_CATALOG_QUERY
      }).snapshot
    };
  }, [
    generalSettings,
    providerStatus,
    terminalProfiles,
    workspaceDetailStatus,
    workspaceVisibilityPolicies
  ]);
  const appearance = generalSettings?.appearance ??
    DEFAULT_GENERAL_SETTINGS.appearance;
  const appearancePresentation = buildAppearancePresentation(
    appearance,
    appearanceBackground
  );
  const appearanceBackgroundActive = appearancePresentation.backgroundActive;
  const appearanceShellStyle = appearancePresentation.shellStyle;
  const appearanceBackgroundStyle = appearancePresentation.backgroundStyle;

  return (
    <>
      <LumoraShell
        activeRouteId={activeRouteId}
        appearance={{
          backgroundActive: appearanceBackgroundActive,
          backgroundStyle: appearanceBackgroundStyle,
          hasSurfaceMosaic: appearancePresentation.hasSurfaceMosaic,
          shellStyle: appearanceShellStyle,
          theme: resolvedTheme
        }}
        ariaHidden={startupPresentationActive ? true : undefined}
        className={terminalActive ? 'terminal-active' : ''}
        hidePageHeader={terminalActive}
        mainClassName={terminalActive ? 'terminal-main-content' : ''}
        mainRef={mainContentRef}
        navigationActive={!terminalActive}
        onNavigate={navigateToRoute}
        onToggleSidebar={() => setSidebarExpanded((expanded) => !expanded)}
        pageHeader={{
          description: activeRoute.description,
          eyebrow: activeRoute.eyebrow,
          label: activeRoute.label
        }}
        primaryNavigation={{
          ariaLabel: 'Primary navigation',
          label: 'Workspace',
          routes: PRIMARY_ROUTES.map((route) => ({
            id: route.id,
            icon: route.icon,
            label: route.label,
            shortcut:
              shortcutPlatform === null || route.shortcut === null
                ? undefined
                : formatShortcutChord(
                    keyboardSettings[route.shortcut],
                    shortcutPlatform
                  ),
            status: route.id === 'remote' && onlineRemoteTargetCount > 0
              ? `${onlineRemoteTargetCount} ${onlineRemoteTargetCount === 1
                  ? 'computer'
                  : 'computers'} online`
              : undefined
          }))
        }}
        secondaryNavigation={{
          label: 'Application',
          routes: [
            {
              id: SETTINGS_ROUTE.id,
              icon: SETTINGS_ROUTE.icon,
              label: SETTINGS_ROUTE.label,
              shortcut: shortcutPlatform === null
                ? undefined
                : formatShortcutChord(
                    keyboardSettings.openSettings,
                    shortcutPlatform
                  )
            }
          ]
        }}
        sidebarExpanded={sidebarExpanded}
        sidebarToggleShortcut={sidebarToggleShortcut}
        topbar={{
          context: 'Private by default · Native provider sessions',
          kicker: 'Local control plane',
          actions: (
            <>
            {activeRuntimeId === null && liveRuntimes.length > 0 ? (
              <button className="secondary-button" data-lumora-command onClick={openLiveTerminals} tabIndex={-1} type="button">
                Open terminals
              </button>
            ) : null}
            {activeRuntimeId === null &&
            (activeRoute.id === 'home' || activeRoute.id === 'workspaces') &&
            visibleCatalogStatus.state === 'ready' &&
            visibleCatalogStatus.snapshot.workspaces.some((workspace) => workspace.available) ? (
              <button
                className="refresh-button"
                data-lumora-command
                onClick={() => {
                  setResumeIntent(null);
                  setRecoveryRuntime(null);
                  setNewSessionIntent({
                    initialWorkspaceId:
                      activeRoute.id === 'workspaces'
                        ? selectedWorkspaceId
                        : null
                  });
                }}
                tabIndex={-1}
                type="button"
              >
                New session
              </button>
            ) : null}
            </>
          )
        }}
        main={
          <>
          {catalogOperationError === null ? null : (
            <div className="catalog-operation-error" role="alert">
              {catalogOperationError}
            </div>
          )}

          {terminalActive ? null : (
            <DeveloperEnvironmentNotice
              onOpenNodeDownload={openNodeDownload}
              status={environmentStatus}
            />
          )}

          <div className="route-surface" hidden={terminalActive}>
            <RegionErrorBoundary
              description="Lumora kept navigation, terminals, and saved data available. Retry only this page when you are ready."
              heading="Page unavailable"
              resetKey={`${activeRouteId}:${selectedWorkspaceId ?? ''}:${settingsCategory}`}
              retryLabel="Retry page"
            >
            {activeRoute.id === 'home' ? (
              <CatalogHomeSummary
                onRecover={(runtime) => {
                  setNewSessionIntent(null);
                  setResumeIntent(null);
                  setRecoveryRuntime(runtime);
                }}
                onResume={resumeCatalogSession}
                profiles={terminalProfiles}
                providerScan={
                  providerStatus.state === 'ready' ? providerStatus.scan : null
                }
                providerSummary={providerSummary(providerStatus)}
                runningSessionIds={runningSessionIds}
                runtimes={runtimes}
                status={visibleCatalogStatus}
                workspaceById={catalogPresentation?.workspaceById}
              />
            ) : activeRoute.id === 'workspaces' ? (
              selectedWorkspaceId === null ? (
                <WorkspacesView
                  hiddenWorkspaceCount={catalogPresentation?.hiddenWorkspaces.length ?? 0}
                  isRefreshing={isCatalogRefreshing}
                  onAddWorkspace={addWorkspace}
                  onHideWorkspace={(workspace) => {
                    setWorkspaceVisibilityError(null);
                    setHideWorkspaceIntent(workspace);
                  }}
                  onManageHiddenWorkspaces={() => {
                    setWorkspaceVisibilityError(null);
                    setHiddenWorkspacesOpen(true);
                  }}
                  onOpenWorkspace={openWorkspaceDetail}
                  onRefresh={refreshCatalog}
                  status={visibleCatalogStatus}
                />
              ) : (
                <WorkspaceSessionsView
                  isRefreshing={isWorkspaceDetailRefreshing}
                  onBack={closeWorkspaceDetail}
                  onRefresh={refreshWorkspaceDetail}
                  onResume={resumeWorkspaceSession}

                  onRetry={() => openWorkspaceDetail(selectedWorkspaceId)}
                  operationError={workspaceDetailOperationError}
                  profiles={terminalProfiles}
                  providerScan={
                    providerStatus.state === 'ready' ? providerStatus.scan : null
                  }
                  runningSessionIds={runningSessionIds}
                  status={visibleWorkspaceDetailStatus}
                  workspaceId={selectedWorkspaceId}
                />
              )
            ) : activeRoute.id === 'sessions' ? (
              <SessionsView
                dismissedDiagnosticIds={dismissedSessionDiagnostics}
                isRefreshing={isCatalogRefreshing}
                onDismissDiagnostic={dismissSessionDiagnostic}
                onProviderChange={setSessionProvider}
                onRefresh={refreshCatalog}
                onResume={resumeCatalogSession}

                onSearchChange={setSessionSearch}
                provider={sessionProvider}
                providerScan={
                  providerStatus.state === 'ready' ? providerStatus.scan : null
                }
                profiles={terminalProfiles}
                queryText={sessionSearch}
                runningSessionIds={runningSessionIds}
                showInformationalNotices={
                  generalSettings?.showInformationalNotices ?? false
                }
                status={visibleCatalogStatus}
                workspaceById={catalogPresentation?.workspaceById}
              />
            ) : activeRoute.id === 'settings' ? (
              <SettingsView
                activeCategory={settingsCategory}
                appearanceBackground={appearanceBackground}
                appearanceBackgroundBusy={appearanceBackgroundBusy}
                appearanceBackgroundError={appearanceBackgroundError}
                catalogReady={visibleCatalogStatus.state === 'ready'}
                environmentStatus={environmentStatus}
                environmentRefreshing={isEnvironmentRefreshing}
                generalSettings={
                  generalSettings ?? DEFAULT_GENERAL_SETTINGS
                }
                generalSettingsSaveError={generalSettingsSaveError}
                generalSettingsSaving={generalSettingsSaving}
                onCategoryChange={setSettingsCategory}
                onChooseAppearanceBackground={chooseAppearanceBackground}
                onGeneralSettingsChange={updateGeneralSettings}
                onKeyboardSettingsChange={setKeyboardSettings}
                onOpenNodeDownload={openNodeDownload}
                onRemoveAppearanceBackground={removeAppearanceBackground}
                onRefreshEnvironment={refreshEnvironment}
                onRefreshProviders={refreshProviders}
                onSaveEnabledProviders={saveEnabledProviders}
                onSessionImportCompleted={refreshCatalog}
                platform={
                  systemStatus.state === 'ready'
                    ? systemStatus.info.platform
                    : 'win32'
                }
                profiles={terminalProfiles}
                providerStatus={providerStatus}
                providerRefreshing={isProviderRefreshing}
                runningSessionIds={runningSessionIds}
                sessions={
                  visibleCatalogStatus.state === 'ready'
                    ? visibleCatalogStatus.snapshot.sessions
                    : []
                }
                workspaces={
                  catalogPresentation === null
                    ? []
                    : [...catalogPresentation.workspaceById.values()]
                }
              />
            ) : activeRoute.id === 'profiles' ? (
              <TerminalProfiles onProfilesChange={setTerminalProfiles} />
            ) : activeRoute.id === 'remote' ? (
              <RemoteTargetsView />
            ) : (
              <DestinationPlaceholder route={activeRoute} />
            )}
            </RegionErrorBoundary>
          </div>

          {openRuntimes.length > 0 ? (
            <div className="terminal-surface" hidden={!terminalActive}>
              <RegionErrorBoundary
                description="Managed terminal processes are still owned by Lumora. Retry the terminal controls without restarting unrelated sessions."
                heading="Terminal controls unavailable"
                resetKey={activeRuntimeId}
                retryLabel="Retry terminal controls"
              >
              <TerminalWorkspace
                activeRuntimeId={activeRuntimeId ?? openRuntimes[0]!.id}
                focusRequestKey={terminalFocusRequestKey}
                onActivate={activateRuntime}
                onReorder={reorderRuntimeTab}
                onRuntimeChange={updateRuntime}
                platform={
                  systemStatus.state === 'ready'
                    ? systemStatus.info.platform
                    : 'win32'
                }
                previews={launchPreviews}
                runtimes={openRuntimes}
                backgroundOpacity={
                  appearanceBackgroundActive ? appearance.terminalOpacity : 1
                }
                theme={resolvedTerminalTheme}
                visible={terminalActive}
                workspaces={
                  catalogPresentation === null
                    ? []
                    : [...catalogPresentation.workspaceById.values()]
                }
              />
              </RegionErrorBoundary>
            </div>
          ) : null}
          </>
        }
        statusBar={(
          <SystemStatusBar
            activeAgentCount={liveRuntimes.length}
            status={systemStatus}
          />
        )}
        floatingContent={
          <>
          {applicationQuitRequest === null ? null : (
            <ConfirmDialog
              cancelLabel="Keep Lumora open"
              confirmLabel="Exit Lumora"
              description={(
                <>
                  Lumora is managing {applicationQuitRequest.totalActiveAgentCount}{' '}
                  active {applicationQuitRequest.totalActiveAgentCount === 1
                    ? 'agent'
                    : 'agents'} ({applicationQuitRequest.localActiveAgentCount} local and{' '}
                  {applicationQuitRequest.remoteActiveAgentCount} remote). Exiting will stop
                  these terminal sessions.
                </>
              )}
              heading="Exit Lumora?"
              onCancel={() => void resolveApplicationQuit('cancel')}
              onConfirm={() => void resolveApplicationQuit('exit')}
              suppression={{
                checked: suppressApplicationQuitWarning,
                label: "Don't show this warning again",
                onChange: setSuppressApplicationQuitWarning
              }}
            />
          )}
          {runtimeSwitcher !== null && runtimeSwitcherRuntimes.length > 0 ? (
        <RuntimeSwitcher
          runtimes={runtimeSwitcherRuntimes}
          selectedRuntimeId={runtimeSwitcher.selectedRuntimeId}
          workspaces={
            catalogPresentation === null
              ? []
              : [...catalogPresentation.workspaceById.values()]
          }
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
          onHide={hideWorkspace}
          workspace={hideWorkspaceIntent}
        />
      )}

      {!hiddenWorkspacesOpen || catalogPresentation === null ? null : (
        <HiddenWorkspacesDialog
          busy={workspaceVisibilityBusy}
          entries={catalogPresentation.hiddenWorkspaces}
          error={workspaceVisibilityError}
          onClose={() => {
            if (workspaceVisibilityBusy) return;
            setWorkspaceVisibilityError(null);
            setHiddenWorkspacesOpen(false);
          }}
          onRestore={restoreWorkspaceVisibility}
          onRestoreAll={restoreAllWorkspaceVisibility}
        />
      )}

      {newSessionIntent !== null && visibleCatalogStatus.state === 'ready' ? (
        <NewSessionDialog
          initialWorkspaceId={newSessionIntent.initialWorkspaceId}
          onClose={() => setNewSessionIntent(null)}
          onStarted={handleRuntimeStarted}
          profiles={terminalProfiles}
          providerScan={providerStatus.state === 'ready' ? providerStatus.scan : null}
          workspaces={visibleCatalogStatus.snapshot.workspaces}
        />
      ) : null}
      {resumeIntent !== null ? (
        <ResumeSessionDialog
          generalSettings={generalSettings ?? DEFAULT_GENERAL_SETTINGS}
          onClose={() => setResumeIntent(null)}
          onStarted={handleRuntimeStarted}
          profiles={terminalProfiles}
          providerScan={
            providerStatus.state === 'ready' ? providerStatus.scan : null
          }
          session={resumeIntent.session}
          sourceSessionActive={liveRuntimes.some(
            (runtime) => runtime.sessionId === resumeIntent.session.id
          )}
          workspace={resumeIntent.workspace}
        />
      ) : null}

      {recoveryRuntime !== null && visibleCatalogStatus.state === 'ready' ? (
        <RuntimeRecoveryDialog
          onClose={() => setRecoveryRuntime(null)}
          onStarted={handleRuntimeStarted}
          profiles={terminalProfiles}
          providerScan={
            providerStatus.state === 'ready' ? providerStatus.scan : null
          }
          runtime={recoveryRuntime}
          sessions={visibleCatalogStatus.snapshot.sessions}
          workspaces={visibleCatalogStatus.snapshot.workspaces}
        />
      ) : null}
          </>
        }
      />
      <StartupOverlay
        onDismissed={dismissStartupPresentation}
        posterSrc={startupPosterUrl}
        ready={startupReady}
        shouldPlay={startupDismissed ? false : startupShouldPlay}
        videoSrc={startupVideoUrl}
      />
    </>
  );
}
export default function App(): ReactNode {
  return (
    <TooltipProvider>
      <AppContent />
    </TooltipProvider>
  );
}
