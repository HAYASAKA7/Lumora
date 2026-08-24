import { memo, type ReactNode } from 'react';

import type {
  ProviderScanResult,
  SessionSummary,
  TerminalProfile,
  WorkspaceSummary
} from '../../../shared/contracts';
import type { CatalogViewStatus } from './CatalogViews';
import {
  ProgressiveListControl,
  useProgressiveList
} from './progressive-list';
import { resolveSessionResumeDisabledReason } from './session-resume';
import {
  SESSION_PROVIDER_IDS,
  providerDefinition
} from '../../../shared/provider-definitions';
import { Tooltip } from '../ui/Tooltip';
import { useLocalization } from '../localization/useLocalization';

const SESSION_BATCH_SIZE = 40;
const EMPTY_SESSION_IDS: ReadonlySet<string> = new Set();

interface WorkspaceSessionsViewProps {
  workspaceId: string;
  status: CatalogViewStatus;
  isRefreshing: boolean;
  providerScan: ProviderScanResult | null;
  profiles: readonly TerminalProfile[];
  runningSessionIds?: ReadonlySet<string> | undefined;
  onBack(): void;
  onRefresh(): void;
  onRetry(): void;
  onResume?: ((session: SessionSummary) => void) | undefined;
  operationError: string | null;
}

const WorkspaceSessionCard = memo(function WorkspaceSessionCard({
  session,
  running,
  workspace,
  providerScan,
  profiles,
  onResume
}: {
  session: SessionSummary;
  running: boolean;
  workspace: WorkspaceSummary;
  providerScan: ProviderScanResult | null;
  profiles: readonly TerminalProfile[];
  onResume?: ((session: SessionSummary) => void) | undefined;
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
  return (
    <Tooltip content={disabledReason} multiline>
      <article
        aria-description={disabledReason ?? undefined}
        className={`workspace-session-card${
          onResume === undefined || disabledReason === null
            ? ''
            : ' workspace-session-card-unavailable'
        }`}
      >
      <div className="workspace-session-copy">
        <div className="workspace-session-heading">
          <h3>{session.title}</h3>
          {running ? (
            <span className="session-running-badge">{t('catalog.sessions.running')}</span>
          ) : null}
          <span className={`provider-badge provider-${session.provider}`}>
            {providerDefinition(session.provider).displayName}
          </span>
        </div>
        <div className="workspace-metadata">
          <span>
            {t('catalog.sessions.updated', {
              time: `${formatDate(new Date(session.updatedAt))} ${formatTime(new Date(session.updatedAt))}`
            })}
          </span>
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
          {session.sourceFreshness === 'stale' ? (
            <span className="source-stale">{t('catalog.sessions.stale-source')}</span>
          ) : (
            <span className="source-current">{t('catalog.sessions.current-source')}</span>
          )}
        </div>
      </div>
        {onResume === undefined ? null : (
          <Tooltip
            content={disabledReason === null ? actionDescription : null}
          >
            <button
              aria-description={disabledReason ?? actionDescription}
              aria-label={running
                ? t('catalog.sessions.open-running-label', { session: session.title })
                : t('catalog.sessions.resume-label', { session: session.title })}
              className="workspace-session-action"
              disabled={disabledReason !== null}
              onClick={() => onResume(session)}
              data-lumora-command
              tabIndex={-1}
              type="button"
            />
          </Tooltip>
        )}
      </article>
    </Tooltip>
  );
});

export function WorkspaceSessionsView({
  workspaceId,
  status,
  isRefreshing,
  providerScan,
  profiles,
  runningSessionIds = EMPTY_SESSION_IDS,
  onBack,
  onRefresh,
  onRetry,
  onResume,
  operationError
}: WorkspaceSessionsViewProps): ReactNode {
  const { t } = useLocalization();
  const sessions =
    status.state === 'ready'
      ? status.snapshot.sessions.filter(
          (session) => session.workspaceId === workspaceId
        )
      : [];
  const sessionCount = sessions.length;
  const progress = useProgressiveList({
    itemCount: sessionCount,
    resetKey: workspaceId,
    initialCount: SESSION_BATCH_SIZE,
    batchSize: SESSION_BATCH_SIZE
  });

  if (status.state === 'loading') {
    return (
      <section className="catalog-panel workspace-detail">
        <button className="secondary-button" data-lumora-command onClick={onBack} tabIndex={-1} type="button">
          {t('catalog.workspaces.back')}
        </button>
        <div className="catalog-state" role="status">
          {t('catalog.workspaces.loading-sessions')}
        </div>
      </section>
    );
  }

  if (status.state === 'error') {
    return (
      <section className="catalog-panel workspace-detail">
        <button className="secondary-button" data-lumora-command onClick={onBack} tabIndex={-1} type="button">
          {t('catalog.workspaces.back')}
        </button>
        <div className="catalog-state catalog-error" role="alert">
          <div>
            <h2>{t('catalog.workspaces.history-unavailable-title')}</h2>
            <p>{t('catalog.workspaces.history-unavailable-description')}</p>
          </div>
          <button className="secondary-button" data-lumora-command onClick={onRetry} tabIndex={-1} type="button">
            {t('errors.general.retry')}
          </button>
        </div>
      </section>
    );
  }

  const workspace = status.snapshot.workspaces.find(
    (candidate) => candidate.id === workspaceId
  );
  if (workspace === undefined) {
    return (
      <section className="catalog-panel workspace-detail">
        <button className="secondary-button" data-lumora-command onClick={onBack} tabIndex={-1} type="button">
          {t('catalog.workspaces.back')}
        </button>
        <div className="catalog-empty" role="status">
          <h2>{t('catalog.workspaces.missing-title')}</h2>
          <p>{t('catalog.workspaces.missing-description')}</p>
        </div>
      </section>
    );
  }


  return (
    <section
      aria-labelledby="workspace-session-title"
      className="catalog-panel workspace-detail"
    >
      <div className="workspace-detail-toolbar">
        <button className="secondary-button" data-lumora-command onClick={onBack} tabIndex={-1} type="button">
          {t('catalog.workspaces.back')}
        </button>
        <div className="catalog-actions">
          <span className={`origin-badge origin-${workspace.origin}`}>
            {t(`catalog.workspaces.origin-${workspace.origin}`)}
          </span>
          <button
            className="secondary-button"
            disabled={isRefreshing}
            onClick={onRefresh}
            data-lumora-command
            tabIndex={-1}
            type="button"
          >
            {t(isRefreshing ? 'catalog.workspaces.refreshing-sessions' : 'catalog.workspaces.refresh-sessions')}
          </button>

        </div>
      </div>

      {operationError === null ? null : (
        <div className="catalog-operation-error" role="alert">
          {operationError}
        </div>
      )}

      <header className="workspace-detail-header">
        <div>
          <p className="card-label">{t('catalog.workspaces.history-label')}</p>
          <h2 id="workspace-session-title">{t('catalog.workspaces.history-title', { workspace: workspace.displayName })}</h2>
        </div>
        {!workspace.available ? (
          <span className="availability-badge">{t('catalog.workspaces.unavailable')}</span>
        ) : null}
      </header>
      <p className="workspace-path">{workspace.canonicalPath}</p>
      <div className="workspace-metadata workspace-detail-metadata">
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
      </div>


      {sessions.length === 0 ? (
        <div className="catalog-empty">
          <h3>{t('catalog.workspaces.sessions-empty-title')}</h3>
          <p>{t('catalog.workspaces.sessions-empty-description')}</p>
        </div>
      ) : (
        <>
          <div className="workspace-session-list">
            {sessions.slice(0, progress.visibleCount).map((session) => (
              <WorkspaceSessionCard
                key={session.id}
                onResume={onResume}
                profiles={profiles}
                providerScan={providerScan}
                running={runningSessionIds.has(session.id)}
                session={session}
                workspace={workspace}
              />
            ))}
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
