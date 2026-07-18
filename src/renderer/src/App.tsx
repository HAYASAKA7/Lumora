import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode
} from 'react';

import lumoraBrandMarkUrl from '../../../resources/icons/lumora/source/lumora-symbol-gradient.svg';
import { DEFAULT_KEYBOARD_SETTINGS } from '../../shared/contracts';
import type {
  CatalogQuery,
  ProviderId,
  KeyboardSettings,
  LaunchPreview,
  RuntimeSummary,
  SessionSummary,
  SystemInfo,
  WorkspaceSummary
} from '../../shared/contracts';
import {
  CatalogHomeSummary,
  SessionsView,
  WorkspacesView,
  type CatalogViewStatus
} from './catalog/CatalogViews';
import { WorkspaceSessionsView } from './catalog/WorkspaceSessionsView';
import { useCatalogAutoRefresh } from './catalog/useCatalogAutoRefresh';
import type { ProviderScanStatus } from './providers/ProviderSettings';
import {
  DeveloperEnvironmentNotice,
  type DeveloperEnvironmentStatus
} from './environment/DeveloperEnvironment';
import {
  isRequiredModifierKey,
  keyboardEventMatchesChord
} from './keyboard/shortcut';
import {
  SettingsView,
  type SettingsCategory
} from './settings/SettingsView';
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

type RouteId =
  | 'home'
  | 'workspaces'
  | 'sessions'
  | 'profiles'
  | 'settings';

interface RouteDefinition {
  id: RouteId;
  label: string;
  eyebrow: string;
  description: string;
  icon: IconName;
}

type IconName =
  | 'home'
  | 'workspace'
  | 'sessions'
  | 'terminal'
  | 'settings'
  | 'activity'
  | 'attention'
  | 'history'
  | 'scan';

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

const ROUTES = [
  {
    id: 'home',
    label: 'Home',
    eyebrow: 'Command center',
    description:
      'A quiet overview of active work, recent sessions, and anything that needs your attention.',
    icon: 'home'
  },
  {
    id: 'workspaces',
    label: 'Workspaces',
    eyebrow: 'Workspace index',
    description:
      'Organize repositories and see supported agent sessions in one dependable hierarchy.',
    icon: 'workspace'
  },
  {
    id: 'sessions',
    label: 'All sessions',
    eyebrow: 'Session catalog',
    description:
      'Search and filter normalized provider sessions without changing provider-owned data.',
    icon: 'sessions'
  },
  {
    id: 'profiles',
    label: 'Terminal profiles',
    eyebrow: 'Shell profiles',
    description:
      'Review detected shells and define the terminal environment used for managed sessions.',
    icon: 'terminal'
  },
  {
    id: 'settings',
    label: 'Settings',
    eyebrow: 'Application settings',
    description:
      'Configure providers, storage, security, appearance, and diagnostic behavior.',
    icon: 'settings'
  }
] as const satisfies readonly RouteDefinition[];

const PLATFORM_LABELS: Record<SystemInfo['platform'], string> = {
  win32: 'Windows',
  darwin: 'macOS',
  linux: 'Linux'
};

function Icon({ name }: { name: IconName }): ReactNode {
  const paths: Record<IconName, ReactNode> = {
    home: <path d="M3.5 9.3 10 3.8l6.5 5.5v7.2a1 1 0 0 1-1 1h-4v-5h-3v5h-4a1 1 0 0 1-1-1Z" />,
    workspace: <path d="M2.5 5.5h5l1.5 2h8.5v8a1.5 1.5 0 0 1-1.5 1.5H4a1.5 1.5 0 0 1-1.5-1.5Zm0 2h15" />,
    sessions: <path d="M5 4.5h10M5 10h10M5 15.5h7M2.5 4.5h.1M2.5 10h.1M2.5 15.5h.1" />,
    terminal: <path d="m4 6 3.5 4L4 14m6 0h6" />,
    settings: <path d="M10 7a3 3 0 1 0 0 6 3 3 0 0 0 0-6Zm6.2 3a6 6 0 0 0-.1-1l1.6-1.3-1.8-3.1-2 .8a7 7 0 0 0-1.8-1L11.8 2H8.2l-.3 2.4a7 7 0 0 0-1.8 1l-2-.8-1.8 3.1L3.9 9a6 6 0 0 0 0 2l-1.6 1.3 1.8 3.1 2-.8a7 7 0 0 0 1.8 1l.3 2.4h3.6l.3-2.4a7 7 0 0 0 1.8-1l2 .8 1.8-3.1-1.6-1.3a6 6 0 0 0 .1-1Z" />,
    activity: <path d="M2 11h3l2-5 3.2 9 2.2-6 1.4 2H18" />,
    attention: <path d="M10 3 2.8 16h14.4Zm0 5v3.5m0 2.5v.1" />,
    history: <path d="M4.2 6.4A7 7 0 1 1 3 12m0-5.5v4h4M10 6v4l2.8 1.8" />,
    scan: <path d="M3 7V4a1 1 0 0 1 1-1h3m6 0h3a1 1 0 0 1 1 1v3m0 6v3a1 1 0 0 1-1 1h-3m-6 0H4a1 1 0 0 1-1-1v-3M6 10h8" />
  };

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
      {paths[name]}
    </svg>
  );
}

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

function SystemStatusBar({ status }: { status: SystemStatus }): ReactNode {
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
        <span className="status-item">Local only</span>
        <span className="status-divider" aria-hidden="true" />
        <span className="status-item">Sandboxed renderer</span>
      </div>
    </footer>
  );
}

export default function App(): ReactNode {
  const [activeRouteId, setActiveRouteId] = useState<RouteId>('home');
  const [systemStatus, setSystemStatus] = useState<SystemStatus>({
    state: 'loading'
  });
  const [providerStatus, setProviderStatus] = useState<ProviderScanStatus>({
    state: 'loading'
  });
  const [environmentStatus, setEnvironmentStatus] =
    useState<DeveloperEnvironmentStatus>({ state: 'loading' });
  const [catalogStatus, setCatalogStatus] = useState<CatalogViewStatus>({
    state: 'loading'
  });
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
  const [settingsCategory, setSettingsCategory] =
    useState<SettingsCategory>('providers');
  const [sidebarExpanded, setSidebarExpanded] = useState(true);
  const [runtimeMru, setRuntimeMru] = useState<string[]>([]);
  const [runtimeSwitcher, setRuntimeSwitcher] =
    useState<RuntimeSwitcherState | null>(null);
  const [newSessionIntent, setNewSessionIntent] =
    useState<NewSessionIntent | null>(null);
  const [resumeIntent, setResumeIntent] = useState<ResumeIntent | null>(null);
  const [recoveryRuntime, setRecoveryRuntime] =
    useState<RuntimeSummary | null>(null);
  const providerRequestId = useRef(0);
  const environmentRequestId = useRef(0);
  const catalogRequestId = useRef(0);
  const workspaceDetailRequestId = useRef(0);
  const catalogReadyForQueries = useRef(false);
  const mainContentRef = useRef<HTMLElement | null>(null);
  const catalogQueryRef = useRef<CatalogQuery>(EMPTY_CATALOG_QUERY);
  const selectedWorkspaceIdRef = useRef<string | null>(selectedWorkspaceId);
  catalogQueryRef.current = {
    text: debouncedSessionSearch,
    provider: sessionProvider
  };
  selectedWorkspaceIdRef.current = selectedWorkspaceId;

  const activeRoute = useMemo(
    () => ROUTES.find((route) => route.id === activeRouteId) ?? ROUTES[0],
    [activeRouteId]
  );

  useEffect(() => {
    if (mainContentRef.current !== null) {
      mainContentRef.current.scrollTop = 0;
    }
  }, [activeRouteId, activeRuntimeId, selectedWorkspaceId, settingsCategory]);

  const refreshProviders = useCallback(() => {
    const requestId = providerRequestId.current + 1;
    providerRequestId.current = requestId;
    setProviderStatus({ state: 'loading' });

    void window.lumora.scanProviders().then(
      (scan) => {
        if (providerRequestId.current === requestId) {
          setProviderStatus({ state: 'ready', scan });
        }
      },
      () => {
        if (providerRequestId.current === requestId) {
          setProviderStatus({ state: 'error' });
        }
      }
    );
  }, []);

  const refreshEnvironment = useCallback(() => {
    const requestId = environmentRequestId.current + 1;
    environmentRequestId.current = requestId;
    setEnvironmentStatus({ state: 'loading' });

    void window.lumora.scanDeveloperEnvironment().then(
      (scan) => {
        if (environmentRequestId.current === requestId) {
          setEnvironmentStatus({ state: 'ready', scan });
        }
      },
      () => {
        if (environmentRequestId.current === requestId) {
          setEnvironmentStatus({ state: 'error' });
        }
      }
    );
  }, []);

  const openNodeDownload = useCallback(
    () => window.lumora.openNodeDownloadPage(),
    []
  );

  useEffect(() => {
    let isCurrent = true;

    void window.lumora.getSystemInfo().then(
      (info) => {
        if (isCurrent) {
          setSystemStatus({ state: 'ready', info });
        }
      },
      () => {
        if (isCurrent) {
          setSystemStatus({ state: 'error' });
        }
      }
    );

    return () => {
      isCurrent = false;
    };
  }, []);

  useEffect(() => {
    let isCurrent = true;
    void window.lumora.getKeyboardSettings().then(
      (settings) => {
        if (isCurrent) setKeyboardSettings(settings);
      },
      () => undefined
    );
    return () => {
      isCurrent = false;
    };
  }, []);

  useEffect(() => {
    refreshProviders();

    return () => {
      providerRequestId.current += 1;
    };
  }, [refreshProviders]);

  useEffect(() => {
    refreshEnvironment();

    return () => {
      environmentRequestId.current += 1;
    };
  }, [refreshEnvironment]);

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
    setRuntimeMru((current) => touchRuntimeMru(current, runtimeId));
    setActiveRuntimeId(runtimeId);
  }, []);

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
    const fullSnapshot = await window.lumora.refreshCatalog(
      EMPTY_CATALOG_QUERY
    );
    const requestId = catalogRequestId.current + 1;
    catalogRequestId.current = requestId;
    const snapshot = await window.lumora.getCatalog(catalogQueryRef.current);
    if (catalogRequestId.current === requestId) {
      catalogReadyForQueries.current = true;
      setCatalogStatus({ state: 'ready', snapshot });
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
      (profiles) => { if (current) setTerminalProfiles(profiles); },
      () => undefined
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
      },
      () => undefined
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
  }, [closeRuntimeTab, scheduleAfterExit, updateRuntime]);

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
        catalogReadyForQueries.current = true;

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
          catalogReadyForQueries.current = true;
          setCatalogStatus({ state: 'error' });
        }
      }
    );

    return () => {
      catalogRequestId.current += 1;
    };
  }, []);

  useEffect(() => {
    if (!catalogReadyForQueries.current) {
      return;
    }

    const requestId = catalogRequestId.current + 1;
    catalogRequestId.current = requestId;
    setIsCatalogRefreshing(false);
    const query: CatalogQuery = {
      text: debouncedSessionSearch,
      provider: sessionProvider
    };
    void window.lumora.getCatalog(query).then(
      (snapshot) => {
        if (catalogRequestId.current === requestId) {
          setCatalogStatus({ state: 'ready', snapshot });
          setCatalogOperationError(null);
        }
      },
      () => {
        if (catalogRequestId.current === requestId) {
          setCatalogOperationError(
            'Catalog search failed. Last saved data is still shown.'
          );
        }
      }
    );
  }, [debouncedSessionSearch, sessionProvider]);

  useEffect(() => {
    if (
      catalogStatus.state === 'ready' &&
      sessionProvider !== null &&
      !catalogStatus.snapshot.providerFacets.some(
        ({ provider }) => provider === sessionProvider
      )
    ) {
      setSessionProvider(null);
    }
  }, [catalogStatus, sessionProvider]);

  const refreshCatalog = useCallback(() => {
    const requestId = catalogRequestId.current + 1;
    catalogRequestId.current = requestId;
    setIsCatalogRefreshing(true);
    setCatalogOperationError(null);
    const query: CatalogQuery = {
      text: debouncedSessionSearch,
      provider: sessionProvider
    };
    void window.lumora.refreshCatalog(query).then(
      (snapshot) => {
        if (catalogRequestId.current === requestId) {
          setCatalogStatus({ state: 'ready', snapshot });
          setIsCatalogRefreshing(false);
        }
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
        }
      }
    );
  }, [catalogStatus.state, debouncedSessionSearch, sessionProvider]);

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
      setNewSessionIntent(null);
      setRecoveryRuntime(null);
      setResumeIntent({ session, workspace });
    },
    [catalogStatus]
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
      setNewSessionIntent(null);
      setRecoveryRuntime(null);
      setResumeIntent({ session, workspace });
    },
    [workspaceDetailStatus]
  );

  const openRuntimes = openRuntimeIds
    .map((id) => runtimes.find((runtime) => runtime.id === id))
    .filter((runtime): runtime is RuntimeSummary => runtime !== undefined);
  const liveRuntimes = runtimes.filter(
    (runtime) => runtime.state === 'launching' || runtime.state === 'running'
  );
  const terminalActive = activeRuntimeId !== null && openRuntimes.length > 0;
  const runtimeSwitcherRuntimes = runtimeSwitcher === null
    ? []
    : runtimeSwitcher.order
        .map((id) => openRuntimes.find((runtime) => runtime.id === id))
        .filter((runtime): runtime is RuntimeSummary => runtime !== undefined);
  const openLiveTerminals = useCallback(() => {
    const liveIds = liveRuntimes.map((runtime) => runtime.id);
    setOpenRuntimeIds((current) => [
      ...current,
      ...liveIds.filter((id) => !current.includes(id))
    ]);
    const nextActive = liveIds[0] ?? null;
    if (nextActive === null) {
      setActiveRuntimeId(null);
    } else {
      activateRuntime(nextActive);
    }
  }, [activateRuntime, liveRuntimes]);
  const navigateToRoute = useCallback(
    (routeId: RouteId) => {
      closeWorkspaceDetail();
      setActiveRouteId(routeId);
      setActiveRuntimeId(null);
    },
    [closeWorkspaceDetail]
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
        keyboardEventMatchesChord(event, keyboardSettings.openTerminals) &&
        !terminalActive &&
        liveRuntimes.length > 0
      ) {
        event.preventDefault();
        event.stopPropagation();
        openLiveTerminals();
        return;
      }
      if (
        keyboardEventMatchesChord(event, keyboardSettings.toggleSidebar) &&
        !(
          event.target instanceof Element &&
          event.target.closest('.managed-terminal-shell') !== null
        )
      ) {
        event.preventDefault();
        event.stopPropagation();
        setSidebarExpanded((expanded) => !expanded);
        return;
      }

      const routeShortcuts: ReadonlyArray<
        readonly [KeyboardSettings['terminalSwitcher'], RouteId]
      > = [
        [keyboardSettings.openHome, 'home'],
        [keyboardSettings.openWorkspaces, 'workspaces'],
        [keyboardSettings.openSessions, 'sessions'],
        [keyboardSettings.openProfiles, 'profiles'],
        [keyboardSettings.openSettings, 'settings'],
        [keyboardSettings.openSettingsAlias, 'settings']
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
  const dismissSessionDiagnostic = useCallback((identity: string) => {
    setDismissedSessionDiagnostics((current) => {
      if (current.has(identity)) return current;
      const next = new Set(current);
      next.add(identity);
      return next;
    });
  }, []);

  return (
    <div className={`app-shell${sidebarExpanded ? '' : ' sidebar-collapsed'}`}>
      <a className="skip-link" href="#main-content">
        Skip to main content
      </a>

      <aside className="sidebar">
        <button
          aria-expanded={sidebarExpanded}
          aria-label={sidebarToggleLabel}
          className="brand"
          onClick={() => setSidebarExpanded((expanded) => !expanded)}
          title={sidebarToggleLabel}
          type="button"
        >
          <img alt="" className="brand-mark" src={lumoraBrandMarkUrl} />
          <span className="brand-copy">
            <strong>Lumora</strong>
            <small>Agent workspace manager</small>
          </span>
        </button>

        <nav className="primary-nav" aria-label="Primary navigation">
          <p className="nav-label">
            <span className="nav-label-text">Workspace</span>
            <span aria-hidden="true" className="nav-label-divider" />
          </p>
          {ROUTES.map((route) => (
            <button
              aria-current={activeRouteId === route.id ? 'page' : undefined}
              className="nav-item"
              key={route.id}
              onClick={() => {
                closeWorkspaceDetail();
                setActiveRouteId(route.id);
                setActiveRuntimeId(null);
                setSidebarExpanded(true);
              }}
              title={sidebarExpanded ? undefined : route.label}
              type="button"
            >
              <Icon name={route.icon} />
              <span className="nav-item-label">{route.label}</span>
            </button>
          ))}
        </nav>

      </aside>

      <div className="workspace-frame">
        <header className="topbar">
          <div>
            <p className="topbar-kicker">Local control plane</p>
            <p className="topbar-context">Private by default · Native provider sessions</p>
          </div>
          <div aria-label="Session actions" className="topbar-actions" role="group">
            <span className="release-badge">
              <span aria-hidden="true" />
              Provider discovery
            </span>
            {activeRuntimeId === null && liveRuntimes.length > 0 ? (
              <button className="secondary-button" onClick={openLiveTerminals} type="button">
                Open terminals
              </button>
            ) : null}
            {activeRuntimeId === null &&
            (activeRoute.id === 'home' || activeRoute.id === 'workspaces') &&
            catalogStatus.state === 'ready' &&
            catalogStatus.snapshot.workspaces.some((workspace) => workspace.available) ? (
              <button
                className="refresh-button"
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
                type="button"
              >
                New session
              </button>
            ) : null}
          </div>
        </header>

        <main
          className={`main-content${terminalActive ? ' terminal-main-content' : ''}`}
          id="main-content"
          ref={mainContentRef}
          tabIndex={-1}
        >
          {terminalActive ? null : (
            <header className="page-header">
              <p className="eyebrow">{activeRoute.eyebrow}</p>
              <h1>{activeRoute.label}</h1>
              <p className="page-description">{activeRoute.description}</p>
            </header>
          )}

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
                runtimes={runtimes}
                status={catalogStatus}
              />
            ) : activeRoute.id === 'workspaces' ? (
              selectedWorkspaceId === null ? (
                <WorkspacesView
                  isRefreshing={isCatalogRefreshing}
                  onAddWorkspace={addWorkspace}
                  onOpenWorkspace={openWorkspaceDetail}
                  onRefresh={refreshCatalog}
                  status={catalogStatus}
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
                  status={workspaceDetailStatus}
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
                status={catalogStatus}
              />
            ) : activeRoute.id === 'settings' ? (
              <SettingsView
                activeCategory={settingsCategory}
                catalogReady={catalogStatus.state === 'ready'}
                environmentStatus={environmentStatus}
                onCategoryChange={setSettingsCategory}
                onKeyboardSettingsChange={setKeyboardSettings}
                onOpenNodeDownload={openNodeDownload}
                onRefreshEnvironment={refreshEnvironment}
                onRefreshProviders={refreshProviders}
                platform={
                  systemStatus.state === 'ready'
                    ? systemStatus.info.platform
                    : 'win32'
                }
                profiles={terminalProfiles}
                providerStatus={providerStatus}
                sessions={
                  catalogStatus.state === 'ready'
                    ? catalogStatus.snapshot.sessions
                    : []
                }
                workspaces={
                  catalogStatus.state === 'ready'
                    ? catalogStatus.snapshot.workspaces
                    : []
                }
              />
            ) : activeRoute.id === 'profiles' ? (
              <TerminalProfiles onProfilesChange={setTerminalProfiles} />
            ) : (
              <DestinationPlaceholder route={activeRoute} />
            )}
          </div>

          {openRuntimes.length > 0 ? (
            <div className="terminal-surface" hidden={!terminalActive}>
              <TerminalWorkspace
                activeRuntimeId={activeRuntimeId ?? openRuntimes[0]!.id}
                onActivate={activateRuntime}
                onRuntimeChange={updateRuntime}
                platform={
                  systemStatus.state === 'ready'
                    ? systemStatus.info.platform
                    : 'win32'
                }
                previews={launchPreviews}
                runtimes={openRuntimes}
                visible={terminalActive}
                workspaces={
                  catalogStatus.state === 'ready'
                    ? catalogStatus.snapshot.workspaces
                    : []
                }
              />
            </div>
          ) : null}
        </main>

        <SystemStatusBar status={systemStatus} />
      </div>

      {runtimeSwitcher !== null && runtimeSwitcherRuntimes.length > 0 ? (
        <RuntimeSwitcher
          runtimes={runtimeSwitcherRuntimes}
          selectedRuntimeId={runtimeSwitcher.selectedRuntimeId}
          workspaces={
            catalogStatus.state === 'ready'
              ? catalogStatus.snapshot.workspaces
              : []
          }
        />
      ) : null}

      {newSessionIntent !== null && catalogStatus.state === 'ready' ? (
        <NewSessionDialog
          initialWorkspaceId={newSessionIntent.initialWorkspaceId}
          onClose={() => setNewSessionIntent(null)}
          onStarted={handleRuntimeStarted}
          profiles={terminalProfiles}
          providerScan={providerStatus.state === 'ready' ? providerStatus.scan : null}
          workspaces={catalogStatus.snapshot.workspaces}
        />
      ) : null}
      {resumeIntent !== null ? (
        <ResumeSessionDialog
          onClose={() => setResumeIntent(null)}
          onStarted={handleRuntimeStarted}
          profiles={terminalProfiles}
          providerScan={
            providerStatus.state === 'ready' ? providerStatus.scan : null
          }
          session={resumeIntent.session}
          workspace={resumeIntent.workspace}
        />
      ) : null}
      {recoveryRuntime !== null && catalogStatus.state === 'ready' ? (
        <RuntimeRecoveryDialog
          onClose={() => setRecoveryRuntime(null)}
          onStarted={handleRuntimeStarted}
          profiles={terminalProfiles}
          providerScan={
            providerStatus.state === 'ready' ? providerStatus.scan : null
          }
          runtime={recoveryRuntime}
          sessions={catalogStatus.snapshot.sessions}
          workspaces={catalogStatus.snapshot.workspaces}
        />
      ) : null}
    </div>
  );
}
