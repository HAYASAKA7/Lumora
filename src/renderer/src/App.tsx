import { useEffect, useMemo, useState, type ReactNode } from 'react';

import type { SystemInfo } from '../../shared/contracts';

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

const HOME_CARDS: readonly {
  title: string;
  label: string;
  description: string;
  icon: IconName;
}[] = [
  {
    title: 'Running agents',
    label: 'Runtime view',
    description:
      'Managed Codex and Claude processes will appear here with their workspace and live state.',
    icon: 'activity'
  },
  {
    title: 'Needs attention',
    label: 'Diagnostics',
    description:
      'Provider, discovery, and launch failures will surface here with a clear recovery action.',
    icon: 'attention'
  },
  {
    title: 'Recent sessions',
    label: 'Session history',
    description:
      'Newly discovered and recently resumed sessions will be available here for quick access.',
    icon: 'history'
  },
  {
    title: 'Scan health',
    label: 'Provider discovery',
    description:
      'Codex and Claude scan results will show source freshness without modifying provider files.',
    icon: 'scan'
  }
] as const;

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

function HomeDashboard(): ReactNode {
  return (
    <div className="dashboard-grid" aria-label="Workspace overview">
      {HOME_CARDS.map((card) => (
        <article className="dashboard-card" key={card.title}>
          <div className="card-icon">
            <Icon name={card.icon} />
          </div>
          <div>
            <p className="card-label">{card.label}</p>
            <h2>{card.title}</h2>
          </div>
          <p className="card-description">{card.description}</p>
          <div className="empty-state">
            <span className="empty-state-mark" aria-hidden="true" />
            Waiting for the next MVP slice
          </div>
        </article>
      ))}
    </div>
  );
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

  const activeRoute = useMemo(
    () => ROUTES.find((route) => route.id === activeRouteId) ?? ROUTES[0],
    [activeRouteId]
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
              onClick={() => setActiveRouteId(route.id)}
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
            <strong>Foundation mode</strong>
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
            MVP foundation
          </span>
        </header>

        <main className="main-content" id="main-content" tabIndex={-1}>
          <header className="page-header">
            <p className="eyebrow">{activeRoute.eyebrow}</p>
            <h1>{activeRoute.label}</h1>
            <p className="page-description">{activeRoute.description}</p>
          </header>

          {activeRoute.id === 'home' ? (
            <HomeDashboard />
          ) : (
            <DestinationPlaceholder route={activeRoute} />
          )}
        </main>

        <SystemStatusBar status={systemStatus} />
      </div>
    </div>
  );
}
