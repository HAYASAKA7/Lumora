import { useCallback, useEffect, useRef, useState } from 'react';

import type {
  DiagnosticStorageSettings,
  DiagnosticSummary,
  LumoraApi
} from '../../../shared/contracts';
import { useRefreshRequest } from '../keyboard/page-requests';
import { useLocalization } from '../localization/useLocalization';
import { IconButton } from '../ui/IconButton';
import { InfoIcon, RefreshIcon } from '../ui/icons';
import { DiagnosticsDetailsDialog } from './DiagnosticsDetailsDialog';
import { DiagnosticsEventsDialog } from './DiagnosticsEventsDialog';
import { formatBytes } from './diagnostic-format';
import { useDiagnosticResources } from './use-diagnostic-sampling';

type DiagnosticApi = Pick<
  LumoraApi,
  | 'getDiagnosticSummary'
  | 'getDiagnosticResources'
  | 'getDiagnosticProcesses'
  | 'exportDiagnosticBundle'
  | 'getDiagnosticStorageSettings'
  | 'chooseDiagnosticJournalDirectory'
  | 'resetDiagnosticJournalDirectory'
  | 'chooseDiagnosticExportDirectory'
  | 'resetDiagnosticExportDirectory'
>;

interface DiagnosticsPanelProps {
  active: boolean;
  api?: DiagnosticApi;
}

/** The page lists the newest few; Event details holds every event the summary carries. */
const EVENTS_ON_PAGE = 10;

type DiagnosticStatus =
  | { state: 'idle' | 'loading' }
  | { state: 'ready'; summary: DiagnosticSummary }
  | { state: 'error' };

export function DiagnosticsPanel({
  active,
  api = window.lumora
}: DiagnosticsPanelProps) {
  const { formatNumber, t } = useLocalization();
  const [status, setStatus] = useState<DiagnosticStatus>({ state: 'idle' });
  const [exporting, setExporting] = useState(false);
  const [exportNotice, setExportNotice] = useState<string | null>(null);
  const [storage, setStorage] = useState<DiagnosticStorageSettings | null>(null);
  const [storageBusy, setStorageBusy] = useState(false);
  const [storageError, setStorageError] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const closeDetails = useCallback(() => setDetailsOpen(false), []);
  const [eventsOpen, setEventsOpen] = useState(false);
  const closeEvents = useCallback(() => setEventsOpen(false), []);
  const refreshGeneration = useRef(0);

  const resourceStatus = useDiagnosticResources(api, active);


  const refresh = useCallback(async () => {
    const generation = ++refreshGeneration.current;
    setStatus({ state: 'loading' });
    try {
      const summary = await api.getDiagnosticSummary();
      if (generation === refreshGeneration.current) {
        setStatus({ state: 'ready', summary });
      }
    } catch {
      if (generation === refreshGeneration.current) {
        setStatus({ state: 'error' });
      }
    }
  }, [api]);

  useEffect(() => {
    if (!active) {
      refreshGeneration.current += 1;
      return;
    }

    let cancelled = false;
    void refresh();
    void api.getDiagnosticStorageSettings().then(
      (settings) => {
        if (!cancelled) setStorage(settings);
      },
      () => {
        if (!cancelled) setStorageError(true);
      }
    );

    return () => {
      cancelled = true;
      refreshGeneration.current += 1;
    };
  }, [active, api, refresh]);

  useRefreshRequest(active && status.state !== 'loading', () => void refresh());

  const updateStorage = async (
    operation: () => Promise<DiagnosticStorageSettings>
  ) => {
    if (storageBusy) return;
    setStorageBusy(true);
    setStorageError(false);
    try {
      setStorage(await operation());
    } catch {
      setStorageError(true);
    } finally {
      setStorageBusy(false);
    }
  };

  const exportDiagnostics = async () => {
    setExporting(true);
    setExportNotice(null);
    try {
      const result = await api.exportDiagnosticBundle();
      if (result.status === 'saved') {
        setExportNotice(t('settings.diagnostics.saved'));
        setStorage(await api.getDiagnosticStorageSettings());
      }
    } catch {
      setExportNotice(t('settings.diagnostics.export-error'));
    } finally {
      setExporting(false);
    }
  };

  const summary = status.state === 'ready' ? status.summary : null;
  const resources = resourceStatus.state === 'ready' ? resourceStatus.value : null;
  const cpuPercent = resources?.lumora.cpuPercent ?? null;

  return (
    <div className="diagnostics-panel">
      <header className="diagnostics-panel-header">
        <div>
          <p className="card-label">{t('settings.diagnostics.eyebrow')}</p>
          <h2>{t('settings.diagnostics.title')}</h2>
          <p>{t('settings.diagnostics.description')}</p>
        </div>
        <div className="diagnostics-panel-actions">
          <IconButton
            label={t('settings.diagnostics.details-title')}
            onClick={() => setDetailsOpen(true)}
          >
            <InfoIcon />
          </IconButton>
          <IconButton
            busy={status.state === 'loading'}
            busyLabel={t('settings.diagnostics.loading')}
            disabled={status.state === 'loading'}
            label={t('settings.diagnostics.refresh')}
            onClick={() => void refresh()}
          >
            <RefreshIcon />
          </IconButton>
          <button
            className="refresh-button"
            disabled={exporting}
            onClick={() => void exportDiagnostics()}
            type="button"
          >
            {t(exporting ? 'settings.diagnostics.exporting' : 'settings.diagnostics.export')}
          </button>
        </div>
      </header>

      {status.state === 'loading' ? (
        <div className="diagnostics-state" role="status">{t('settings.diagnostics.loading')}</div>
      ) : null}
      {status.state === 'error' ? (
        <div className="diagnostics-state diagnostics-state-error" role="alert">
          {t('settings.diagnostics.unavailable')}
        </div>
      ) : null}
      {summary?.previousRunAbnormal ? (
        <div className="diagnostics-state diagnostics-state-warning" role="status">
          <strong>{t('settings.diagnostics.previous-run')}</strong>
          <span>{t('settings.diagnostics.previous-run-description')}</span>
        </div>
      ) : null}
      {exportNotice !== null ? (
        <p className="diagnostics-export-notice" role="status">{exportNotice}</p>
      ) : null}

      {resourceStatus.state === 'error' ? (
        <div className="diagnostics-state diagnostics-state-error" role="alert">
          {t('settings.diagnostics.resources-unavailable')}
        </div>
      ) : null}

      {resources !== null ? (
        <div className="diagnostics-metrics" aria-label={t('settings.diagnostics.current-label')}>
          <article>
            <span>{t('settings.diagnostics.active-agents')}</span>
            <strong>{formatNumber(resources.agents.activeCount)}</strong>
          </article>
          <article>
            <span>{t('settings.diagnostics.working-set')}</span>
            <strong>{formatBytes(resources.lumora.workingSetBytes, formatNumber)}</strong>
          </article>
          <article>
            <span>{t('settings.diagnostics.lumora-cpu')}</span>
            <strong>
              {cpuPercent === null
                ? t('settings.diagnostics.measuring')
                : `${formatNumber(cpuPercent, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`}
            </strong>
          </article>
          <article>
            <span>{t('settings.diagnostics.lumora-processes')}</span>
            <strong>{formatNumber(resources.lumora.processCount)}</strong>
          </article>
        </div>
      ) : null}

      {storage !== null ? (
        <section
          aria-labelledby="diagnostic-storage-title"
          className="diagnostics-storage"
        >
          <div className="diagnostics-events-heading">
            <div>
              <p className="card-label">{t('settings.diagnostics.local-files')}</p>
              <h3 id="diagnostic-storage-title">{t('settings.diagnostics.storage-locations')}</h3>
            </div>
          </div>

          {storage.fallbackActive ? (
            <div className="diagnostics-state diagnostics-state-warning" role="status">
              <strong>{t('settings.diagnostics.fallback-title')}</strong>
              <span>{t('settings.diagnostics.fallback-description')}</span>
            </div>
          ) : null}
          {storageError ? (
            <div className="diagnostics-state diagnostics-state-error" role="alert">
              {t('settings.diagnostics.storage-error')}
            </div>
          ) : null}

          <div className="diagnostics-storage-row">
            <div className="diagnostics-storage-copy">
              <strong>{t('settings.diagnostics.journal-storage')}</strong>
              <code aria-label={t('settings.diagnostics.journal-folder', { path:
                storage.selectedJournalDirectory ?? storage.effectiveJournalDirectory
              })}>
                {storage.selectedJournalDirectory ?? storage.effectiveJournalDirectory}
              </code>
              <span>
                {storage.restartRequired
                  ? t('settings.diagnostics.journal-restart')
                  : t('settings.diagnostics.journal-description')}
              </span>
            </div>
            <div className="diagnostics-storage-actions">
              <button
                className="secondary-button"
                disabled={storageBusy}
                onClick={() => void updateStorage(
                  () => api.chooseDiagnosticJournalDirectory()
                )}
                type="button"
              >
                {t('settings.diagnostics.choose-journal')}
              </button>
              <button
                className="secondary-button"
                disabled={storageBusy || storage.journalUsesDefault}
                onClick={() => void updateStorage(
                  () => api.resetDiagnosticJournalDirectory()
                )}
                type="button"
              >
                {t('settings.diagnostics.restore-journal')}
              </button>
            </div>
          </div>

          <div className="diagnostics-storage-row">
            <div className="diagnostics-storage-copy">
              <strong>{t('settings.diagnostics.export-destination')}</strong>
              <code aria-label={t('settings.diagnostics.export-folder', { path: storage.effectiveExportDirectory })}>
                {storage.effectiveExportDirectory}
              </code>
              <span>{t('settings.diagnostics.export-description')}</span>
            </div>
            <div className="diagnostics-storage-actions">
              <button
                className="secondary-button"
                disabled={storageBusy}
                onClick={() => void updateStorage(
                  () => api.chooseDiagnosticExportDirectory()
                )}
                type="button"
              >
                {t('settings.diagnostics.choose-export')}
              </button>
              <button
                className="secondary-button"
                disabled={storageBusy || storage.exportUsesDefault}
                onClick={() => void updateStorage(
                  () => api.resetDiagnosticExportDirectory()
                )}
                type="button"
              >
                {t('settings.diagnostics.documents-export')}
              </button>
            </div>
          </div>
        </section>
      ) : null}

      {summary !== null ? (
        <>
          <section className="diagnostics-events" aria-labelledby="diagnostic-events-title">
            <div className="diagnostics-events-heading">
              <div>
                <p className="card-label">{t('settings.diagnostics.bounded-journal')}</p>
                <h3 id="diagnostic-events-title">{t('settings.diagnostics.recent-events')}</h3>
              </div>
              <div className="diagnostics-events-heading-actions">
                <span>
                  {t('settings.diagnostics.stored-events', { count: summary.journal.storedEvents })}
                  {summary.journal.invalidRecords > 0
                    ? ` · ${t('settings.diagnostics.invalid-events', { count: summary.journal.invalidRecords })}`
                    : ''}
                </span>
                <IconButton
                  disabled={summary.recentEvents.length === 0}
                  label={t('settings.diagnostics.events-details-title')}
                  onClick={() => setEventsOpen(true)}
                >
                  <InfoIcon />
                </IconButton>
              </div>
            </div>
            {summary.recentEvents.length === 0 ? (
              <p className="diagnostics-events-empty">{t('settings.diagnostics.no-events')}</p>
            ) : (
              <ul>
                {[...summary.recentEvents].reverse().slice(0, EVENTS_ON_PAGE).map((event) => (
                  <li key={event.id}>
                    <div>
                      <strong>{event.subsystem} · {event.operation}</strong>
                      <span>{event.outcome} · {event.targetKind}</span>
                    </div>
                    <code>{event.code ?? event.severity.toUpperCase()}</code>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      ) : null}

      {detailsOpen && active ? (
        <DiagnosticsDetailsDialog api={api} onClose={closeDetails} />
      ) : null}
      {eventsOpen && active && summary !== null ? (
        <DiagnosticsEventsDialog events={summary.recentEvents} onClose={closeEvents} />
      ) : null}
    </div>
  );
}
