import { useCallback, useEffect, useState } from 'react';

import type {
  DiagnosticStorageSettings,
  DiagnosticSummary,
  LumoraApi
} from '../../../shared/contracts';

type DiagnosticApi = Pick<
  LumoraApi,
  | 'getDiagnosticSummary'
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

type DiagnosticStatus =
  | { state: 'idle' | 'loading' }
  | { state: 'ready'; summary: DiagnosticSummary }
  | { state: 'error' };

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  if (bytes < 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

export function DiagnosticsPanel({
  active,
  api = window.lumora
}: DiagnosticsPanelProps) {
  const [status, setStatus] = useState<DiagnosticStatus>({ state: 'idle' });
  const [exporting, setExporting] = useState(false);
  const [exportNotice, setExportNotice] = useState<string | null>(null);
  const [storage, setStorage] = useState<DiagnosticStorageSettings | null>(null);
  const [storageBusy, setStorageBusy] = useState(false);
  const [storageError, setStorageError] = useState(false);

  const refresh = useCallback(async () => {
    setStatus({ state: 'loading' });
    try {
      setStatus({ state: 'ready', summary: await api.getDiagnosticSummary() });
    } catch {
      setStatus({ state: 'error' });
    }
  }, [api]);

  useEffect(() => {
    if (!active || status.state !== 'idle') return;
    void refresh();
    void api.getDiagnosticStorageSettings().then(
      (settings) => setStorage(settings),
      () => setStorageError(true)
    );
  }, [active, api, refresh, status.state]);

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
        setExportNotice('Diagnostics saved.');
        setStorage(await api.getDiagnosticStorageSettings());
      }
    } catch {
      setExportNotice('Diagnostics could not be exported.');
    } finally {
      setExporting(false);
    }
  };

  const summary = status.state === 'ready' ? status.summary : null;

  return (
    <div className="diagnostics-panel">
      <header className="diagnostics-panel-header">
        <div>
          <p className="card-label">Local health</p>
          <h2>Diagnostics</h2>
          <p>
            Review bounded performance and lifecycle signals. Terminal content,
            prompts, paths, and environment values are never included.
          </p>
        </div>
        <div className="diagnostics-panel-actions">
          <button
            className="secondary-button"
            disabled={status.state === 'loading'}
            onClick={() => void refresh()}
            type="button"
          >
            Refresh diagnostics
          </button>
          <button
            className="refresh-button"
            disabled={exporting}
            onClick={() => void exportDiagnostics()}
            type="button"
          >
            {exporting ? 'Exporting…' : 'Export diagnostics'}
          </button>
        </div>
      </header>

      {status.state === 'loading' ? (
        <div className="diagnostics-state" role="status">Loading diagnostics…</div>
      ) : null}
      {status.state === 'error' ? (
        <div className="diagnostics-state diagnostics-state-error" role="alert">
          Diagnostics are temporarily unavailable. Refresh to try again.
        </div>
      ) : null}
      {summary?.previousRunAbnormal ? (
        <div className="diagnostics-state diagnostics-state-warning" role="status">
          <strong>Previous run ended unexpectedly</strong>
          <span>Its final lifecycle event may help identify the cause.</span>
        </div>
      ) : null}
      {exportNotice !== null ? (
        <p className="diagnostics-export-notice" role="status">{exportNotice}</p>
      ) : null}

      {storage !== null ? (
        <section
          aria-labelledby="diagnostic-storage-title"
          className="diagnostics-storage"
        >
          <div className="diagnostics-events-heading">
            <div>
              <p className="card-label">Local files</p>
              <h3 id="diagnostic-storage-title">Storage locations</h3>
            </div>
          </div>

          {storage.fallbackActive ? (
            <div className="diagnostics-state diagnostics-state-warning" role="status">
              <strong>Using the default journal folder for this run</strong>
              <span>Check the selected folder, then restart Lumora to try it again.</span>
            </div>
          ) : null}
          {storageError ? (
            <div className="diagnostics-state diagnostics-state-error" role="alert">
              Lumora could not update the diagnostic storage location.
            </div>
          ) : null}

          <div className="diagnostics-storage-row">
            <div className="diagnostics-storage-copy">
              <strong>Journal storage</strong>
              <code aria-label={`Journal folder: ${
                storage.selectedJournalDirectory ?? storage.effectiveJournalDirectory
              }`}>
                {storage.selectedJournalDirectory ?? storage.effectiveJournalDirectory}
              </code>
              <span>
                {storage.restartRequired
                  ? 'Restart Lumora to use this journal folder.'
                  : 'Bounded lifecycle and performance events are stored here.'}
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
                Choose journal folder
              </button>
              <button
                className="secondary-button"
                disabled={storageBusy || storage.journalUsesDefault}
                onClick={() => void updateStorage(
                  () => api.resetDiagnosticJournalDirectory()
                )}
                type="button"
              >
                Restore default journal folder
              </button>
            </div>
          </div>

          <div className="diagnostics-storage-row">
            <div className="diagnostics-storage-copy">
              <strong>Export destination</strong>
              <code aria-label={`Export folder: ${storage.effectiveExportDirectory}`}>
                {storage.effectiveExportDirectory}
              </code>
              <span>New diagnostic export dialogs start in this folder.</span>
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
                Choose export folder
              </button>
              <button
                className="secondary-button"
                disabled={storageBusy || storage.exportUsesDefault}
                onClick={() => void updateStorage(
                  () => api.resetDiagnosticExportDirectory()
                )}
                type="button"
              >
                Use Documents for exports
              </button>
            </div>
          </div>
        </section>
      ) : null}

      {summary !== null ? (
        <>
          <div className="diagnostics-metrics" aria-label="Current process metrics">
            <article>
              <span>Memory</span>
              <strong>{formatBytes(summary.processes.workingSetBytes)}</strong>
            </article>
            <article>
              <span>Processes</span>
              <strong>{summary.processes.processCount}</strong>
            </article>
            <article>
              <span>CPU</span>
              <strong>{summary.processes.cpuPercent.toFixed(1)}%</strong>
            </article>
            <article>
              <span>Stored events</span>
              <strong>{summary.journal.storedEvents}</strong>
            </article>
          </div>

          <section className="diagnostics-events" aria-labelledby="diagnostic-events-title">
            <div className="diagnostics-events-heading">
              <div>
                <p className="card-label">Bounded journal</p>
                <h3 id="diagnostic-events-title">Recent events</h3>
              </div>
              {summary.journal.invalidRecords > 0 ? (
                <span>{summary.journal.invalidRecords} invalid ignored</span>
              ) : null}
            </div>
            {summary.recentEvents.length === 0 ? (
              <p className="diagnostics-events-empty">No diagnostic events recorded.</p>
            ) : (
              <ul>
                {[...summary.recentEvents].reverse().map((event) => (
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
    </div>
  );
}
