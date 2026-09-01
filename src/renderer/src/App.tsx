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
  AgentInteractionRoute,
  AgentRuntimeStartResult,
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
  StructuredAgentEvent,
  StructuredAgentRuntimeSnapshot,
  StructuredAgentRuntimeSummary,
  SystemInfo,
  ThemePresetList,
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
import { StructuredAgentWorkspace } from './agent/StructuredAgentWorkspace';
import { HiddenWorkspacesDialog } from './catalog/HiddenWorkspacesDialog';
import { HideWorkspaceDialog } from './catalog/HideWorkspaceDialog';
import { projectCatalogVisibility } from './catalog/catalog-visibility';
import {
  buildAppearancePresentation
} from './appearance/presentation';
import { resolveTerminalFontFamily } from './appearance/font-family';
import { resolveAppearanceTheme, terminalThemeFor } from './appearance/theme';
import { useCatalogAutoRefresh } from './catalog/useCatalogAutoRefresh';
import { RegionErrorBoundary } from './errors/RegionErrorBoundary';
import type { ProviderScanStatus } from './providers/ProviderSettings';
import { useProviderUpdates } from './providers/useProviderUpdates';
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
import { SidebarSessionList } from './sidebar/SidebarSessionList';
import { projectSidebarSessions } from './sidebar/sidebar-sessions';
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
import { DirectSessionLaunchWorkspace } from './terminal/DirectSessionLaunchWorkspace';
import { useDirectSessionLaunch } from './terminal/useDirectSessionLaunch';
import { moveRuntimeTab } from './terminal/runtime-tab-order';
import { indexLiveSessionRuntimes } from './terminal/live-session-runtime';
import { TooltipProvider } from './ui/Tooltip';
import { useLocalization, type TranslationValues } from './localization/useLocalization';

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

const STRUCTURED_EVENT_RENDER_INTERVAL_MS = 32;

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
  | 'appearanceBackground'
  | 'themePresets';

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
  appearanceBackground: false,
  themePresets: false
};

const ROUTE_SPECS = [
  {
    id: 'home',
    labelKey: 'shell.navigation.home',
    eyebrowKey: 'shell.routes.home-eyebrow',
    descriptionKey: 'shell.routes.home-description',
    icon: 'home',
    shortcut: 'openHome'
  },
  {
    id: 'workspaces',
    labelKey: 'shell.navigation.workspaces',
    eyebrowKey: 'shell.routes.workspaces-eyebrow',
    descriptionKey: 'shell.routes.workspaces-description',
    icon: 'workspace',
    shortcut: 'openWorkspaces'
  },
  {
    id: 'sessions',
    labelKey: 'shell.navigation.sessions',
    eyebrowKey: 'shell.routes.sessions-eyebrow',
    descriptionKey: 'shell.routes.sessions-description',
    icon: 'sessions',
    shortcut: 'openSessions'
  },
  {
    id: 'profiles',
    labelKey: 'shell.navigation.terminal-profiles',
    eyebrowKey: 'shell.routes.profiles-eyebrow',
    descriptionKey: 'shell.routes.profiles-description',
    icon: 'terminal',
    shortcut: 'openProfiles'
  },
  {
    id: 'remote',
    labelKey: 'shell.navigation.remote-computers',
    eyebrowKey: 'shell.routes.remote-eyebrow',
    descriptionKey: 'shell.routes.remote-description',
    icon: 'remote',
    shortcut: 'openRemote'
  },
  {
    id: 'settings',
    labelKey: 'shell.navigation.settings',
    eyebrowKey: 'shell.routes.settings-eyebrow',
    descriptionKey: 'shell.routes.settings-description',
    icon: 'settings',
    shortcut: 'openSettings'
  }
] as const;

const PLATFORM_LABELS: Record<SystemInfo['platform'], string> = {
  win32: 'Windows',
  darwin: 'macOS',
  linux: 'Linux'
};

function providerSummary(
  status: ProviderScanStatus,
  t: (key: string, values?: TranslationValues) => string
): string {
  if (status.state === 'loading') {
    return t('shell.provider-summary.scanning');
  }

  if (status.state === 'error') {
    return t('shell.provider-summary.unavailable');
  }

  const readyCount = status.scan.providers.filter(
    (provider) => provider.state === 'ready'
  ).length;
  return t('shell.provider-summary.ready', {
    ready: readyCount,
    total: status.scan.providers.length
  });
}

function DestinationPlaceholder({ route }: { route: RouteDefinition }): ReactNode {
  const { t } = useLocalization();
  return (
    <section className="destination-panel" aria-label={t('shell.destination.status', {
      route: route.label
    })}>
      <div className="destination-icon">
        <Icon name={route.icon} />
      </div>
      <div>
        <p className="card-label">{t('shell.destination.ready')}</p>
        <h2>{t('shell.destination.heading', { route: route.label })}</h2>
        <p>{t('shell.destination.description')}</p>
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
  const { t } = useLocalization();
  let systemContent: ReactNode;

  if (status.state === 'loading') {
    systemContent = (
      <span className="status-item status-loading">
        <span className="status-dot" aria-hidden="true" />
        {t('shell.footer.reading-system')}
      </span>
    );
  } else if (status.state === 'error') {
    systemContent = (
      <span className="status-item status-warning">
        <span className="status-warning-icon" aria-hidden="true">!</span>
        {t('shell.footer.system-unavailable')}
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
          {t('shell.footer.active-agents', { count: activeAgentCount })}
        </span>
        <span className="status-divider" aria-hidden="true" />
        <span className="status-item">{t('shell.footer.sandboxed-renderer')}</span>
      </div>
    </footer>
  );
}

function AppContent(): ReactNode {
  const { t } = useLocalization();
  const routes: readonly RouteDefinition[] = ROUTE_SPECS.map((route) => ({
    id: route.id,
    label: t(route.labelKey),
    eyebrow: t(route.eyebrowKey),
    description: t(route.descriptionKey),
    icon: route.icon,
    shortcut: route.shortcut
  }));
  const primaryRoutes = routes.filter((route) => route.id !== 'settings');
  const settingsRoute = routes.find((route) => route.id === 'settings')!;
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
  const [structuredSnapshots, setStructuredSnapshots] = useState<
    StructuredAgentRuntimeSnapshot[]
  >([]);
  const pendingStructuredEvents = useRef<StructuredAgentEvent[]>([]);
  const structuredEventFlushTimer = useRef<number | null>(null);
  const [activeStructuredConnectionId, setActiveStructuredConnectionId] =
    useState<string | null>(null);
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
  const [themePresets, setThemePresets] = useState<ThemePresetList>({
    presets: [],
    rejectedCount: 0
  });
  const [themePresetsBusy, setThemePresetsBusy] = useState(false);
  const [themePresetsError, setThemePresetsError] = useState(false);
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
  const providerUpdates = useProviderUpdates({
    api: window.lumora,
    enabled:
      generalSettings !== null &&
      generalSettings.checkProviderUpdatesAutomatically,
    discoveryReady: providerStatus.state === 'ready'
  });
  const availableProviderUpdates =
    generalSettings?.checkProviderUpdatesAutomatically === true &&
    providerUpdates.status.state === 'ready'
    ? providerUpdates.status.check.providers
        .filter((provider) =>
          provider.state === 'update_available' &&
          generalSettings?.enabledProviders.includes(provider.provider)
        )
        .map((provider) => provider.provider)
      : [];
  const providerRequestId = useRef(0);
  const environmentRequestId = useRef(0);
  const catalogRequestId = useRef(0);
  const workspaceDetailRequestId = useRef(0);
  const mainContentRef = useRef<HTMLElement | null>(null);
  const selectedWorkspaceIdRef = useRef<string | null>(selectedWorkspaceId);
  const lastActiveRuntimeIdRef = useRef<string | null>(null);
  const lastActiveStructuredConnectionIdRef = useRef<string | null>(null);

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

  const activeThemePreset = useMemo(() => {
    const id = generalSettings?.appearance.themePresetId ?? null;
    return id === null
      ? null
      : themePresets.presets.find((theme) => theme.id === id) ?? null;
  }, [generalSettings?.appearance.themePresetId, themePresets.presets]);
  const resolvedTheme = resolveAppearanceTheme(
    activeThemePreset?.baseTheme ?? generalSettings?.appearance.theme ??
      DEFAULT_GENERAL_SETTINGS.appearance.theme
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
  const refreshThemePresets = useCallback(async () => {
    setThemePresetsBusy(true);
    setThemePresetsError(false);
    try {
      setThemePresets(await window.lumora.getThemePresets());
    } catch {
      setThemePresetsError(true);
    } finally {
      setThemePresetsBusy(false);
    }
  }, []);
  selectedWorkspaceIdRef.current = selectedWorkspaceId;

  const activeRoute = useMemo(
    () => routes.find((route) => route.id === activeRouteId) ?? routes[0]!,
    [activeRouteId, routes]
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
    setThemePresetsBusy(true);
    void window.lumora.getThemePresets().then(
      (themes) => {
        if (isCurrent) {
          setThemePresets(themes);
          setThemePresetsError(false);
        }
      },
      () => {
        if (isCurrent) setThemePresetsError(true);
      }
    ).finally(() => {
      if (isCurrent) {
        setThemePresetsBusy(false);
        settleStartupTask('themePresets');
      }
    });
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

  const updateStructuredSnapshot = useCallback((
    snapshot: StructuredAgentRuntimeSnapshot
  ) => {
    setStructuredSnapshots((current) => {
      const existing = current.findIndex((candidate) =>
        candidate.runtime.connectionId === snapshot.runtime.connectionId
      );
      if (existing === -1) return [snapshot, ...current];
      const next = [...current];
      next[existing] = snapshot;
      return next;
    });
  }, []);

  const flushStructuredEvents = useCallback(() => {
    structuredEventFlushTimer.current = null;
    const events = pendingStructuredEvents.current.splice(0);
    if (events.length === 0) return;
    setStructuredSnapshots((current) => current.map((snapshot) => {
      const relevant = events.filter(
        ({ connectionId }) => connectionId === snapshot.runtime.connectionId
      );
      if (relevant.length === 0) return snapshot;
      let runtime = snapshot.runtime;
      let latest = snapshot.events[snapshot.events.length - 1];
      const accepted: StructuredAgentEvent[] = [];
      for (const event of relevant) {
        if (
          latest !== undefined &&
          (event.generation < latest.generation ||
            (event.generation === latest.generation &&
              event.sequence <= latest.sequence))
        ) continue;
        runtime = event.kind === 'runtime.status'
          ? {
              ...runtime,
              state: event.payload.state,
              nativeSessionId: event.nativeSessionId,
              generation: event.generation,
              updatedAt: event.timestamp,
              error: event.payload.state === 'failed' ? runtime.error : null
            }
          : event.kind === 'runtime.metadata'
            ? {
                ...runtime,
                nativeSessionId: event.nativeSessionId,
                catalogSessionId: event.payload.catalogSessionId,
                title: event.payload.title,
                generation: event.generation,
                updatedAt: event.timestamp
              }
            : {
                ...runtime,
                nativeSessionId: event.nativeSessionId,
                generation: event.generation,
                updatedAt: event.timestamp
              };
        accepted.push(event);
        latest = event;
      }
      if (accepted.length === 0) return snapshot;
      return {
        ...snapshot,
        runtime,
        events: [...snapshot.events, ...accepted].slice(-500)
      };
    }));
  }, []);

  const queueStructuredEvent = useCallback((event: StructuredAgentEvent) => {
    pendingStructuredEvents.current.push(event);
    if (structuredEventFlushTimer.current !== null) return;
    structuredEventFlushTimer.current = window.setTimeout(
      flushStructuredEvents,
      STRUCTURED_EVENT_RENDER_INTERVAL_MS
    );
  }, [flushStructuredEvents]);

  const closeStructuredTab = useCallback((connectionId: string) => {
    setRuntimeMru((current) => current.filter((id) => id !== connectionId));
    setStructuredSnapshots((current) => {
      const next = current.filter(
        (snapshot) => snapshot.runtime.connectionId !== connectionId
      );
      setActiveStructuredConnectionId((active) =>
        active === connectionId
          ? (next.find(({ runtime }) =>
              runtime.state !== 'closed'
            )?.runtime.connectionId ?? null)
          : active
      );
      return next;
    });
  }, []);

  const activateRuntime = useCallback((runtimeId: string) => {
    lastActiveRuntimeIdRef.current = runtimeId;
    setOpenRuntimeIds((current) =>
      current.includes(runtimeId) ? current : [...current, runtimeId]
    );
    setRuntimeMru((current) => touchRuntimeMru(current, runtimeId));
    setActiveStructuredConnectionId(null);
    setActiveRuntimeId(runtimeId);
  }, []);

  const activateStructuredRuntime = useCallback((connectionId: string) => {
    lastActiveStructuredConnectionIdRef.current = connectionId;
    setRuntimeMru((current) => touchRuntimeMru(current, connectionId));
    setActiveRuntimeId(null);
    setActiveStructuredConnectionId(connectionId);
  }, []);

  const liveRuntimeBySessionId = useMemo(
    () => indexLiveSessionRuntimes(runtimes),
    [runtimes]
  );
  const liveStructuredSnapshots = useMemo(
    () => structuredSnapshots.filter(({ runtime }) =>
      runtime.state === 'starting' ||
      runtime.state === 'ready' ||
      runtime.state === 'reconnecting' ||
      runtime.state === 'closing'
    ),
    [structuredSnapshots]
  );
  const liveStructuredBySessionId = useMemo(
    () => new Map(liveStructuredSnapshots.flatMap((snapshot) =>
      snapshot.runtime.catalogSessionId === null
        ? []
        : [[snapshot.runtime.catalogSessionId, snapshot] as const]
    )),
    [liveStructuredSnapshots]
  );
  const runningSessionIds = useMemo(
    () => new Set([
      ...liveRuntimeBySessionId.keys(),
      ...liveStructuredBySessionId.keys()
    ]),
    [liveRuntimeBySessionId, liveStructuredBySessionId]
  );

  const openCatalogSessionOptions = useCallback((
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
    const structuredRuntime = liveStructuredBySessionId.get(session.id);
    if (structuredRuntime !== undefined) {
      setResumeIntent(null);
      activateStructuredRuntime(structuredRuntime.runtime.connectionId);
      return;
    }
    setResumeIntent({ session, workspace });
  }, [
    activateRuntime,
    activateStructuredRuntime,
    liveRuntimeBySessionId,
    liveStructuredBySessionId
  ]);

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
    let current = true;
    void window.lumora.listStructuredRuntimes().then(
      async (runtimes) => {
        const settled = await Promise.allSettled(runtimes.map((runtime) =>
          window.lumora.getStructuredRuntimeSnapshot(runtime.connectionId)
        ));
        const snapshots = settled.flatMap((result) =>
          result.status === 'fulfilled' ? [result.value] : []
        );
        if (current) setStructuredSnapshots(snapshots);
      },
      () => undefined
    );
    const unsubscribe = window.lumora.onStructuredAgentEvent((event) => {
      if (!current) return;
      if (event.kind === 'runtime.commands') {
        void window.lumora.getStructuredRuntimeSnapshot(event.connectionId).then(
          (snapshot) => {
            if (current) updateStructuredSnapshot(snapshot);
          },
          () => undefined
        );
        return;
      }
      queueStructuredEvent(event);
      if (
        event.kind === 'runtime.status' &&
        event.payload.state === 'closed'
      ) {
        closeStructuredTab(event.connectionId);
        scheduleAfterExit();
      }
    });
    return () => {
      current = false;
      unsubscribe();
      if (structuredEventFlushTimer.current !== null) {
        window.clearTimeout(structuredEventFlushTimer.current);
        structuredEventFlushTimer.current = null;
      }
      pendingStructuredEvents.current = [];
    };
  }, [
    closeStructuredTab,
    queueStructuredEvent,
    scheduleAfterExit,
    updateStructuredSnapshot
  ]);

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
                t('errors.catalog.refresh-saved')
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
              ? t('errors.catalog.refresh-saved')
              : t('errors.catalog.refresh-retry')
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
            t('errors.catalog.workspace-refresh-saved')
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
        t('errors.catalog.hide-workspace')
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
        t('errors.catalog.restore-workspaces')
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
        t('errors.catalog.restore-all-workspaces')
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

  const handleAgentRuntimeStarted = useCallback((
    result: AgentRuntimeStartResult,
    preview: LaunchPreview
  ) => {
    if (result.mode === 'pty') {
      handleRuntimeStarted(result.runtime, preview);
      return;
    }
    void window.lumora.getStructuredRuntimeSnapshot(
      result.runtime.connectionId
    ).then(
      (snapshot) => updateStructuredSnapshot(snapshot),
      () => updateStructuredSnapshot({
        runtime: result.runtime,
        events: [],
        boundary: null
      })
    );
    void backgroundRefreshCatalog().catch(() => undefined);
    activateStructuredRuntime(result.runtime.connectionId);
    setNewSessionIntent(null);
    setResumeIntent(null);
    setRecoveryRuntime(null);
  }, [
    activateStructuredRuntime,
    backgroundRefreshCatalog,
    handleRuntimeStarted,
    updateStructuredSnapshot
  ]);

  const handleDirectSessionStarted = useCallback((
    result: AgentRuntimeStartResult | RuntimeSummary,
    preview: LaunchPreview,
    activate: boolean
  ) => {
    if (!('mode' in result) || result.mode === 'pty') {
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
      if (activate) activateRuntime(runtime.id);
      return;
    }
    void window.lumora.getStructuredRuntimeSnapshot(
      result.runtime.connectionId
    ).then(
      (snapshot) => updateStructuredSnapshot(snapshot),
      () => updateStructuredSnapshot({
        runtime: result.runtime,
        events: [],
        boundary: null
      })
    );
    if (activate) activateStructuredRuntime(result.runtime.connectionId);
  }, [
    activateRuntime,
    activateStructuredRuntime,
    updateRuntime,
    updateStructuredSnapshot
  ]);

  const directSessionLaunch = useDirectSessionLaunch({
    api: window.lumora,
    autoTrustWorkspaces: generalSettings?.autoTrustWorkspaces ?? false,
    mode: 'agent',
    onStarted: handleDirectSessionStarted
  });

  const openCatalogSession = useCallback((
    session: SessionSummary,
    workspace: WorkspaceSummary,
    interactionRoute: AgentInteractionRoute = 'automatic'
  ) => {
    setNewSessionIntent(null);
    setRecoveryRuntime(null);
    setResumeIntent(null);
    const runningRuntime = liveRuntimeBySessionId.get(session.id);
    if (runningRuntime !== undefined) {
      directSessionLaunch.hide();
      activateRuntime(runningRuntime.id);
      setTerminalFocusRequestKey((current) => current + 1);
      return;
    }
    const structuredRuntime = liveStructuredBySessionId.get(session.id);
    if (structuredRuntime !== undefined) {
      directSessionLaunch.hide();
      activateStructuredRuntime(structuredRuntime.runtime.connectionId);
      return;
    }
    directSessionLaunch.open(session, workspace, interactionRoute);
  }, [
    activateRuntime,
    activateStructuredRuntime,
    directSessionLaunch.hide,
    directSessionLaunch.open,
    liveRuntimeBySessionId,
    liveStructuredBySessionId
  ]);

  const openCatalogSessionOptionsOnly = useCallback((
    session: SessionSummary,
    workspace: WorkspaceSummary
  ) => {
    directSessionLaunch.hide();
    openCatalogSessionOptions(session, workspace);
  }, [directSessionLaunch.hide, openCatalogSessionOptions]);

  const resumeCatalogSession = useCallback(
    (
      session: SessionSummary,
      interactionRoute: AgentInteractionRoute = 'automatic'
    ) => {
      if (catalogStatus.state !== 'ready') {
        return;
      }
      const workspace = catalogStatus.snapshot.workspaces.find(
        (candidate) => candidate.id === session.workspaceId
      );
      if (workspace === undefined) {
        return;
      }
      openCatalogSession(session, workspace, interactionRoute);
    },
    [catalogStatus, openCatalogSession]
  );

  const resumeCatalogSessionOptions = useCallback(
    (session: SessionSummary) => {
      if (catalogStatus.state !== 'ready') return;
      const workspace = catalogStatus.snapshot.workspaces.find(
        (candidate) => candidate.id === session.workspaceId
      );
      if (workspace !== undefined) {
        openCatalogSessionOptionsOnly(session, workspace);
      }
    },
    [catalogStatus, openCatalogSessionOptionsOnly]
  );

  const resumeWorkspaceSession = useCallback(
    (
      session: SessionSummary,
      interactionRoute: AgentInteractionRoute = 'automatic'
    ) => {
      if (workspaceDetailStatus.state !== 'ready') {
        return;
      }
      const workspace = workspaceDetailStatus.snapshot.workspaces.find(
        (candidate) => candidate.id === session.workspaceId
      );
      if (workspace === undefined) {
        return;
      }
      openCatalogSession(session, workspace, interactionRoute);
    },
    [openCatalogSession, workspaceDetailStatus]
  );

  const resumeWorkspaceSessionOptions = useCallback(
    (session: SessionSummary) => {
      if (workspaceDetailStatus.state !== 'ready') return;
      const workspace = workspaceDetailStatus.snapshot.workspaces.find(
        (candidate) => candidate.id === session.workspaceId
      );
      if (workspace !== undefined) {
        openCatalogSessionOptionsOnly(session, workspace);
      }
    },
    [openCatalogSessionOptionsOnly, workspaceDetailStatus]
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

  const openRuntimes = useMemo(
    () => openRuntimeIds
      .map((id) => runtimes.find((runtime) => runtime.id === id))
      .filter((runtime): runtime is RuntimeSummary => runtime !== undefined),
    [openRuntimeIds, runtimes]
  );
  const liveRuntimes = useMemo(
    () => runtimes.filter(
      (runtime) => runtime.state === 'launching' || runtime.state === 'running'
    ),
    [runtimes]
  );
  const allOpenRuntimeIds = useMemo(() => [
    ...openRuntimeIds,
    ...liveStructuredSnapshots.map(({ runtime }) => runtime.connectionId)
  ], [liveStructuredSnapshots, openRuntimeIds]);
  const activeTerminalRuntimeId =
    activeRuntimeId ?? activeStructuredConnectionId;
  const structuredTerminalActive =
    activeStructuredConnectionId !== null &&
    structuredSnapshots.some(({ runtime }) =>
      runtime.connectionId === activeStructuredConnectionId
    );
  const directSessionLaunchActive = directSessionLaunch.launch !== null;
  const terminalActive =
    directSessionLaunchActive ||
    (activeRuntimeId !== null && openRuntimes.length > 0) ||
    structuredTerminalActive;

  const liveRuntimesRef = useRef(liveRuntimes);
  liveRuntimesRef.current = liveRuntimes;
  const liveStructuredSnapshotsRef = useRef(liveStructuredSnapshots);
  liveStructuredSnapshotsRef.current = liveStructuredSnapshots;
  const runtimeSwitcherEntries = runtimeSwitcher === null
    ? []
    : runtimeSwitcher.order
        .flatMap((id) => {
          const runtime = openRuntimes.find((candidate) => candidate.id === id);
          if (runtime !== undefined) {
            return [{
              id: runtime.id,
              provider: runtime.provider,
              title: runtime.displayName,
              workspaceId: runtime.workspaceId
            }];
          }
          const structured = liveStructuredSnapshots.find(
            ({ runtime: candidate }) => candidate.connectionId === id
          )?.runtime;
          return structured === undefined
            ? []
            : [{
                id: structured.connectionId,
                provider: structured.providerId,
                title: structured.title,
                workspaceId: structured.workspaceId
              }];
        });
  const activateTerminalRuntime = useCallback((runtimeId: string) => {
    if (liveStructuredSnapshotsRef.current.some(
      ({ runtime }) => runtime.connectionId === runtimeId
    )) {
      activateStructuredRuntime(runtimeId);
      return;
    }
    activateRuntime(runtimeId);
  }, [activateRuntime, activateStructuredRuntime]);
  const openLiveTerminals = useCallback(() => {
    if (directSessionLaunch.hasLaunch) {
      directSessionLaunch.show();
      return;
    }
    const liveIds = liveRuntimesRef.current.map((runtime) => runtime.id);
    const structuredIds = liveStructuredSnapshotsRef.current.map(
      ({ runtime }) => runtime.connectionId
    );
    setOpenRuntimeIds((current) => [
      ...current,
      ...liveIds.filter((id) => !current.includes(id))
    ]);
    const live = new Set([...liveIds, ...structuredIds]);
    const nextActive = runtimeMru.find((id) => live.has(id))
      ?? liveIds[0]
      ?? structuredIds[0]
      ?? null;
    if (nextActive === null) {
      setActiveRuntimeId(null);
      setActiveStructuredConnectionId(null);
      return;
    }
    activateTerminalRuntime(nextActive);
    setTerminalFocusRequestKey((current) => current + 1);
  }, [
    activateTerminalRuntime,
    directSessionLaunch.hasLaunch,
    directSessionLaunch.show,
    runtimeMru
  ]);
  const closeStructuredRuntime = useCallback(async (connectionId: string) => {
    try {
      await window.lumora.closeStructuredRuntime(connectionId);
    } finally {
      closeStructuredTab(connectionId);
      scheduleAfterExit();
    }
  }, [closeStructuredTab, scheduleAfterExit]);
  const reconnectStructuredRuntime = useCallback(async (
    connectionId: string
  ) => {
    const runtime = await window.lumora.reconnectStructuredRuntime(connectionId);
    const snapshot = await window.lumora.getStructuredRuntimeSnapshot(
      runtime.connectionId
    );
    updateStructuredSnapshot(snapshot);
    activateStructuredRuntime(runtime.connectionId);
  }, [activateStructuredRuntime, updateStructuredSnapshot]);
  const navigateToRoute = useCallback(
    (routeId: RouteId) => {
      directSessionLaunch.hide();
      closeWorkspaceDetail();
      if (routeId === 'settings') {
        setSettingsCategory('general');
      }
      setActiveRouteId(routeId);
      setActiveRuntimeId(null);
      setActiveStructuredConnectionId(null);
      if (
        (generalSettings ?? DEFAULT_GENERAL_SETTINGS).autoExpandSidebar
      ) {
        setSidebarExpanded(true);
      }
    },
    [closeWorkspaceDetail, directSessionLaunch.hide, generalSettings]
  );

  useEffect(() => {
    setRuntimeMru((current) =>
      buildRuntimeMru(allOpenRuntimeIds, current, activeTerminalRuntimeId)
    );
    setRuntimeSwitcher((current) => {
      if (current === null) return null;
      return reconcileRuntimeSwitch(current, allOpenRuntimeIds);
    });
  }, [activeTerminalRuntimeId, allOpenRuntimeIds]);

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
        if (!terminalActive || allOpenRuntimeIds.length === 0) return;

        event.preventDefault();
        event.stopPropagation();
        if (event.repeat) return;
        if (allOpenRuntimeIds.length === 1) {
          activateTerminalRuntime(allOpenRuntimeIds[0]!);
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
            allOpenRuntimeIds,
            runtimeMru,
            activeTerminalRuntimeId
          );
          const selectedRuntimeId =
            nextRuntimeInOrder(order, activeTerminalRuntimeId) ?? order[0];
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
        (directSessionLaunch.hasLaunch ||
          liveRuntimesRef.current.length > 0 ||
          liveStructuredSnapshotsRef.current.length > 0)
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
      if (allOpenRuntimeIds.includes(selectedRuntimeId)) {
        activateTerminalRuntime(selectedRuntimeId);
      }
    };

    window.addEventListener('keydown', keydown, true);
    window.addEventListener('keyup', keyup, true);
    return () => {
      window.removeEventListener('keydown', keydown, true);
      window.removeEventListener('keyup', keyup, true);
    };
  }, [
    activeTerminalRuntimeId,
    activateTerminalRuntime,
    allOpenRuntimeIds,
    directSessionLaunch.hasLaunch,
    keyboardSettings,
    liveRuntimes.length,
    liveStructuredSnapshots.length,
    navigateToRoute,
    openLiveTerminals,
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
            ? t('errors.settings.save-notices')
            : t('errors.settings.save')
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
        t('errors.settings.background-invalid')
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
      setAppearanceBackgroundError(t('errors.settings.background-remove'));
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
          t('errors.provider.save-selection')
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
  const sidebarCatalogPresentation = useMemo(() =>
    startupCatalogStatus.state === 'ready' &&
    workspaceVisibilityPolicies !== undefined
      ? projectCatalogVisibility({
          snapshot: startupCatalogStatus.snapshot,
          policies: workspaceVisibilityPolicies,
          settings: generalSettings ?? DEFAULT_GENERAL_SETTINGS,
          providerScan:
            providerStatus.state === 'ready' ? providerStatus.scan : null,
          profiles: terminalProfiles,
          query: EMPTY_CATALOG_QUERY
        })
      : null,
  [
    generalSettings,
    providerStatus,
    startupCatalogStatus,
    terminalProfiles,
    workspaceVisibilityPolicies
  ]);
  const sidebarSessions = useMemo(() => projectSidebarSessions({
    runtimes: liveRuntimes,
    sessions: sidebarCatalogPresentation?.snapshot.sessions ?? []
  }), [liveRuntimes, sidebarCatalogPresentation]);
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
    appearanceBackground,
    activeThemePreset
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
          ariaLabel: t('shell.navigation.primary'),
          label: t('shell.navigation.workspace-group'),
          routes: primaryRoutes.map((route) => ({
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
              ? t('shell.navigation.online-computers', {
                  count: onlineRemoteTargetCount
                })
              : undefined
          }))
        }}
        secondaryNavigation={{
          label: t('shell.navigation.application-group'),
          routes: [
            {
              id: settingsRoute.id,
              icon: settingsRoute.icon,
              label: settingsRoute.label,
              shortcut: shortcutPlatform === null
                ? undefined
                : formatShortcutChord(
                    keyboardSettings.openSettings,
                    shortcutPlatform
                  )
            }
          ]
        }}
        sidebarContent={(
          <SidebarSessionList
            activeRuntimeId={activeRuntimeId}
            activeStructuredConnectionId={activeStructuredConnectionId}
            onActivateRuntime={activateRuntime}
            onActivateStructuredRuntime={activateStructuredRuntime}
            onResumeSession={resumeCatalogSession}
            onResumeSessionOptions={resumeCatalogSessionOptions}
            preferenceScope="local"
            recent={sidebarSessions.recent}
            running={sidebarSessions.running}
            structuredRunning={liveStructuredSnapshots.map(
              ({ runtime }) => runtime
            )}
          />
        )}
        sidebarExpanded={sidebarExpanded}
        sidebarToggleShortcut={sidebarToggleShortcut}
        topbar={{
          context: t('shell.product.tagline'),
          kicker: t('shell.topbar.local-control-plane'),
          actions: (
            <>
            {activeRuntimeId === null &&
            activeStructuredConnectionId === null &&
            (directSessionLaunch.hasLaunch ||
              liveRuntimes.length > 0 ||
              liveStructuredSnapshots.length > 0) ? (
              <button className="secondary-button" data-lumora-command onClick={openLiveTerminals} tabIndex={-1} type="button">
                {t('shell.runtime.open-terminals')}
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
                {t('shell.topbar.new-session')}
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
              description={t('errors.general.page-description')}
              heading={t('errors.general.page-heading')}
              resetKey={`${activeRouteId}:${selectedWorkspaceId ?? ''}:${settingsCategory}`}
              retryLabel={t('errors.general.retry-page')}
            >
            {activeRoute.id === 'home' ? (
              <CatalogHomeSummary
                availableProviderUpdates={availableProviderUpdates}
                onRecover={(runtime) => {
                  setNewSessionIntent(null);
                  setResumeIntent(null);
                  setRecoveryRuntime(runtime);
                }}
                onOpenProviderUpdates={() => {
                  navigateToRoute('settings');
                  setSettingsCategory('providers');
                }}
                onResume={resumeCatalogSession}
                onResumeOptions={resumeCatalogSessionOptions}
                profiles={terminalProfiles}
                providerScan={
                  providerStatus.state === 'ready' ? providerStatus.scan : null
                }
                providerSummary={providerSummary(providerStatus, t)}
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
                  onResumeOptions={resumeWorkspaceSessionOptions}

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
                onResumeOptions={resumeCatalogSessionOptions}

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
                themePresets={themePresets}
                themePresetsBusy={themePresetsBusy}
                themePresetsError={themePresetsError}
                onCategoryChange={setSettingsCategory}
                onChooseAppearanceBackground={chooseAppearanceBackground}
                onGeneralSettingsChange={updateGeneralSettings}
                onKeyboardSettingsChange={setKeyboardSettings}
                onOpenNodeDownload={openNodeDownload}
                onRemoveAppearanceBackground={removeAppearanceBackground}
                onRefreshEnvironment={refreshEnvironment}
                onRefreshProviderUpdates={providerUpdates.refresh}
                onRefreshProviders={refreshProviders}
                onRefreshThemePresets={refreshThemePresets}
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
                providerUpdatesRefreshing={providerUpdates.refreshing}
                providerUpdatesStatus={providerUpdates.status}
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

          {directSessionLaunch.launch === null ? null : (
            <div className="terminal-surface">
              <DirectSessionLaunchWorkspace
                launch={directSessionLaunch.launch}
                onClose={directSessionLaunch.cancel}
                onOpenOptions={() => {
                  const currentLaunch = directSessionLaunch.launch;
                  if (currentLaunch === null) return;
                  const { session, workspace } = currentLaunch;
                  openCatalogSessionOptionsOnly(session, workspace);
                }}
                onRetry={directSessionLaunch.retry}
                onTrustAndContinue={directSessionLaunch.trustAndContinue}
              />
            </div>
          )}
          {openRuntimes.length > 0 && !directSessionLaunchActive ? (
            <div className="terminal-surface" hidden={!terminalActive}>
              <RegionErrorBoundary
                description={t('errors.terminal.controls-description')}
                heading={t('errors.terminal.controls-heading')}
                resetKey={activeRuntimeId}
                retryLabel={t('errors.terminal.retry-controls')}
              >
              <TerminalWorkspace
                activeRuntimeId={activeRuntimeId ?? openRuntimes[0]!.id}
                focusRequestKey={terminalFocusRequestKey}
                fontFamily={resolveTerminalFontFamily(
                  appearance.terminalFontFamily
                )}
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
                showTabBar={!sidebarExpanded}
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
          {structuredSnapshots.length > 0 && !directSessionLaunchActive ? (
            <div className="terminal-surface" hidden={!structuredTerminalActive}>
              <RegionErrorBoundary
                description={t('errors.terminal.controls-description')}
                heading={t('errors.terminal.controls-heading')}
                resetKey={activeStructuredConnectionId}
                retryLabel={t('errors.terminal.retry-controls')}
              >
                <StructuredAgentWorkspace
                  activeConnectionId={
                    activeStructuredConnectionId ??
                    structuredSnapshots[0]!.runtime.connectionId
                  }
                  focusRequestKey={terminalFocusRequestKey}
                  onActivate={activateStructuredRuntime}
                  onClose={(connectionId) => {
                    void closeStructuredRuntime(connectionId);
                  }}
                  onReconnect={(connectionId) => {
                    void reconnectStructuredRuntime(connectionId);
                  }}
                  showTabBar={!sidebarExpanded}
                  snapshots={structuredSnapshots}
                />
              </RegionErrorBoundary>
            </div>
          ) : null}
          </>
        }
        statusBar={(
          <SystemStatusBar
            activeAgentCount={
              liveRuntimes.length + liveStructuredSnapshots.length
            }
            status={systemStatus}
          />
        )}
        floatingContent={
          <>
          {applicationQuitRequest === null ? null : (
            <ConfirmDialog
              cancelLabel={t('shell.runtime.quit-cancel')}
              confirmLabel={t('shell.runtime.quit-confirm')}
              description={t('shell.runtime.quit-description', {
                total: applicationQuitRequest.totalActiveAgentCount,
                local: applicationQuitRequest.localActiveAgentCount,
                remote: applicationQuitRequest.remoteActiveAgentCount
              })}
              heading={t('shell.runtime.quit-heading')}
              onCancel={() => void resolveApplicationQuit('cancel')}
              onConfirm={() => void resolveApplicationQuit('exit')}
              suppression={{
                checked: suppressApplicationQuitWarning,
                label: t('shell.runtime.suppress-warning'),
                onChange: setSuppressApplicationQuitWarning
              }}
            />
          )}
          {runtimeSwitcher !== null && runtimeSwitcherEntries.length > 0 ? (
        <RuntimeSwitcher
          entries={runtimeSwitcherEntries}
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
          generalSettings={generalSettings ?? DEFAULT_GENERAL_SETTINGS}
          initialWorkspaceId={newSessionIntent.initialWorkspaceId}
          onClose={() => setNewSessionIntent(null)}
          onAgentStarted={handleAgentRuntimeStarted}
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
          onAgentStarted={handleAgentRuntimeStarted}
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
