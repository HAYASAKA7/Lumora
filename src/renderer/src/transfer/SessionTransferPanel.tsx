import { useCallback, useEffect, useState } from 'react';

import type {
  ProviderScanResult,
  SessionSummary,
  SessionTransferArchiveSelection,
  SessionTransferCapability,
  TransferHistoryEntry,
  WorkspaceSummary
} from '../../../shared/contracts';
import { isUsableTransferSupport } from '../../../shared/session-transfer';
import { SessionExportDialog } from './SessionExportDialog';
import { SessionTransferDialog } from './SessionTransferDialog';
import { SessionTransferExportSelection } from './SessionTransferExportSelection';

interface SessionTransferPanelProps {
  active: boolean;
  providerScan: ProviderScanResult | null;
  runningSessionIds: ReadonlySet<string>;
  sessions: readonly SessionSummary[];
  workspaces: readonly WorkspaceSummary[];
  onImportCompleted(): Promise<unknown> | unknown;
}

type LoadState = 'idle' | 'loading' | 'ready' | 'error';
type PanelMode = 'overview' | 'export';

function supportLabel(
  support: SessionTransferCapability['exportSupport']
): string {
  switch (support) {
    case 'supported':
      return 'Supported';
    case 'experimental':
      return 'Experimental';
    case 'provider_not_installed':
      return 'Not installed';
    case 'provider_disabled':
      return 'Disabled';
    case 'provider_version_unsupported':
      return 'Update required';
    case 'route_unverified':
      return 'Not verified';
  }
}

function routeSupportLabel(
  routes: readonly SessionTransferCapability['routes'][number][]
): string {
  if (routes.some((route) => route.support === 'supported')) {
    return 'Supported';
  }
  if (routes.some((route) => route.support === 'experimental')) {
    return 'Experimental';
  }
  return 'Not verified';
}

function historySummary(entry: TransferHistoryEntry): string {
  if (entry.direction === 'import') {
    return `${entry.importedCount} imported · ${entry.skippedCount} skipped`;
  }
  return `${entry.exportedCount} exported · ${entry.skippedCount} skipped`;
}

export function SessionTransferPanel({
  active,
  onImportCompleted,
  providerScan,
  runningSessionIds,
  sessions,
  workspaces
}: SessionTransferPanelProps) {
  const [loadState, setLoadState] = useState<LoadState>('idle');
  const [capabilities, setCapabilities] = useState<
    SessionTransferCapability[]
  >([]);
  const [history, setHistory] = useState<TransferHistoryEntry[]>([]);
  const [mode, setMode] = useState<PanelMode>('overview');
  const [selection, setSelection] =
    useState<SessionTransferArchiveSelection | null>(null);
  const [exportSessionIds, setExportSessionIds] = useState<string[] | null>(
    null
  );
  const [error, setError] = useState<string | null>(null);

  const loadTransferState = useCallback(async () => {
    setLoadState('loading');
    setError(null);
    try {
      const [nextCapabilities, nextHistory] = await Promise.all([
        window.lumora.getTransferCapabilities(),
        window.lumora.getTransferHistory()
      ]);
      setCapabilities(nextCapabilities);
      setHistory(nextHistory);
      setLoadState('ready');
    } catch {
      setError('Session transfer information could not be loaded.');
      setLoadState('error');
    }
  }, []);

  useEffect(() => {
    if (active && loadState === 'idle') {
      void loadTransferState();
    }
  }, [active, loadState, loadTransferState]);

  useEffect(() => {
    if (active) return;
    setMode('overview');
    setExportSessionIds(null);
  }, [active]);

  const chooseArchive = async () => {
    setError(null);
    try {
      const nextSelection =
        await window.lumora.chooseSessionImportArchive();
      if (nextSelection !== null) setSelection(nextSelection);
    } catch {
      setError('The session archive could not be opened.');
    }
  };

  const refreshHistory = async () => {
    try {
      setHistory(await window.lumora.getTransferHistory());
    } catch {
      setError('The transfer history could not be refreshed.');
    }
  };

  const importCompleted = async () => {
    await onImportCompleted();
    await refreshHistory();
  };

  const hasExperimentalRoutes = capabilities.some(
    (capability) =>
      capability.exportSupport === 'experimental' ||
      capability.routes.some((route) => route.support === 'experimental')
  );

  return (
    <>
      <div className="catalog-panel session-transfer-panel">
        {mode === 'export' ? (
          <SessionTransferExportSelection
            capabilities={capabilities}
            onBack={() => setMode('overview')}
            onContinue={(sessionIds) => {
              setExportSessionIds([...sessionIds]);
              setMode('overview');
            }}
            providerScan={providerScan}
            runningSessionIds={runningSessionIds}
            sessions={sessions}
          />
        ) : (
          <>
            <header className="transfer-panel-header">
              <div>
                <p className="card-label">Portable provider sessions</p>
                <h2>Session transfer</h2>
                <p className="card-description">
                  Move native session files between devices without changing
                  their provider format.
                </p>
              </div>
              <div className="transfer-panel-actions">
                <button
                  className="secondary-button"
                  disabled={loadState !== 'ready'}
                  onClick={() => setMode('export')}
                  type="button"
                >
                  Export sessions
                </button>
                <button
                  className="refresh-button"
                  onClick={() => void chooseArchive()}
                  type="button"
                >
                  Import sessions
                </button>
              </div>
            </header>

            {error !== null ? (
              <p className="catalog-operation-error" role="alert">
                {error}
              </p>
            ) : null}

            {loadState === 'loading' || loadState === 'idle' ? (
              <div className="transfer-panel-loading" role="status">
                Checking transfer support
              </div>
            ) : null}

            {loadState === 'ready' ? (
              <div className="transfer-panel-sections">
                <section aria-labelledby="transfer-capabilities-title">
                  <div className="transfer-section-heading">
                    <div>
                      <h3 id="transfer-capabilities-title">Provider support</h3>
                      <p>
                        {hasExperimentalRoutes
                          ? 'This development build enables adapter-backed routes for experimental testing. Release builds still require verification.'
                          : 'Untested provider and operating-system combinations stay unavailable to protect your sessions.'}
                      </p>
                    </div>
                  </div>
                  <div className="transfer-capability-table">
                    <div className="transfer-capability-row transfer-capability-heading">
                      <span>Provider</span>
                      <span>Export</span>
                      <span>Same OS</span>
                      <span>Cross-platform</span>
                    </div>
                    {capabilities.map((capability) => {
                      const sameOs = routeSupportLabel(
                        capability.routes.filter(
                          (route) =>
                            route.sourcePlatform === route.destinationPlatform &&
                            isUsableTransferSupport(route.support)
                        )
                      );
                      const crossPlatform = routeSupportLabel(
                        capability.routes.filter(
                          (route) =>
                            route.sourcePlatform !== route.destinationPlatform &&
                            isUsableTransferSupport(route.support)
                        )
                      );
                      return (
                        <div
                          className="transfer-capability-row"
                          key={capability.provider}
                        >
                          <strong>{capability.displayName}</strong>
                          <span>{supportLabel(capability.exportSupport)}</span>
                          <span>{sameOs}</span>
                          <span>{crossPlatform}</span>
                        </div>
                      );
                    })}
                  </div>
                </section>

                <section aria-labelledby="transfer-history-title">
                  <div className="transfer-section-heading">
                    <div>
                      <h3 id="transfer-history-title">Recent transfers</h3>
                      <p>Only non-sensitive summaries are retained.</p>
                    </div>
                  </div>
                  {history.length > 0 ? (
                    <div className="transfer-history-list">
                      {history.map((entry) => (
                        <article key={entry.id}>
                          <div>
                            <strong>
                              {entry.direction === 'import'
                                ? 'Imported'
                                : 'Exported'}{' '}
                              {entry.providers.join(', ')}
                            </strong>
                            <span>{historySummary(entry)}</span>
                          </div>
                          <time dateTime={entry.completedAt}>
                            {new Date(entry.completedAt).toLocaleString()}
                          </time>
                        </article>
                      ))}
                    </div>
                  ) : (
                    <p className="transfer-empty">No transfers yet.</p>
                  )}
                </section>

                <section
                  aria-labelledby="transfer-guide-title"
                  className="transfer-guidance"
                >
                  <h3 id="transfer-guide-title">Before importing</h3>
                  <p>
                    Install and enable the destination providers first. Lumora
                    skips missing providers and unresolved workspaces instead
                    of overwriting native data.
                  </p>
                </section>
              </div>
            ) : null}

            {loadState === 'error' ? (
              <button
                className="secondary-button"
                onClick={() => void loadTransferState()}
                type="button"
              >
                Try again
              </button>
            ) : null}
          </>
        )}
      </div>

      {selection !== null ? (
        <SessionTransferDialog
          onClose={() => setSelection(null)}
          onImported={importCompleted}
          selection={selection}
          workspaces={workspaces}
        />
      ) : null}
      {exportSessionIds !== null ? (
        <SessionExportDialog
          onClose={() => {
            setExportSessionIds(null);
            void refreshHistory();
          }}
          sessionIds={exportSessionIds}
        />
      ) : null}
    </>
  );
}
