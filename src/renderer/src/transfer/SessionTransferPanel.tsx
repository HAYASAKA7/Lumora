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
import { useLocalization, type TranslationValues } from '../localization/useLocalization';

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
  support: SessionTransferCapability['exportSupport'],
  t: (key: string, values?: TranslationValues) => string
): string {
  switch (support) {
    case 'supported':
      return t('transfer.overview.supported');
    case 'experimental':
      return t('common.states.experimental');
    case 'provider_not_installed':
      return t('transfer.overview.not-installed');
    case 'provider_disabled':
      return t('transfer.overview.disabled');
    case 'provider_version_unsupported':
      return t('transfer.overview.update-required');
    case 'route_unverified':
      return t('transfer.overview.not-verified');
  }
}

function routeSupportLabel(
  routes: readonly SessionTransferCapability['routes'][number][],
  t: (key: string, values?: TranslationValues) => string
): string {
  if (routes.some((route) => route.support === 'supported')) {
    return t('transfer.overview.supported');
  }
  if (routes.some((route) => route.support === 'experimental')) {
    return t('common.states.experimental');
  }
  return t('transfer.overview.not-verified');
}

export function SessionTransferPanel({
  active,
  onImportCompleted,
  providerScan,
  runningSessionIds,
  sessions,
  workspaces
}: SessionTransferPanelProps) {
  const { formatDate, formatTime, t } = useLocalization();
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
      setError(t('transfer.overview.load-error'));
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
      setError(t('transfer.overview.archive-open-error'));
    }
  };

  const refreshHistory = async () => {
    try {
      setHistory(await window.lumora.getTransferHistory());
    } catch {
      setError(t('transfer.overview.history-error'));
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
                <p className="card-label">{t('transfer.overview.eyebrow')}</p>
                <h2>{t('transfer.title')}</h2>
                <p className="card-description">{t('transfer.overview.description')}</p>
              </div>
              <div className="transfer-panel-actions">
                <button
                  className="secondary-button"
                  disabled={loadState !== 'ready'}
                  onClick={() => setMode('export')}
                  type="button"
                >
                  {t('transfer.overview.export')}
                </button>
                <button
                  className="refresh-button"
                  onClick={() => void chooseArchive()}
                  type="button"
                >
                  {t('transfer.overview.import')}
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
                {t('transfer.overview.checking')}
              </div>
            ) : null}

            {loadState === 'ready' ? (
              <div className="transfer-panel-sections">
                <section aria-labelledby="transfer-capabilities-title">
                  <div className="transfer-section-heading">
                    <div>
                      <h3 id="transfer-capabilities-title">{t('transfer.overview.provider-support')}</h3>
                      <p>
                        {hasExperimentalRoutes
                          ? t('transfer.overview.experimental-warning')
                          : t('transfer.overview.unverified-warning')}
                      </p>
                    </div>
                  </div>
                  <div className="transfer-capability-table">
                    <div className="transfer-capability-row transfer-capability-heading">
                      <span>{t('transfer.overview.provider')}</span>
                      <span>{t('transfer.overview.export-column')}</span>
                      <span>{t('transfer.overview.same-os')}</span>
                      <span>{t('transfer.overview.cross-platform')}</span>
                    </div>
                    {capabilities.map((capability) => {
                      const sameOs = routeSupportLabel(
                        capability.routes.filter(
                          (route) =>
                            route.sourcePlatform === route.destinationPlatform &&
                            isUsableTransferSupport(route.support)
                        ), t
                      );
                      const crossPlatform = routeSupportLabel(
                        capability.routes.filter(
                          (route) =>
                            route.sourcePlatform !== route.destinationPlatform &&
                            isUsableTransferSupport(route.support)
                        ), t
                      );
                      return (
                        <div
                          className="transfer-capability-row"
                          key={capability.provider}
                        >
                          <strong>{capability.displayName}</strong>
                          <span>{supportLabel(capability.exportSupport, t)}</span>
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
                      <h3 id="transfer-history-title">{t('transfer.overview.recent')}</h3>
                      <p>{t('transfer.overview.recent-description')}</p>
                    </div>
                  </div>
                  {history.length > 0 ? (
                    <div className="transfer-history-list">
                      {history.map((entry) => (
                        <article key={entry.id}>
                          <div>
                            <strong>
                              {t(entry.direction === 'import'
                                ? 'transfer.overview.imported-provider'
                                : 'transfer.overview.exported-provider', {
                                  providers: entry.providers.join(', ')
                                })}
                            </strong>
                            <span>{t(entry.direction === 'import'
                              ? 'transfer.overview.import-summary'
                              : 'transfer.overview.export-summary', {
                                imported: entry.importedCount,
                                exported: entry.exportedCount,
                                skipped: entry.skippedCount
                              })}</span>
                          </div>
                          <time dateTime={entry.completedAt}>
                            {`${formatDate(new Date(entry.completedAt))} ${formatTime(new Date(entry.completedAt))}`}
                          </time>
                        </article>
                      ))}
                    </div>
                  ) : (
                    <p className="transfer-empty">{t('transfer.overview.empty')}</p>
                  )}
                </section>

                <section
                  aria-labelledby="transfer-guide-title"
                  className="transfer-guidance"
                >
                  <h3 id="transfer-guide-title">{t('transfer.overview.before-importing')}</h3>
                  <p>{t('transfer.overview.before-description')}</p>
                </section>
              </div>
            ) : null}

            {loadState === 'error' ? (
              <button
                className="secondary-button"
                onClick={() => void loadTransferState()}
                type="button"
              >
                {t('transfer.overview.try-again')}
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
