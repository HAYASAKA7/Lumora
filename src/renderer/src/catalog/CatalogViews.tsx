import { memo, type ReactNode, useMemo, useState } from 'react';

import type {
  CatalogSnapshot,
  ProviderId,
  ProviderScanResult,
  SessionSummary,
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
import { OverflowTooltip, Tooltip } from '../ui/Tooltip';
import { SelectMenu } from '../ui/SelectMenu';
import { ActionMenu } from '../ui/ActionMenu';
import { useLocalization } from '../localization/useLocalization';
import { useSessionResumeContextMenu } from './useSessionResumeContextMenu';

const WORKSPACE_BATCH_SIZE = 20;
const SESSION_BATCH_SIZE = 40;
const EMPTY_SESSION_IDS: ReadonlySet<string> = new Set();

export type CatalogViewStatus =
  | { state: 'loading' }
  | { state: 'ready'; snapshot: CatalogSnapshot }
  | { state: 'error' };

interface WorkspacesViewProps {
  status: CatalogViewStatus;
  isRefreshing: boolean;
  onRefresh(): void;
  onAddWorkspace?: (() => void) | undefined;
  hiddenWorkspaceCount?: number | undefined;
  onHideWorkspace?: ((workspace: WorkspaceSummary) => void) | undefined;
  onManageHiddenWorkspaces?: (() => void) | undefined;
  onOpenWorkspace(workspaceId: string): void;
  scopeLabel?: string | undefined;
}

const WorkspaceCard = memo(function WorkspaceCard({
  workspace,
  onHideWorkspace,
  onOpenWorkspace
}: {
  workspace: WorkspaceSummary;
  onHideWorkspace?: ((workspace: WorkspaceSummary) => void) | undefined;
  onOpenWorkspace(workspaceId: string): void;
}): ReactNode {
  const { formatDate, formatTime, t } = useLocalization();
  return (
    <article className="workspace-card">
      <header>
        <div className="workspace-heading">
          <h3>{workspace.displayName}</h3>
          {!workspace.available ? (
            <span className="availability-badge">{t('catalog.workspaces.unavailable')}</span>
          ) : null}
        </div>
        <div className="workspace-card-heading-actions">
          <span className={`origin-badge origin-${workspace.origin}`}>
            {t(`catalog.workspaces.origin-${workspace.origin}`)}
          </span>
          {onHideWorkspace === undefined ? null : (
            <ActionMenu
              className="workspace-card-menu-button"
              items={[{ id: 'hide', label: t('catalog.workspaces.hide-action') }]}
              label={t('catalog.workspaces.actions-label', { workspace: workspace.displayName })}
              onSelect={() => onHideWorkspace(workspace)}
            >
              <Tooltip content={t('catalog.workspaces.actions-tooltip')}>
                  <span aria-hidden="true">•••</span>
              </Tooltip>
            </ActionMenu>
          )}
        </div>
      </header>
      <p className="workspace-path">{workspace.canonicalPath}</p>
      <div className="workspace-metadata">
        <span>
          {t('catalog.sessions.count', { count: workspace.sessionCount })}
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
            {t('catalog.workspaces.last-activity', {
              time: `${formatDate(new Date(workspace.lastActivityAt))} ${formatTime(new Date(workspace.lastActivityAt))}`
            })}
          </span>
        )}
      </div>
      <button
        aria-label={t('catalog.workspaces.open-sessions-label', {
          workspace: workspace.displayName,
          path: workspace.canonicalPath
        })}
        className="workspace-card-action"
        onClick={() => onOpenWorkspace(workspace.id)}
        data-lumora-command
        tabIndex={-1}
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
  hiddenWorkspaceCount = 0,
  onHideWorkspace,
  onManageHiddenWorkspaces,
  onOpenWorkspace,
  scopeLabel
}: WorkspacesViewProps): ReactNode {
  const { t } = useLocalization();
  const [queryText, setQueryText] = useState('');
  const workspaces =
    status.state === 'ready' ? status.snapshot.workspaces : [];
  const normalizedQuery = queryText.trim().toLowerCase();
  const filteredWorkspaces = useMemo(() => {
    if (normalizedQuery.length === 0) return workspaces;
    return workspaces.filter((workspace) =>
      workspace.displayName.toLowerCase().includes(normalizedQuery) ||
      workspace.canonicalPath.toLowerCase().includes(normalizedQuery)
    );
  }, [normalizedQuery, workspaces]);
  const progress = useProgressiveList({
    itemCount: filteredWorkspaces.length,
    resetKey: `workspaces\u0000${normalizedQuery}`,
    initialCount: WORKSPACE_BATCH_SIZE,
    batchSize: WORKSPACE_BATCH_SIZE
  });

  if (status.state === 'loading') {
    return (
      <div className="catalog-state" role="status">
        {t('catalog.loading.catalog')}
      </div>
    );
  }

  if (status.state === 'error') {
    return (
      <section className="catalog-state catalog-error" role="alert">
        <div>
          <h2>{t('catalog.errors.catalog-title')}</h2>
          <p>{t('catalog.errors.catalog-description')}</p>
        </div>
        <button
          className="secondary-button"
          data-lumora-command
          onClick={onRefresh}
          tabIndex={-1}
          type="button"
        >
          {t('errors.general.retry')}
        </button>
      </section>
    );
  }

  return (
    <section className="catalog-panel" aria-labelledby="workspace-list-title">
      <div className="session-toolbar">
        <label className="search-control">
          <span>{t('catalog.workspaces.search-label')}</span>
          <input
            onChange={(event) => setQueryText(event.currentTarget.value)}
            placeholder={t('catalog.workspaces.search-placeholder')}
            type="search"
            value={queryText}
          />
        </label>
        <div className="catalog-actions">
          {onManageHiddenWorkspaces === undefined ? null : (
            <button
              className="secondary-button"
              data-lumora-command
              onClick={onManageHiddenWorkspaces}
              tabIndex={-1}
              type="button"
            >
              {t('catalog.workspaces.hidden-count', { count: hiddenWorkspaceCount })}
            </button>
          )}
          <button
            className="secondary-button"
            disabled={isRefreshing}
            onClick={onRefresh}
            data-lumora-command
            tabIndex={-1}
            type="button"
          >
            {t(isRefreshing ? 'catalog.workspaces.refreshing' : 'catalog.workspaces.refresh')}
          </button>
          {onAddWorkspace === undefined ? null : (
            <button
              className="refresh-button"
              onClick={onAddWorkspace}
              data-lumora-command
              tabIndex={-1}
              type="button"
            >
              {t('catalog.workspaces.add')}
            </button>
          )}
        </div>
      </div>

      <div className="catalog-result-heading">
        <p className="card-label">{scopeLabel ?? t('catalog.workspaces.scope-local')}</p>
        <h2 aria-live="polite" id="workspace-list-title">
          {normalizedQuery.length === 0
            ? t('catalog.workspaces.count', { count: workspaces.length })
            : t('catalog.workspaces.filtered-count', {
                visible: filteredWorkspaces.length,
                total: workspaces.length
              })}
        </h2>
      </div>

      {workspaces.length === 0 ? (
        <div className="catalog-empty">
          <h3>{t('catalog.workspaces.empty-title')}</h3>
          <p>{t('catalog.workspaces.empty-description')}</p>
        </div>
      ) : filteredWorkspaces.length === 0 ? (
        <div className="catalog-empty">
          <h3>{t('catalog.workspaces.no-results-title')}</h3>
          <p>{t('catalog.workspaces.no-results-description')}</p>
        </div>
      ) : (
        <>
          <div className="workspace-list">
            {filteredWorkspaces
              .slice(0, progress.visibleCount)
              .map((workspace) => (
                <WorkspaceCard
                  key={workspace.id}
                  onHideWorkspace={onHideWorkspace}
                  onOpenWorkspace={onOpenWorkspace}
                  workspace={workspace}
                />
              ))}
          </div>
          <ProgressiveListControl
            hasMore={progress.hasMore}
            label={t('catalog.workspaces.load-more')}
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
  workspaceById?: ReadonlyMap<string, WorkspaceSummary> | undefined;
  showInformationalNotices: boolean;
  runningSessionIds?: ReadonlySet<string> | undefined;
  onSearchChange(value: string): void;
  onProviderChange(value: ProviderId | null): void;
  onDismissDiagnostic(identity: string): void;
  onRefresh(): void;
  onResume?: ((session: SessionSummary) => void) | undefined;
  onResumeOptions?: ((session: SessionSummary) => void) | undefined;
}

function diagnosticIdentity(
  diagnostic: CatalogSnapshot['diagnostics'][number]
): string {
  return `${diagnostic.code}:${diagnostic.provider ?? 'catalog'}`;
}

const SessionRow = memo(function SessionRow({
  session,
  running,
  workspace,
  providerScan,
  profiles,
  onResume,
  onResumeOptions
}: {
  session: SessionSummary;
  running: boolean;
  workspace: WorkspaceSummary | undefined;
  providerScan: ProviderScanResult | null;
  profiles: readonly TerminalProfile[];
  onResume?: ((session: SessionSummary) => void) | undefined;
  onResumeOptions?: ((session: SessionSummary) => void) | undefined;
}): ReactNode {
  const { formatDate, formatNumber, formatTime, t } = useLocalization();
  const disabledReason = onResume === undefined || running
    ? null
    : resolveSessionResumeDisabledReason({
        session,
        workspace,
        providerScan,
        profiles
      });
  const actionDescription = running
    ? t('catalog.sessions.open-running')
    : t('catalog.sessions.resume');
  const resumeMenu = useSessionResumeContextMenu({ onResume, onResumeOptions });
  return (
    <>
    <Tooltip content={disabledReason} multiline>
      <tr
        aria-description={disabledReason ?? undefined}
        className={`session-row${
          onResume === undefined || disabledReason === null
            ? ''
            : ' session-row-unavailable'
        }`}
        onContextMenu={(event) => resumeMenu.openFromPointer(
          event,
          session,
          running,
          disabledReason
        )}
      >
      <td>
        {onResume === undefined ? null : (
          <Tooltip
            content={disabledReason === null ? actionDescription : null}
          >
            <button
              aria-description={disabledReason ?? actionDescription}
              aria-label={running
                ? t('catalog.sessions.open-running-label', { session: session.title })
                : t('catalog.sessions.resume-label', { session: session.title })}
              className="session-row-action"
              disabled={disabledReason !== null}
              onClick={() => onResume(session)}
              onKeyDown={(event) => resumeMenu.openFromKeyboard(
                event,
                session,
                running,
                disabledReason
              )}
              data-lumora-command
              tabIndex={-1}
              type="button"
            />
          </Tooltip>
        )}
        <strong>{session.title}</strong>
        {running ? (
          <span className="session-running-badge">{t('catalog.sessions.running')}</span>
        ) : null}
      </td>
      <td>
        <span className={`provider-badge provider-${session.provider}`}>
          {providerDefinition(session.provider).displayName}
        </span>
      </td>
      <td>
        <span className="session-workspace">
          {workspace?.displayName ?? t('catalog.sessions.unavailable-workspace')}
        </span>
      </td>
      <td>
        <time dateTime={session.updatedAt}>
          {`${formatDate(new Date(session.updatedAt))} ${formatTime(new Date(session.updatedAt))}`}
        </time>
      </td>
      <td aria-label={session.lifetimeTokens === null ? t('catalog.sessions.lifetime-tokens-unavailable') : undefined}>
        {session.lifetimeTokens === null ? null : (
          <span className="session-token-usage">
            {t('catalog.sessions.lifetime-tokens', {
              count: formatNumber(session.lifetimeTokens, {
                notation: 'compact',
                maximumFractionDigits: 1
              })
            })}
          </span>
        )}
      </td>
      <td>
        {session.sourceFreshness === 'stale' ? (
          <span className="source-stale">{t('catalog.sessions.stale-source')}</span>
        ) : (
          <span className="source-current">{t('catalog.sessions.current-source')}</span>
        )}
      </td>
      </tr>
    </Tooltip>
    {resumeMenu.menu}
    </>
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
  workspaceById,
  showInformationalNotices,
  runningSessionIds = EMPTY_SESSION_IDS,
  onSearchChange,
  onProviderChange,
  onDismissDiagnostic,
  onRefresh,
  onResume,
  onResumeOptions
}: SessionsViewProps): ReactNode {
  const { t } = useLocalization();
  const sessionCount =
    status.state === 'ready' ? status.snapshot.sessions.length : 0;
  const progress = useProgressiveList({
    itemCount: sessionCount,
    resetKey: `${provider ?? 'all'}\u0000${queryText.trim()}`,
    initialCount: SESSION_BATCH_SIZE,
    batchSize: SESSION_BATCH_SIZE
  });

  if (status.state === 'loading') {
    return (
      <div className="catalog-state" role="status">
        {t('catalog.loading.catalog')}
      </div>
    );
  }

  if (status.state === 'error') {
    return (
      <section className="catalog-state catalog-error" role="alert">
        <div>
          <h2>{t('catalog.errors.catalog-title')}</h2>
          <p>{t('catalog.errors.catalog-description')}</p>
        </div>
        <button
          className="secondary-button"
          data-lumora-command
          onClick={onRefresh}
          tabIndex={-1}
          type="button"
        >
          {t('errors.general.retry')}
        </button>
      </section>
    );
  }

  const { snapshot } = status;
  const workspaces = workspaceById ?? new Map(
    snapshot.workspaces.map((workspace) => [workspace.id, workspace])
  );
  const hasFilters = queryText.trim().length > 0 || provider !== null;

  return (
    <section className="catalog-panel" aria-labelledby="session-list-title">
      <div className="session-toolbar">
        <label className="search-control">
          <span>{t('catalog.sessions.search-label')}</span>
          <input
            onChange={(event) => onSearchChange(event.currentTarget.value)}
            placeholder={t('catalog.sessions.search-placeholder')}
            type="search"
            value={queryText}
          />
        </label>
        <div className="filter-control">
          <span>{t('catalog.sessions.provider-filter')}</span>
          <SelectMenu
            label={t('catalog.sessions.provider-filter')}
            onChange={(value) =>
              onProviderChange(value === '' ? null : value as ProviderId)
            }
            options={[
              { value: '', label: t('catalog.sessions.all-providers') },
              ...snapshot.providerFacets.map(({ provider, sessionCount }) => ({
                value: provider,
                label: `${providerDefinition(provider).displayName} (${sessionCount})`
              }))
            ]}
            value={provider ?? ''}
          />
        </div>
        <button
          className="secondary-button"
          disabled={isRefreshing}
          onClick={onRefresh}
          data-lumora-command
          tabIndex={-1}
          type="button"
        >
          {t(isRefreshing ? 'catalog.workspaces.refreshing' : 'catalog.workspaces.refresh')}
        </button>

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
              <Tooltip content={t('catalog.sessions.dismiss-warning')}>
                <button
                  aria-label={t('catalog.sessions.dismiss-warning-label', { warning: diagnostic.message })}
                  className="catalog-diagnostic-dismiss"
                  onClick={() => onDismissDiagnostic(identity)}
                  data-lumora-command
                  tabIndex={-1}
                  type="button"
                >
                  <span aria-hidden="true">×</span>
                </button>
              </Tooltip>
            </div>
          );
        })}


      <div className="catalog-result-heading">
        <p className="card-label">{t('catalog.sessions.scope-label')}</p>
        <h2 id="session-list-title">
          {t('catalog.sessions.count', { count: snapshot.sessions.length })}
        </h2>
      </div>

      {snapshot.sessions.length === 0 ? (
        <div className="catalog-empty">
          <h3>
            {t(hasFilters ? 'catalog.sessions.no-results-title' : 'catalog.sessions.empty-title')}
          </h3>
          <p>
            {hasFilters
              ? t('catalog.sessions.no-results-description')
              : t('catalog.sessions.empty-description')}
          </p>
        </div>
      ) : (
        <>
          <div className="session-table-wrap">
            <table className="session-table">
              <thead>
                <tr>
                  <th scope="col">{t('catalog.sessions.column-session')}</th>
                  <th scope="col">{t('catalog.sessions.column-provider')}</th>
                  <th scope="col">{t('catalog.sessions.column-workspace')}</th>
                  <th scope="col">{t('catalog.sessions.column-updated')}</th>
                  <th scope="col">{t('catalog.sessions.column-tokens')}</th>
                  <th scope="col">{t('catalog.sessions.column-source')}</th>
                </tr>
              </thead>
              <tbody>
                {snapshot.sessions
                  .slice(0, progress.visibleCount)
                  .map((session) => (
                    <SessionRow
                      key={session.id}
                      onResume={onResume}
                      onResumeOptions={onResumeOptions}
                      profiles={profiles}
                      providerScan={providerScan}
                      running={runningSessionIds.has(session.id)}
                      session={session}
                      workspace={workspaces.get(session.workspaceId)}
                    />
                  ))}
              </tbody>
            </table>
          </div>
          <ProgressiveListControl
            hasMore={progress.hasMore}
            label={t('catalog.sessions.load-more')}
            onLoadMore={progress.showMore}
          />
        </>
      )}
    </section>
  );
}

export function CatalogHomeSummary({
  status,
  availableProviderUpdates = [],
  providerSummary,
  providerScan,
  profiles,
  runtimes = [],
  runningSessionIds = EMPTY_SESSION_IDS,
  workspaceById,
  onRecover,
  onOpenProviderUpdates,
  onResume,
  onResumeOptions
}: {
  status: CatalogViewStatus;
  availableProviderUpdates?: readonly ProviderId[];
  providerSummary?: string;
  providerScan: ProviderScanResult | null;
  profiles: readonly TerminalProfile[];
  runtimes?: readonly RuntimeSummary[];
  runningSessionIds?: ReadonlySet<string> | undefined;
  workspaceById?: ReadonlyMap<string, WorkspaceSummary> | undefined;
  onRecover?(runtime: RuntimeSummary): void;
  onOpenProviderUpdates?(): void;
  onResume?: ((session: SessionSummary) => void) | undefined;
  onResumeOptions?: ((session: SessionSummary) => void) | undefined;
}): ReactNode {
  const { formatNumber, t } = useLocalization();
  const resumeMenu = useSessionResumeContextMenu({ onResume, onResumeOptions });
  if (status.state === 'loading') {
    return (
      <div className="catalog-state" role="status">
        {t('catalog.loading.catalog')}
      </div>
    );
  }

  if (status.state === 'error') {
    return (
      <div className="catalog-state catalog-error" role="alert">
        {t('catalog.errors.summary')}
      </div>
    );
  }

  const { snapshot } = status;
  const recentSessions = snapshot.sessions.slice(0, 3);
  const workspaces = workspaceById ?? new Map(
    snapshot.workspaces.map((workspace) => [workspace.id, workspace])
  );
  const liveRuntimes = runtimes.filter(
    (runtime) => runtime.state === 'launching' || runtime.state === 'running'
  );
  const lostRuntimes = runtimes.filter(
    (runtime) => runtime.state === 'runtime_lost'
  );
  const attentionCount = snapshot.diagnostics.length + lostRuntimes.length;
  const updateProviderNames = availableProviderUpdates.map(
    (provider) => providerDefinition(provider).displayName
  );
  return (
    <div className="dashboard-grid" aria-label={t('catalog.home.overview-label')}>
      <article className="dashboard-card catalog-metric-card">
        <p className="card-label">{t('catalog.home.runtime-label')}</p>
        <h2>{t('catalog.home.running-agents')}</h2>
        <strong className="metric-value">
          {liveRuntimes.length === 0
            ? t('catalog.home.managed-processes-empty')
            : t('catalog.home.managed-processes', { count: liveRuntimes.length })}
        </strong>
        <p className="card-description">
          {t('catalog.home.managed-processes-description')}
        </p>
      </article>

      <article className="dashboard-card catalog-metric-card">
        <p className="card-label">{t('catalog.home.diagnostics-label')}</p>
        <h2>{t('catalog.home.needs-attention')}</h2>
        <strong className="metric-value">
          {lostRuntimes.length === 0
            ? t('catalog.home.catalog-issues', { count: snapshot.diagnostics.length })
            : t('catalog.home.attention-items', { count: attentionCount })}
        </strong>
        <p className="card-description">
          {lostRuntimes.length === 0
            ? t('catalog.home.diagnostic-description')
            : t('catalog.home.diagnostic-breakdown', {
                catalogCount: snapshot.diagnostics.length,
                runtimeCount: lostRuntimes.length
              })}
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
                        ? t('catalog.home.resume-saved-session')
                        : t('catalog.home.restart-new-session')}
                    </small>
                  </span>
                  {onRecover === undefined ? null : (
                    <button
                      className="text-button"
                      onClick={() => onRecover(runtime)}
                      data-lumora-command
                      tabIndex={-1}
                      type="button"
                    >
                      {t('catalog.home.recover')}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </article>

      <article className="dashboard-card recent-session-card">
        <p className="card-label">{t('catalog.home.recent-sessions')}</p>
        <h2>{t('catalog.home.recent-sessions')}</h2>
        <strong className="metric-value">
          {t('catalog.home.saved-sessions', { count: snapshot.sessions.length })}
        </strong>
        {recentSessions.length === 0 ? (
          <p className="card-description">{t('catalog.home.no-recent-sessions')}</p>
        ) : (
          <ul className="recent-session-list">
            {recentSessions.map((session) => {
              const workspace = workspaces.get(session.workspaceId);
              const running = runningSessionIds.has(session.id);
              const disabledReason = onResume === undefined || running
                ? null
                : resolveSessionResumeDisabledReason({
                    session,
                    workspace,
                    providerScan,
                    profiles
                  });
              return (
                <li
                  key={session.id}
                  onContextMenu={(event) => resumeMenu.openFromPointer(
                    event,
                    session,
                    running,
                    disabledReason
                  )}
                >
                  <span className="recent-session-copy">
                    <OverflowTooltip content={session.title}>
                      <strong>{session.title}</strong>
                    </OverflowTooltip>
                    <span className="recent-session-metadata">
                      <span className="recent-session-provider">
                        {providerDefinition(session.provider).displayName}
                      </span>
                      {workspace === undefined ? null : (
                        <OverflowTooltip content={workspace.displayName}>
                          <span className="recent-session-workspace">
                            {workspace.displayName}
                          </span>
                        </OverflowTooltip>
                      )}
                      {session.lifetimeTokens === null ? null : (
                        <span className="session-token-usage">
                          {t('catalog.sessions.lifetime-tokens', {
                            count: formatNumber(session.lifetimeTokens, {
                              notation: 'compact',
                              maximumFractionDigits: 1
                            })
                          })}
                        </span>
                      )}
                      {running ? (
                        <span className="session-running-badge">{t('catalog.sessions.running')}</span>
                      ) : null}
                    </span>
                  </span>
                  {onResume === undefined ? null : (
                    <Tooltip
                      content={disabledReason ?? (
                        running ? t('catalog.sessions.open-running') : t('catalog.sessions.resume')
                      )}
                    >
                      <button
                        aria-description={disabledReason ?? (
                          running ? t('catalog.sessions.open-running') : t('catalog.sessions.resume')
                        )}
                        aria-label={running
                          ? t('catalog.sessions.open-running-label', { session: session.title })
                          : undefined}
                        className="text-button recent-session-resume"
                        disabled={disabledReason !== null}
                        onClick={() => onResume(session)}
                        onKeyDown={(event) => resumeMenu.openFromKeyboard(
                          event,
                          session,
                          running,
                          disabledReason
                        )}
                        data-lumora-command
                        tabIndex={-1}
                        type="button"
                      >
                        {t(running ? 'common.actions.open' : 'common.actions.resume')}
                      </button>
                    </Tooltip>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        {resumeMenu.menu}
      </article>

      <article className="dashboard-card catalog-metric-card">
        <p className="card-label">{t('catalog.home.provider-discovery')}</p>
        <h2>{t('catalog.home.scan-health')}</h2>
        <strong className="metric-value">
          {t('catalog.workspaces.count', { count: snapshot.workspaces.length })}
        </strong>
        <div className="empty-state">
          <span className="empty-state-mark" aria-hidden="true" />
          {providerSummary ?? t('catalog.home.provider-status-settings')}
        </div>
        {updateProviderNames.length === 0 || onOpenProviderUpdates === undefined
          ? null
          : (
            <button
              aria-label={t('catalog.home.updates-available-label', {
                count: updateProviderNames.length,
                providers: updateProviderNames.join(', ')
              })}
              className="provider-update-notice"
              data-lumora-command
              onClick={onOpenProviderUpdates}
              tabIndex={-1}
              type="button"
            >
              <span className="provider-update-notice-count">
                {t('catalog.home.updates-available', { count: updateProviderNames.length })}
              </span>
              <span aria-hidden="true"> · </span>
              <OverflowTooltip content={updateProviderNames.join(', ')}>
                <span className="provider-update-notice-names">
                  {updateProviderNames.join(', ')}
                </span>
              </OverflowTooltip>
            </button>
          )}
      </article>
    </div>
  );
}
