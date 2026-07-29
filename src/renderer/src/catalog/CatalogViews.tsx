import { memo, type ReactNode } from 'react';

import type {
  CatalogSnapshot,
  ProviderId,
  ProviderScanResult,
  SessionSummary,
  SessionTransferCapability,
  TerminalProfile,
  RuntimeSummary,
  WorkspaceSummary
} from '../../../shared/contracts';
import { resolveSessionResumeDisabledReason } from './session-resume';
import {
  ProgressiveListControl,
  useProgressiveList
} from './progressive-list';
import { resolveRuntimeRecovery } from '../terminal/runtime-recovery';
import {
  SESSION_PROVIDER_IDS,
  providerDefinition
} from '../../../shared/provider-definitions';
import { formatLifetimeTokens } from './session-usage';
import { useSessionExportSelection } from '../transfer/useSessionExportSelection';

const WORKSPACE_BATCH_SIZE = 20;
const SESSION_BATCH_SIZE = 40;
const EMPTY_RUNNING_SESSION_IDS: ReadonlySet<string> = new Set();
const NO_EXPORT_CAPABILITIES = async (): Promise<
  SessionTransferCapability[]
> => [];

export type CatalogViewStatus =
  | { state: 'loading' }
  | { state: 'ready'; snapshot: CatalogSnapshot }
  | { state: 'error' };

interface WorkspacesViewProps {
  status: CatalogViewStatus;
  isRefreshing: boolean;
  onRefresh(): void;
  onAddWorkspace(): void;
  onOpenWorkspace(workspaceId: string): void;
}

const WorkspaceCard = memo(function WorkspaceCard({
  workspace,
  onOpenWorkspace
}: {
  workspace: WorkspaceSummary;
  onOpenWorkspace(workspaceId: string): void;
}): ReactNode {
  return (
    <article className="workspace-card">
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
        {SESSION_PROVIDER_IDS.filter(
          (provider) => (workspace.providerCounts[provider] ?? 0) > 0
        ).map((provider) => (
          <span key={provider}>
            {providerDefinition(provider).displayName}{' '}
            {workspace.providerCounts[provider]}
          </span>
        ))}
        {workspace.lastActivityAt === null ? null : (
          <span>
            Last activity{' '}
            <time dateTime={workspace.lastActivityAt}>
              {new Date(workspace.lastActivityAt).toLocaleString()}
            </time>
          </span>
        )}
      </div>
      <button
        aria-label={`Open sessions for ${workspace.displayName} at ${workspace.canonicalPath}`}
        className="workspace-card-action"
        onClick={() => onOpenWorkspace(workspace.id)}
        type="button"
      />
    </article>
  );
});

export function WorkspacesView({
  status,
  isRefreshing,
  onRefresh,
  onAddWorkspace,
  onOpenWorkspace
}: WorkspacesViewProps): ReactNode {
  const workspaces =
    status.state === 'ready' ? status.snapshot.workspaces : [];
  const progress = useProgressiveList({
    itemCount: workspaces.length,
    resetKey: 'workspaces',
    initialCount: WORKSPACE_BATCH_SIZE,
    batchSize: WORKSPACE_BATCH_SIZE
  });

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
        <>
          <div className="workspace-list">
            {workspaces.slice(0, progress.visibleCount).map((workspace) => (
              <WorkspaceCard
                key={workspace.id}
                onOpenWorkspace={onOpenWorkspace}
                workspace={workspace}
              />
            ))}
          </div>
          <ProgressiveListControl
            hasMore={progress.hasMore}
            label="Load more workspaces"
            onLoadMore={progress.showMore}
          />
        </>
      )}
    </section>
  );
}

interface SessionsViewProps {
  status: CatalogViewStatus;
  isRefreshing: boolean;
  dismissedDiagnosticIds: ReadonlySet<string>;
  queryText: string;
  provider: ProviderId | null;
  providerScan: ProviderScanResult | null;
  profiles: readonly TerminalProfile[];
  showInformationalNotices: boolean;
  onSearchChange(value: string): void;
  onProviderChange(value: ProviderId | null): void;
  onDismissDiagnostic(identity: string): void;
  onRefresh(): void;
  onResume(session: SessionSummary): void;
  onExport?(sessionIds: readonly string[]): void;
  onLoadExportCapabilities?(): Promise<SessionTransferCapability[]>;
  runningSessionIds?: ReadonlySet<string>;
}

function diagnosticIdentity(
  diagnostic: CatalogSnapshot['diagnostics'][number]
): string {
  return `${diagnostic.code}:${diagnostic.provider ?? 'catalog'}`;
}

const SessionRow = memo(function SessionRow({
  session,
  workspace,
  providerScan,
  profiles,
  onResume,
  exportSelection
}: {
  session: SessionSummary;
  workspace: WorkspaceSummary | undefined;
  providerScan: ProviderScanResult | null;
  profiles: readonly TerminalProfile[];
  onResume(session: SessionSummary): void;
  exportSelection: null | {
    selected: boolean;
    disabledReason: string | null;
    onToggle(): void;
  };
}): ReactNode {
  const disabledReason = resolveSessionResumeDisabledReason({
    session,
    workspace,
    providerScan,
    profiles
  });
  return (
    <tr
      className={`session-row${
        disabledReason === null ? '' : ' session-row-unavailable'
      }`}
      title={disabledReason ?? undefined}
    >
      <td>
        {exportSelection === null ? (
          <button
            aria-label={`Resume ${session.title}`}
            className="session-row-action"
            disabled={disabledReason !== null}
            onClick={() => onResume(session)}
            title={disabledReason ?? 'Resume this session'}
            type="button"
          />
        ) : (
          <input
            aria-label={session.title}
            checked={exportSelection.selected}
            className="session-export-checkbox"
            disabled={exportSelection.disabledReason !== null}
            onChange={exportSelection.onToggle}
            title={exportSelection.disabledReason ?? 'Select session'}
            type="checkbox"
          />
        )}
        <strong>{session.title}</strong>
      </td>
      <td>
        <span className={`provider-badge provider-${session.provider}`}>
          {providerDefinition(session.provider).displayName}
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
      <td aria-label={session.lifetimeTokens === null ? 'Lifetime tokens unavailable' : undefined}>
        {session.lifetimeTokens === null ? null : (
          <span className="session-token-usage">
            {formatLifetimeTokens(session.lifetimeTokens)}
          </span>
        )}
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
});

export function SessionsView({
  status,
  isRefreshing,
  dismissedDiagnosticIds,
  queryText,
  provider,
  providerScan,
  profiles,
  showInformationalNotices,
  onSearchChange,
  onProviderChange,
  onDismissDiagnostic,
  onRefresh,
  onResume,
  onExport,
  onLoadExportCapabilities = NO_EXPORT_CAPABILITIES,
  runningSessionIds = EMPTY_RUNNING_SESSION_IDS
}: SessionsViewProps): ReactNode {
  const sessionCount =
    status.state === 'ready' ? status.snapshot.sessions.length : 0;
  const progress = useProgressiveList({
    itemCount: sessionCount,
    resetKey: `${provider ?? 'all'}\u0000${queryText.trim()}`,
    initialCount: SESSION_BATCH_SIZE,
    batchSize: SESSION_BATCH_SIZE
  });
  const sessions = status.state === 'ready' ? status.snapshot.sessions : [];
  const exportSelection = useSessionExportSelection({
    sessions,
    providerScan,
    runningSessionIds,
    loadCapabilities: onLoadExportCapabilities
  });

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
            {snapshot.providerFacets.map(({ provider, sessionCount }) => (
              <option key={provider} value={provider}>
                {providerDefinition(provider).displayName} ({sessionCount})
              </option>
            ))}
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
        {onExport === undefined ? null : exportSelection.active ? (
          <div className="session-export-actions">
            <button
              className="secondary-button"
              onClick={exportSelection.close}
              type="button"
            >
              Cancel selection
            </button>
            <button
              className="refresh-button"
              disabled={exportSelection.selected.size === 0}
              onClick={() => {
                onExport([...exportSelection.selected]);
                exportSelection.close();
              }}
              type="button"
            >
              Export {exportSelection.selected.size}{' '}
              {exportSelection.selected.size === 1 ? 'session' : 'sessions'}
            </button>
          </div>
        ) : (
          <button
            className="secondary-button"
            onClick={() => void exportSelection.begin()}
            type="button"
          >
            Select sessions to export
          </button>
        )}
      </div>

      {(showInformationalNotices ? snapshot.diagnostics : [])
        .filter(
          (diagnostic) =>
            !dismissedDiagnosticIds.has(diagnosticIdentity(diagnostic))
        )
        .map((diagnostic, index) => {
          const identity = diagnosticIdentity(diagnostic);
          return (
            <div
              className="catalog-diagnostic"
              key={`${identity}-${index}`}
              role="alert"
            >
              <div className="catalog-diagnostic-content">
                <strong>{diagnostic.message}</strong>
                <span>{diagnostic.recovery}</span>
              </div>
              <button
                aria-label={`Dismiss warning: ${diagnostic.message}`}
                className="catalog-diagnostic-dismiss"
                onClick={() => onDismissDiagnostic(identity)}
                title="Dismiss warning"
                type="button"
              >
                <span aria-hidden="true">×</span>
              </button>
            </div>
          );
        })}

      {exportSelection.active ? (
        <div className="session-export-selection" aria-label="Export selection">
          <div>
            <strong>{exportSelection.selected.size} selected</strong>
            <span>
              {exportSelection.loading
                ? 'Checking provider support'
                : 'Select individual sessions or a complete provider scope.'}
            </span>
          </div>
          <div className="session-export-provider-options">
            {[...new Set(snapshot.sessions.map((session) => session.provider))].map(
              (providerId) => {
                const eligible =
                  exportSelection.eligibleByProvider.get(providerId) ?? [];
                return (
                  <label key={providerId}>
                    <input
                      aria-label={`Select all ${providerDefinition(providerId).displayName} sessions`}
                      checked={
                        eligible.length > 0 &&
                        eligible.every((session) =>
                          exportSelection.selected.has(session.id)
                        )
                      }
                      disabled={eligible.length === 0}
                      onChange={() => exportSelection.toggleProvider(providerId)}
                      type="checkbox"
                    />
                    <span>{providerDefinition(providerId).displayName}</span>
                  </label>
                );
              }
            )}
          </div>
          {exportSelection.error === null ? null : (
            <span className="session-export-error" role="alert">
              {exportSelection.error}
            </span>
          )}
        </div>
      ) : null}

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
              : 'Refresh after using a supported agent in a workspace.'}
          </p>
        </div>
      ) : (
        <>
          <div className="session-table-wrap">
            <table className="session-table">
              <thead>
                <tr>
                  <th scope="col">Session</th>
                  <th scope="col">Provider</th>
                  <th scope="col">Workspace</th>
                  <th scope="col">Updated</th>
                  <th scope="col">Tokens</th>
                  <th scope="col">Source</th>
                </tr>
              </thead>
              <tbody>
                {snapshot.sessions
                  .slice(0, progress.visibleCount)
                  .map((session) => (
                    <SessionRow
                      key={session.id}
                      onResume={onResume}
                      exportSelection={
                        exportSelection.active
                          ? {
                              selected: exportSelection.selected.has(session.id),
                              disabledReason:
                                exportSelection.disabledReason(session),
                              onToggle: () =>
                                exportSelection.toggleSession(session)
                            }
                          : null
                      }
                      profiles={profiles}
                      providerScan={providerScan}
                      session={session}
                      workspace={workspaces.get(session.workspaceId)}
                    />
                  ))}
              </tbody>
            </table>
          </div>
          <ProgressiveListControl
            hasMore={progress.hasMore}
            label="Load more sessions"
            onLoadMore={progress.showMore}
          />
        </>
      )}
    </section>
  );
}

export function CatalogHomeSummary({
  status,
  providerSummary,
  providerScan,
  profiles,
  runtimes = [],
  onRecover,
  onResume
}: {
  status: CatalogViewStatus;
  providerSummary?: string;
  providerScan: ProviderScanResult | null;
  profiles: readonly TerminalProfile[];
  runtimes?: readonly RuntimeSummary[];
  onRecover?(runtime: RuntimeSummary): void;
  onResume(session: SessionSummary): void;
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
  const workspaces = new Map(
    snapshot.workspaces.map((workspace) => [workspace.id, workspace])
  );
  const liveRuntimes = runtimes.filter(
    (runtime) => runtime.state === 'launching' || runtime.state === 'running'
  );
  const lostRuntimes = runtimes.filter(
    (runtime) => runtime.state === 'runtime_lost'
  );
  const attentionCount = snapshot.diagnostics.length + lostRuntimes.length;
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
          Native agent terminals owned by Lumora
        </p>
      </article>

      <article className="dashboard-card catalog-metric-card">
        <p className="card-label">Diagnostics</p>
        <h2>Needs attention</h2>
        <strong className="metric-value">
          {lostRuntimes.length === 0
            ? `${snapshot.diagnostics.length} catalog ${
                snapshot.diagnostics.length === 1 ? 'issue' : 'issues'
              }`
            : `${attentionCount} ${
                attentionCount === 1 ? 'item needs' : 'items need'
              } attention`}
        </strong>
        <p className="card-description">
          {lostRuntimes.length === 0
            ? 'Provider discovery problems remain visible without hiding healthy data.'
            : `${snapshot.diagnostics.length} catalog ${
                snapshot.diagnostics.length === 1 ? 'issue' : 'issues'
              } · ${lostRuntimes.length} lost ${
                lostRuntimes.length === 1 ? 'runtime' : 'runtimes'
              }`}
        </p>
        {lostRuntimes.length === 0 ? null : (
          <ul className="runtime-recovery-list">
            {lostRuntimes.slice(0, 3).map((runtime) => {
              const recovery = resolveRuntimeRecovery(
                runtime,
                snapshot.sessions
              );
              return (
                <li className="runtime-recovery-item" key={runtime.id}>
                  <span className="runtime-recovery-message">
                    <strong>
                      {providerDefinition(runtime.provider).displayName}
                    </strong>
                    <small>
                      {recovery?.strategy === 'resume'
                        ? 'Resume saved session'
                        : 'Restart as new session'}
                    </small>
                  </span>
                  {onRecover === undefined ? null : (
                    <button
                      className="text-button"
                      onClick={() => onRecover(runtime)}
                      type="button"
                    >
                      Recover
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
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
            {recentSessions.map((session) => {
              const workspace = workspaces.get(session.workspaceId);
              const disabledReason = resolveSessionResumeDisabledReason({
                session,
                workspace,
                providerScan,
                profiles
              });
              return (
                <li key={session.id}>
                  <span className="recent-session-copy">
                    <strong title={session.title}>{session.title}</strong>
                    <span className="recent-session-metadata">
                      <span className="recent-session-provider">
                        {providerDefinition(session.provider).displayName}
                      </span>
                      {workspace === undefined ? null : (
                        <span
                          className="recent-session-workspace"
                          title={workspace.displayName}
                        >
                          {workspace.displayName}
                        </span>
                      )}
                      {session.lifetimeTokens === null ? null : (
                        <span className="session-token-usage">
                          {formatLifetimeTokens(session.lifetimeTokens)}
                        </span>
                      )}
                    </span>
                  </span>
                  <button
                    className="text-button recent-session-resume"
                    disabled={disabledReason !== null}
                    onClick={() => onResume(session)}
                    title={disabledReason ?? 'Resume this session'}
                    type="button"
                  >
                    Resume
                  </button>
                </li>
              );
            })}
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
