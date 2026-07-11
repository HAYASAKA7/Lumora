import type { ReactNode } from 'react';

import type {
  CatalogSnapshot,
  ProviderId,
  RuntimeSummary
} from '../../../shared/contracts';

export type CatalogViewStatus =
  | { state: 'loading' }
  | { state: 'ready'; snapshot: CatalogSnapshot }
  | { state: 'error' };

interface WorkspacesViewProps {
  status: CatalogViewStatus;
  isRefreshing: boolean;
  onRefresh(): void;
  onAddWorkspace(): void;
}

export function WorkspacesView({
  status,
  isRefreshing,
  onRefresh,
  onAddWorkspace
}: WorkspacesViewProps): ReactNode {
  if (status.state === 'loading') {
    return (
      <div className="catalog-state" role="status">
        Loading catalog
      </div>
    );
  }

  if (status.state === 'error') {
    return (
      <section className="catalog-state catalog-error" role="alert">
        <div>
          <h2>Catalog unavailable</h2>
          <p>Lumora could not read its local session catalog.</p>
        </div>
        <button className="secondary-button" onClick={onRefresh} type="button">
          Try again
        </button>
      </section>
    );
  }

  const { workspaces } = status.snapshot;
  return (
    <section className="catalog-panel" aria-labelledby="workspace-list-title">
      <div className="catalog-toolbar">
        <div>
          <p className="card-label">Canonical local folders</p>
          <h2 id="workspace-list-title">
            {workspaces.length} {workspaces.length === 1 ? 'workspace' : 'workspaces'}
          </h2>
        </div>
        <div className="catalog-actions">
          <button
            className="secondary-button"
            disabled={isRefreshing}
            onClick={onRefresh}
            type="button"
          >
            {isRefreshing ? 'Refreshing catalog' : 'Refresh catalog'}
          </button>
          <button
            className="refresh-button"
            onClick={onAddWorkspace}
            type="button"
          >
            Add workspace
          </button>
        </div>
      </div>

      {workspaces.length === 0 ? (
        <div className="catalog-empty">
          <h3>No workspaces yet</h3>
          <p>
            Add a folder or refresh to discover workspaces from provider sessions.
          </p>
        </div>
      ) : (
        <div className="workspace-list">
          {workspaces.map((workspace) => (
            <article className="workspace-card" key={workspace.id}>
              <header>
                <div className="workspace-heading">
                  <h3>{workspace.displayName}</h3>
                  {!workspace.available ? (
                    <span className="availability-badge">Unavailable</span>
                  ) : null}
                </div>
                <span className={`origin-badge origin-${workspace.origin}`}>
                  {workspace.origin === 'manual' ? 'Manual' : 'Discovered'}
                </span>
              </header>
              <p className="workspace-path">{workspace.canonicalPath}</p>
              <div className="workspace-metadata">
                <span>
                  {workspace.sessionCount}{' '}
                  {workspace.sessionCount === 1 ? 'session' : 'sessions'}
                </span>
                <span>Codex {workspace.providerCounts.codex}</span>
                <span>Claude {workspace.providerCounts.claude}</span>
                {workspace.lastActivityAt === null ? null : (
                  <span>
                    Last activity{' '}
                    <time dateTime={workspace.lastActivityAt}>
                      {new Date(workspace.lastActivityAt).toLocaleString()}
                    </time>
                  </span>
                )}
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

interface SessionsViewProps {
  status: CatalogViewStatus;
  isRefreshing: boolean;
  queryText: string;
  provider: ProviderId | null;
  onSearchChange(value: string): void;
  onProviderChange(value: ProviderId | null): void;
  onRefresh(): void;
}

const PROVIDER_LABELS: Record<ProviderId, string> = {
  codex: 'Codex',
  claude: 'Claude Code'
};

export function SessionsView({
  status,
  isRefreshing,
  queryText,
  provider,
  onSearchChange,
  onProviderChange,
  onRefresh
}: SessionsViewProps): ReactNode {
  if (status.state === 'loading') {
    return (
      <div className="catalog-state" role="status">
        Loading catalog
      </div>
    );
  }

  if (status.state === 'error') {
    return (
      <section className="catalog-state catalog-error" role="alert">
        <div>
          <h2>Catalog unavailable</h2>
          <p>Lumora could not read its local session catalog.</p>
        </div>
        <button className="secondary-button" onClick={onRefresh} type="button">
          Try again
        </button>
      </section>
    );
  }

  const { snapshot } = status;
  const workspaces = new Map(
    snapshot.workspaces.map((workspace) => [workspace.id, workspace])
  );
  const hasFilters = queryText.trim().length > 0 || provider !== null;

  return (
    <section className="catalog-panel" aria-labelledby="session-list-title">
      <div className="session-toolbar">
        <label className="search-control">
          <span>Search sessions</span>
          <input
            onChange={(event) => onSearchChange(event.currentTarget.value)}
            placeholder="Search title or workspace"
            type="search"
            value={queryText}
          />
        </label>
        <label className="filter-control">
          <span>Provider</span>
          <select
            onChange={(event) =>
              onProviderChange(
                event.currentTarget.value === ''
                  ? null
                  : (event.currentTarget.value as ProviderId)
              )
            }
            value={provider ?? ''}
          >
            <option value="">All providers</option>
            <option value="codex">Codex</option>
            <option value="claude">Claude Code</option>
          </select>
        </label>
        <button
          className="secondary-button"
          disabled={isRefreshing}
          onClick={onRefresh}
          type="button"
        >
          {isRefreshing ? 'Refreshing catalog' : 'Refresh catalog'}
        </button>
      </div>

      {snapshot.diagnostics.map((diagnostic, index) => (
        <div
          className="catalog-diagnostic"
          key={`${diagnostic.code}-${diagnostic.provider ?? 'catalog'}-${index}`}
          role="alert"
        >
          <strong>{diagnostic.message}</strong>
          <span>{diagnostic.recovery}</span>
        </div>
      ))}

      <div className="catalog-result-heading">
        <p className="card-label">Normalized provider metadata</p>
        <h2 id="session-list-title">
          {snapshot.sessions.length}{' '}
          {snapshot.sessions.length === 1 ? 'session' : 'sessions'}
        </h2>
      </div>

      {snapshot.sessions.length === 0 ? (
        <div className="catalog-empty">
          <h3>
            {hasFilters ? 'No sessions match these filters' : 'No sessions yet'}
          </h3>
          <p>
            {hasFilters
              ? 'Change the search or provider filter to broaden the results.'
              : 'Refresh after using Codex or Claude Code in a workspace.'}
          </p>
        </div>
      ) : (
        <div className="session-table-wrap">
          <table className="session-table">
            <thead>
              <tr>
                <th scope="col">Session</th>
                <th scope="col">Provider</th>
                <th scope="col">Workspace</th>
                <th scope="col">Updated</th>
                <th scope="col">Source</th>
              </tr>
            </thead>
            <tbody>
              {snapshot.sessions.map((session) => {
                const workspace = workspaces.get(session.workspaceId);
                return (
                  <tr key={session.id}>
                    <td>
                      <strong>{session.title}</strong>
                    </td>
                    <td>
                      <span className={`provider-badge provider-${session.provider}`}>
                        {PROVIDER_LABELS[session.provider]}
                      </span>
                    </td>
                    <td>
                      <span className="session-workspace">
                        {workspace?.displayName ?? 'Unavailable workspace'}
                      </span>
                    </td>
                    <td>
                      <time dateTime={session.updatedAt}>
                        {new Date(session.updatedAt).toLocaleString()}
                      </time>
                    </td>
                    <td>
                      {session.sourceFreshness === 'stale' ? (
                        <span className="source-stale">Stale source</span>
                      ) : (
                        <span className="source-current">Current</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

export function CatalogHomeSummary({
  status,
  providerSummary,
  runtimes = []
}: {
  status: CatalogViewStatus;
  providerSummary?: string;
  runtimes?: readonly RuntimeSummary[];
}): ReactNode {
  if (status.state === 'loading') {
    return (
      <div className="catalog-state" role="status">
        Loading catalog
      </div>
    );
  }

  if (status.state === 'error') {
    return (
      <div className="catalog-state catalog-error" role="alert">
        Catalog summaries are unavailable. Workspaces and sessions can be retried
        from their dedicated views.
      </div>
    );
  }

  const { snapshot } = status;
  const recentSessions = snapshot.sessions.slice(0, 3);
  const liveRuntimes = runtimes.filter(
    (runtime) => runtime.state === 'launching' || runtime.state === 'running'
  );
  return (
    <div className="dashboard-grid" aria-label="Workspace overview">
      <article className="dashboard-card catalog-metric-card">
        <p className="card-label">Runtime view</p>
        <h2>Running agents</h2>
        <strong className="metric-value">
          {liveRuntimes.length === 0
            ? 'No managed processes'
            : `${liveRuntimes.length} running ${liveRuntimes.length === 1 ? 'agent' : 'agents'}`}
        </strong>
        <p className="card-description">
          Native Codex and Claude Code terminals owned by Lumora
        </p>
      </article>

      <article className="dashboard-card catalog-metric-card">
        <p className="card-label">Diagnostics</p>
        <h2>Needs attention</h2>
        <strong className="metric-value">
          {snapshot.diagnostics.length} catalog{' '}
          {snapshot.diagnostics.length === 1 ? 'issue' : 'issues'}
        </strong>
        <p className="card-description">
          Provider discovery problems remain visible without hiding healthy data.
        </p>
      </article>

      <article className="dashboard-card recent-session-card">
        <p className="card-label">Recent sessions</p>
        <h2>Recent sessions</h2>
        <strong className="metric-value">
          {snapshot.sessions.length} saved{' '}
          {snapshot.sessions.length === 1 ? 'session' : 'sessions'}
        </strong>
        {recentSessions.length === 0 ? (
          <p className="card-description">No provider sessions discovered yet.</p>
        ) : (
          <ul className="recent-session-list">
            {recentSessions.map((session) => (
              <li key={session.id}>
                <strong>{session.title}</strong>
                <span>{PROVIDER_LABELS[session.provider]}</span>
              </li>
            ))}
          </ul>
        )}
      </article>

      <article className="dashboard-card catalog-metric-card">
        <p className="card-label">Provider discovery</p>
        <h2>Scan health</h2>
        <strong className="metric-value">
          {snapshot.workspaces.length}{' '}
          {snapshot.workspaces.length === 1 ? 'workspace' : 'workspaces'}
        </strong>
        <div className="empty-state">
          <span className="empty-state-mark" aria-hidden="true" />
          {providerSummary ?? 'Provider status available in Settings'}
        </div>
      </article>
    </div>
  );
}
