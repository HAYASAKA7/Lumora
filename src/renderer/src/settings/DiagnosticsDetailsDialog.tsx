import { useEffect, useId, useRef, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

import type {
  DiagnosticAgentProcesses,
  DiagnosticProcess,
  LumoraApi
} from '../../../shared/contracts';
import { PROVIDER_IDS } from '../../../shared/contracts';
import { providerDefinition } from '../../../shared/provider-definitions';
import { useLocalization } from '../localization/useLocalization';
import { CloseButton } from '../ui/CloseButton';
import { OverflowTooltip } from '../ui/Tooltip';
import { formatBytes } from './diagnostic-format';
import { useDiagnosticProcesses } from './use-diagnostic-sampling';

type FormatNumber = (value: number, options?: Intl.NumberFormatOptions) => string;
type Translate = ReturnType<typeof useLocalization>['t'];

const CPU_FORMAT = { minimumFractionDigits: 1, maximumFractionDigits: 1 } as const;

function providerName(provider: string): string {
  return (PROVIDER_IDS as readonly string[]).includes(provider)
    ? providerDefinition(provider as (typeof PROVIDER_IDS)[number]).displayName
    : provider;
}

function processLabel(process: DiagnosticProcess, t: Translate): string {
  if (process.kind === 'main') return t('settings.diagnostics.details-kind-main');
  if (process.kind === 'renderer') return t('settings.diagnostics.details-kind-renderer');
  if (process.kind === 'gpu') return t('settings.diagnostics.details-kind-gpu');
  if (process.name.length > 0) return process.name;
  return t(process.kind === 'utility'
    ? 'settings.diagnostics.details-kind-utility'
    : 'settings.diagnostics.details-kind-process');
}

function totals(processes: readonly DiagnosticProcess[]) {
  const measuredCpu = processes.filter((process) => process.cpuPercent !== null);
  return {
    memory: processes.reduce((sum, process) => sum + (process.workingSetBytes ?? 0), 0),
    cpu: measuredCpu.length === 0
      ? null
      : measuredCpu.reduce((sum, process) => sum + (process.cpuPercent ?? 0), 0),
    count: processes.length
  };
}

function Summary({ processes, formatNumber, t }: {
  processes: readonly DiagnosticProcess[];
  formatNumber: FormatNumber;
  t: Translate;
}) {
  const { memory, cpu, count } = totals(processes);
  return (
    <span className="diagnostics-details-summary">
      {t('settings.diagnostics.details-summary', {
        memory: formatBytes(memory, formatNumber),
        cpu: cpu === null ? t('settings.diagnostics.measuring') : `${formatNumber(cpu, CPU_FORMAT)}%`,
        count
      })}
    </span>
  );
}

function ProcessTable({ label, processes, formatNumber, t }: {
  label: string;
  processes: readonly DiagnosticProcess[];
  formatNumber: FormatNumber;
  t: Translate;
}) {
  return (
    <div className="diagnostics-process-table-wrap">
      <table aria-label={label} className="diagnostics-process-table">
        <thead>
          <tr>
            <th scope="col">{t('settings.diagnostics.details-column-process')}</th>
            <th scope="col">{t('settings.diagnostics.details-column-pid')}</th>
            <th scope="col">{t('settings.diagnostics.details-column-memory')}</th>
            <th scope="col">{t('settings.diagnostics.details-column-cpu')}</th>
          </tr>
        </thead>
        <tbody>
          {processes.map((process) => (
            <tr key={process.pid}>
              <OverflowTooltip content={processLabel(process, t)}>
                <th
                  scope="row"
                  style={{ '--process-depth': Math.min(process.depth, 8) } as CSSProperties}
                >
                  {processLabel(process, t)}
                </th>
              </OverflowTooltip>
              <td>{process.pid}</td>
              <td>{process.workingSetBytes === null ? '—' : formatBytes(process.workingSetBytes, formatNumber)}</td>
              <td>{process.cpuPercent === null ? '—' : `${formatNumber(process.cpuPercent, CPU_FORMAT)}%`}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AgentSection({ agent, formatNumber, t }: {
  agent: DiagnosticAgentProcesses;
  formatNumber: FormatNumber;
  t: Translate;
}) {
  const heading = `${providerName(agent.provider)} · ${agent.title}`;
  return (
    <article className="diagnostics-details-agent">
      <div className="diagnostics-details-heading">
        <div>
          <OverflowTooltip content={heading}>
            <h4>{heading}</h4>
          </OverflowTooltip>
          <span>
            {t(agent.surface === 'terminal'
              ? 'settings.diagnostics.details-surface-terminal'
              : 'settings.diagnostics.details-surface-unified')}
          </span>
        </div>
        {agent.status === 'measured'
          ? <Summary formatNumber={formatNumber} processes={agent.processes} t={t} />
          : null}
      </div>
      {agent.status === 'measured' ? (
        <ProcessTable formatNumber={formatNumber} label={heading} processes={agent.processes} t={t} />
      ) : (
        <p className="diagnostics-details-note">
          {t(agent.status === 'starting'
            ? 'settings.diagnostics.details-agent-starting'
            : 'settings.diagnostics.details-agent-unavailable')}
        </p>
      )}
    </article>
  );
}

/** Every Lumora process and every running agent's processes, live while open. */
export function DiagnosticsDetailsDialog({ api, onClose }: {
  api: Pick<LumoraApi, 'getDiagnosticProcesses'>;
  onClose(): void;
}): ReactNode {
  const { formatNumber, t } = useLocalization();
  const titleId = useId();
  const dialogRef = useRef<HTMLElement | null>(null);
  const status = useDiagnosticProcesses(api, true);
  const details = status.state === 'ready' ? status.value : null;

  useEffect(() => {
    dialogRef.current?.focus();
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  return createPortal(
    <div className="dialog-backdrop" role="presentation">
      <section
        aria-labelledby={titleId}
        aria-modal="true"
        className="new-session-dialog diagnostics-details-dialog"
        ref={dialogRef}
        role="dialog"
        tabIndex={-1}
      >
        <header>
          <div>
            <p className="card-label">{t('settings.diagnostics.title')}</p>
            <h2 id={titleId}>{t('settings.diagnostics.details-title')}</h2>
          </div>
          <CloseButton onClose={onClose} />
        </header>

        <div className="dialog-body">
          <p className="diagnostics-details-note">{t('settings.diagnostics.details-description')}</p>
          {status.state === 'loading' ? (
            <div className="diagnostics-state" role="status">{t('settings.diagnostics.details-loading')}</div>
          ) : null}
          {status.state === 'error' ? (
            <div className="diagnostics-state diagnostics-state-error" role="alert">
              {t('settings.diagnostics.details-unavailable')}
            </div>
          ) : null}
          {details !== null && !details.processTreeAvailable ? (
            <div className="diagnostics-state diagnostics-state-warning" role="status">
              {t('settings.diagnostics.details-tree-unavailable')}
            </div>
          ) : null}
          {details?.truncated === true ? (
            <div className="diagnostics-state" role="status">{t('settings.diagnostics.details-truncated')}</div>
          ) : null}

          {details !== null ? (
            <>
              <section aria-labelledby={`${titleId}-lumora`} className="diagnostics-details-section">
                <div className="diagnostics-details-heading">
                  <h3 id={`${titleId}-lumora`}>{t('settings.diagnostics.details-lumora')}</h3>
                  <Summary formatNumber={formatNumber} processes={details.lumora} t={t} />
                </div>
                <ProcessTable
                  formatNumber={formatNumber}
                  label={t('settings.diagnostics.details-lumora')}
                  processes={details.lumora}
                  t={t}
                />
              </section>

              <section aria-labelledby={`${titleId}-agents`} className="diagnostics-details-section">
                <div className="diagnostics-details-heading">
                  <h3 id={`${titleId}-agents`}>{t('settings.diagnostics.details-agents')}</h3>
                </div>
                {details.agents.length === 0 ? (
                  <p className="diagnostics-details-note">{t('settings.diagnostics.details-no-agents')}</p>
                ) : details.agents.map((agent) => (
                  <AgentSection agent={agent} formatNumber={formatNumber} key={agent.id} t={t} />
                ))}
              </section>
            </>
          ) : null}
        </div>
      </section>
    </div>,
    document.querySelector('.app-shell') ?? document.body
  );
}
