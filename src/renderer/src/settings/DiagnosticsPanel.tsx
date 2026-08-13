import { useCallback, useEffect, useState } from 'react';

import type { DiagnosticSummary, LumoraApi } from '../../../shared/contracts';

type DiagnosticApi = Pick<
  LumoraApi,
  'getDiagnosticSummary' | 'exportDiagnosticBundle'
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

  const refresh = useCallback(async () => {
    setStatus({ state: 'loading' });
    try {
      setStatus({ state: 'ready', summary: await api.getDiagnosticSummary() });
    } catch {
      setStatus({ state: 'error' });
    }
  }, [api]);

  useEffect(() => {
    if (active && status.state === 'idle') void refresh();
  }, [active, refresh, status.state]);

  const exportDiagnostics = async () => {
    setExporting(true);
    setExportNotice(null);
    try {
      const result = await api.exportDiagnosticBundle();
      if (result.status === 'saved') setExportNotice('Diagnostics saved.');
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
            className="primary-button"
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
