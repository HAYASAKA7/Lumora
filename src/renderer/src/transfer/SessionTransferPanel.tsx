import { useCallback, useEffect, useState } from 'react';

import type {
  SessionTransferArchiveSelection,
  SessionTransferCapability,
  TransferHistoryEntry,
  WorkspaceSummary
} from '../../../shared/contracts';
import { SessionTransferDialog } from './SessionTransferDialog';

interface SessionTransferPanelProps {
  active: boolean;
  workspaces: readonly WorkspaceSummary[];
  onImportCompleted(): Promise<unknown> | unknown;
}

type LoadState = 'idle' | 'loading' | 'ready' | 'error';

function supportLabel(
  support: SessionTransferCapability['exportSupport']
): string {
  switch (support) {
    case 'supported':
      return 'Supported';
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

function historySummary(entry: TransferHistoryEntry): string {
  if (entry.direction === 'import') {
    return `${entry.importedCount} imported · ${entry.skippedCount} skipped`;
  }
  return `${entry.exportedCount} exported · ${entry.skippedCount} skipped`;
}

export function SessionTransferPanel({
  active,
  onImportCompleted,
  workspaces
}: SessionTransferPanelProps) {
  const [loadState, setLoadState] = useState<LoadState>('idle');
  const [capabilities, setCapabilities] = useState<
    SessionTransferCapability[]
  >([]);
  const [history, setHistory] = useState<TransferHistoryEntry[]>([]);
  const [selection, setSelection] =
    useState<SessionTransferArchiveSelection | null>(null);
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

  const importCompleted = async () => {
    await onImportCompleted();
    try {
      setHistory(await window.lumora.getTransferHistory());
    } catch {
      setError('The transfer history could not be refreshed.');
    }
  };

  return (
    <>
      <div className="catalog-panel session-transfer-panel">
        <header className="transfer-panel-header">
          <div>
            <p className="card-label">Portable provider sessions</p>
            <h2>Session transfer</h2>
            <p className="card-description">
              Move native session files between devices without changing their
              provider format.
            </p>
          </div>
          <button
            className="refresh-button"
            onClick={() => void chooseArchive()}
            type="button"
          >
            Import sessions
          </button>
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
                    Routes stay disabled until Lumora has verified that
                    provider and platform combination.
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
                  const sameOs = capability.routes.some(
                    (route) =>
                      route.sourcePlatform === route.destinationPlatform &&
                      route.support === 'supported'
                  );
                  const crossPlatform = capability.routes.some(
                    (route) =>
                      route.sourcePlatform !== route.destinationPlatform &&
                      route.support === 'supported'
                  );
                  return (
                    <div
                      className="transfer-capability-row"
                      key={capability.provider}
                    >
                      <strong>{capability.displayName}</strong>
                      <span>{supportLabel(capability.exportSupport)}</span>
                      <span>{sameOs ? 'Supported' : 'Not verified'}</span>
                      <span>{crossPlatform ? 'Supported' : 'Not verified'}</span>
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
                          {entry.direction === 'import' ? 'Imported' : 'Exported'}{' '}
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
                skips missing providers and unresolved workspaces instead of
                overwriting native data.
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
      </div>

      {selection !== null ? (
        <SessionTransferDialog
          onClose={() => setSelection(null)}
          onImported={importCompleted}
          selection={selection}
          workspaces={workspaces}
        />
      ) : null}
    </>
  );
}
