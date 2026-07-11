import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode
} from 'react';

import type {
  CatalogQuery,
  LaunchPreview,
  ProviderId,
  RuntimeSummary,
  SystemInfo
} from '../../shared/contracts';
import {
  CatalogHomeSummary,
  SessionsView,
  WorkspacesView,
  type CatalogViewStatus
} from './catalog/CatalogViews';
import {
  ProviderSettings,
  type ProviderScanStatus
} from './providers/ProviderSettings';
import { NewSessionDialog } from './terminal/NewSessionDialog';
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
      'Organize repositories and see their Codex and Claude sessions in one dependable hierarchy.',
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
  const [catalogStatus, setCatalogStatus] = useState<CatalogViewStatus>({
    state: 'loading'
  });
  const [isCatalogRefreshing, setIsCatalogRefreshing] = useState(false);
  const [catalogOperationError, setCatalogOperationError] = useState<
    string | null
  >(null);
  const [sessionSearch, setSessionSearch] = useState('');
  const [debouncedSessionSearch, setDebouncedSessionSearch] = useState('');
  const [sessionProvider, setSessionProvider] = useState<ProviderId | null>(null);
  const [terminalProfiles, setTerminalProfiles] = useState<
    Awaited<ReturnType<typeof window.lumora.getTerminalProfiles>>
  >([]);
  const [runtimes, setRuntimes] = useState<RuntimeSummary[]>([]);
  const [openRuntimeIds, setOpenRuntimeIds] = useState<string[]>([]);
  const [activeRuntimeId, setActiveRuntimeId] = useState<string | null>(null);
  const [launchPreviews, setLaunchPreviews] = useState(
    () => new Map<string, LaunchPreview>()
  );
  const [newSessionOpen, setNewSessionOpen] = useState(false);
  const providerRequestId = useRef(0);
  const catalogRequestId = useRef(0);
  const catalogReadyForQueries = useRef(false);

  const activeRoute = useMemo(
    () => ROUTES.find((route) => route.id === activeRouteId) ?? ROUTES[0],
    [activeRouteId]
  );

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
    refreshProviders();

    return () => {
      providerRequestId.current += 1;
    };
  }, [refreshProviders]);

  const updateRuntime = useCallback((runtime: RuntimeSummary) => {
    setRuntimes((current) => {
      const existing = current.findIndex((item) => item.id === runtime.id);
      if (existing === -1) return [runtime, ...current];
      const next = [...current];
      next[existing] = runtime;
      return next;
    });
  }, []);

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
      if (event.type === 'state') updateRuntime(event.runtime);
    });
    return () => {
      current = false;
      unsubscribe();
    };
  }, [updateRuntime]);

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
      setActiveRuntimeId(runtime.id);
      setNewSessionOpen(false);
    },
    [updateRuntime]
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

  const openRuntimes = openRuntimeIds
    .map((id) => runtimes.find((runtime) => runtime.id === id))
    .filter((runtime): runtime is RuntimeSummary => runtime !== undefined);
  const liveRuntimes = runtimes.filter(
    (runtime) => runtime.state === 'launching' || runtime.state === 'running'
  );

  const openLiveTerminals = useCallback(() => {
    const liveIds = liveRuntimes.map((runtime) => runtime.id);
    setOpenRuntimeIds((current) => [
      ...current,
      ...liveIds.filter((id) => !current.includes(id))
    ]);
    setActiveRuntimeId(liveIds[0] ?? null);
  }, [liveRuntimes]);

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">
        Skip to main content
      </a>

      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            <span />
          </span>
          <span>
            <strong>Lumora</strong>
            <small>Agent workspace manager</small>
          </span>
        </div>

        <nav className="primary-nav" aria-label="Primary navigation">
          <p className="nav-label">Workspace</p>
          {ROUTES.map((route) => (
            <button
              aria-current={activeRouteId === route.id ? 'page' : undefined}
              className="nav-item"
              key={route.id}
              onClick={() => {
                setActiveRouteId(route.id);
                setActiveRuntimeId(null);
              }}
              type="button"
            >
              <Icon name={route.icon} />
              <span>{route.label}</span>
            </button>
          ))}
        </nav>

        <div className="sidebar-note">
          <span className="sidebar-note-dot" aria-hidden="true" />
          <span>
            <strong>Discovery mode</strong>
            <small>Codex + Claude Code</small>
          </span>
        </div>
      </aside>

      <div className="workspace-frame">
        <header className="topbar">
          <div>
            <p className="topbar-kicker">Local control plane</p>
            <p className="topbar-context">Private by default · Native provider sessions</p>
          </div>
          <span className="release-badge">
            <span aria-hidden="true" />
            Provider discovery
          </span>
        </header>

        <main className="main-content" id="main-content" tabIndex={-1}>
          <header className="page-header">
            <p className="eyebrow">{activeRoute.eyebrow}</p>
            <h1>{activeRoute.label}</h1>
            <p className="page-description">{activeRoute.description}</p>
            <div className="page-primary-action">
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
                  onClick={() => setNewSessionOpen(true)}
                  type="button"
                >
                  New session
                </button>
              ) : null}
            </div>
          </header>

          {catalogOperationError === null ? null : (
            <div className="catalog-operation-error" role="alert">
              {catalogOperationError}
            </div>
          )}

          {activeRuntimeId !== null && openRuntimes.length > 0 ? (
            <TerminalWorkspace
              activeRuntimeId={activeRuntimeId}
              onActivate={setActiveRuntimeId}
              onClose={closeRuntimeTab}
              onRuntimeChange={updateRuntime}
              previews={launchPreviews}
              runtimes={openRuntimes}
              workspaces={
                catalogStatus.state === 'ready'
                  ? catalogStatus.snapshot.workspaces
                  : []
              }
            />
          ) : activeRoute.id === 'home' ? (
            <CatalogHomeSummary
              providerSummary={providerSummary(providerStatus)}
              runtimes={runtimes}
              status={catalogStatus}
            />
          ) : activeRoute.id === 'workspaces' ? (
            <WorkspacesView
              isRefreshing={isCatalogRefreshing}
              onAddWorkspace={addWorkspace}
              onRefresh={refreshCatalog}
              status={catalogStatus}
            />
          ) : activeRoute.id === 'sessions' ? (
            <SessionsView
              isRefreshing={isCatalogRefreshing}
              onProviderChange={setSessionProvider}
              onRefresh={refreshCatalog}
              onSearchChange={setSessionSearch}
              provider={sessionProvider}
              queryText={sessionSearch}
              status={catalogStatus}
            />
          ) : activeRoute.id === 'settings' ? (
            <ProviderSettings
              onRefresh={refreshProviders}
              status={providerStatus}
            />
          ) : activeRoute.id === 'profiles' ? (
            <TerminalProfiles onProfilesChange={setTerminalProfiles} />
          ) : (
            <DestinationPlaceholder route={activeRoute} />
          )}
        </main>

        <SystemStatusBar status={systemStatus} />
      </div>

      {newSessionOpen && catalogStatus.state === 'ready' ? (
        <NewSessionDialog
          onClose={() => setNewSessionOpen(false)}
          onStarted={handleRuntimeStarted}
          profiles={terminalProfiles}
          providerScan={providerStatus.state === 'ready' ? providerStatus.scan : null}
          workspaces={catalogStatus.snapshot.workspaces}
        />
      ) : null}
    </div>
  );
}
