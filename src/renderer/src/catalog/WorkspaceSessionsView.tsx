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
import { formatLifetimeTokens } from './session-usage';

const SESSION_BATCH_SIZE = 40;

interface WorkspaceSessionsViewProps {
  workspaceId: string;
  status: CatalogViewStatus;
  isRefreshing: boolean;
  providerScan: ProviderScanResult | null;
  profiles: readonly TerminalProfile[];
  onBack(): void;
  onRefresh(): void;
  onRetry(): void;
  onResume(session: SessionSummary): void;
  operationError: string | null;
}

const WorkspaceSessionCard = memo(function WorkspaceSessionCard({
  session,
  workspace,
  providerScan,
  profiles,
  onResume
}: {
  session: SessionSummary;
  workspace: WorkspaceSummary;
  providerScan: ProviderScanResult | null;
  profiles: readonly TerminalProfile[];
  onResume(session: SessionSummary): void;
}): ReactNode {
  const disabledReason = resolveSessionResumeDisabledReason({
    session,
    workspace,
    providerScan,
    profiles
  });
  return (
    <article
      className={`workspace-session-card${
        disabledReason === null ? '' : ' workspace-session-card-unavailable'
      }`}
      title={disabledReason ?? undefined}
    >
      <div className="workspace-session-copy">
        <div className="workspace-session-heading">
          <h3>{session.title}</h3>
          <span className={`provider-badge provider-${session.provider}`}>
            {providerDefinition(session.provider).displayName}
          </span>
        </div>
        <div className="workspace-metadata">
          <span>
            Updated{' '}
            <time dateTime={session.updatedAt}>
              {new Date(session.updatedAt).toLocaleString()}
            </time>
          </span>
          {session.lifetimeTokens === null ? null : (
            <span className="session-token-usage">
              {formatLifetimeTokens(session.lifetimeTokens)}
            </span>
          )}
          {session.sourceFreshness === 'stale' ? (
            <span className="source-stale">Stale source</span>
          ) : (
            <span className="source-current">Current</span>
          )}
        </div>
      </div>
      <button
        aria-label={`Resume ${session.title}`}
        className="workspace-session-action"
        disabled={disabledReason !== null}
        onClick={() => onResume(session)}
        title={disabledReason ?? 'Resume this session'}
        type="button"
      />
    </article>
  );
});

export function WorkspaceSessionsView({
  workspaceId,
  status,
  isRefreshing,
  providerScan,
  profiles,
  onBack,
  onRefresh,
  onRetry,
  onResume,
  operationError
}: WorkspaceSessionsViewProps): ReactNode {
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
        <button className="secondary-button" onClick={onBack} type="button">
          Back to workspaces
        </button>
        <div className="catalog-state" role="status">
          Loading workspace sessions
        </div>
      </section>
    );
  }

  if (status.state === 'error') {
    return (
      <section className="catalog-panel workspace-detail">
        <button className="secondary-button" onClick={onBack} type="button">
          Back to workspaces
        </button>
        <div className="catalog-state catalog-error" role="alert">
          <div>
            <h2>Workspace history unavailable</h2>
            <p>Lumora could not read this workspace's session history.</p>
          </div>
          <button className="secondary-button" onClick={onRetry} type="button">
            Try again
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
        <button className="secondary-button" onClick={onBack} type="button">
          Back to workspaces
        </button>
        <div className="catalog-empty" role="status">
          <h2>Workspace no longer available</h2>
          <p>This workspace is no longer present in the local catalog.</p>
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
        <button className="secondary-button" onClick={onBack} type="button">
          Back to workspaces
        </button>
        <div className="catalog-actions">
          <span className={`origin-badge origin-${workspace.origin}`}>
            {workspace.origin === 'manual' ? 'Manual' : 'Discovered'}
          </span>
          <button
            className="secondary-button"
            disabled={isRefreshing}
            onClick={onRefresh}
            type="button"
          >
            {isRefreshing ? 'Refreshing sessions' : 'Refresh sessions'}
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
          <p className="card-label">Workspace history</p>
          <h2 id="workspace-session-title">{workspace.displayName} sessions</h2>
        </div>
        {!workspace.available ? (
          <span className="availability-badge">Unavailable</span>
        ) : null}
      </header>
      <p className="workspace-path">{workspace.canonicalPath}</p>
      <div className="workspace-metadata workspace-detail-metadata">
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
      </div>


      {sessions.length === 0 ? (
        <div className="catalog-empty">
          <h3>No sessions in this workspace</h3>
          <p>Refresh after using a supported agent in this folder.</p>
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
                session={session}
                workspace={workspace}
              />
            ))}
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
