import { useState, type ReactNode } from 'react';

import type {
  DeveloperEnvironmentScanResult,
  DeveloperToolStatus
} from '../../../shared/contracts';
import { OverflowTooltip } from '../ui/Tooltip';
import { useLocalization, type TranslationValues } from '../localization/useLocalization';

export type DeveloperEnvironmentStatus =
  | { state: 'loading' }
  | { state: 'ready'; scan: DeveloperEnvironmentScanResult }
  | { state: 'error' };

interface EnvironmentComponentProps {
  status: DeveloperEnvironmentStatus;
  onOpenNodeDownload(): Promise<void>;
}

interface EnvironmentPanelProps extends EnvironmentComponentProps {
  onRefresh(): void;
  refreshing?: boolean;
}

const TOOL_STATE_LABELS: Record<DeveloperToolStatus['state'], string> = {
  ready: 'providers.environment.state-detected',
  not_found: 'providers.environment.state-not-found',
  probe_failed: 'providers.environment.state-probe-failed'
};

function attentionMessage(
  scan: DeveloperEnvironmentScanResult,
  t: (key: string, values?: TranslationValues) => string
): string | null {
  const missing = [
    scan.node.state === 'not_found' ? 'Node.js' : null,
    scan.npm.state === 'not_found' ? 'npm' : null
  ].filter((tool): tool is string => tool !== null);
  const unverifiable = [
    scan.node.state === 'probe_failed' ? 'Node.js' : null,
    scan.npm.state === 'probe_failed' ? 'npm' : null
  ].filter((tool): tool is string => tool !== null);

  if (missing.length === 0 && unverifiable.length === 0) return null;
  if (missing.length === 2) return t('providers.environment.missing-both');
  if (missing.length === 1 && unverifiable.length === 0) {
    return t('providers.environment.missing-one', { tool: missing[0] });
  }
  if (missing.length === 0 && unverifiable.length === 1) {
    return t('providers.environment.unverified-one', { tool: unverifiable[0] });
  }
  if (missing.length === 0) {
    return t('providers.environment.unverified-both');
  }
  return t('providers.environment.mixed-attention', {
    missing: missing.join(' and '),
    unverified: unverifiable.join(' and ')
  });
}

function useNodeDownload(onOpenNodeDownload: () => Promise<void>) {
  const [opening, setOpening] = useState(false);
  const [openError, setOpenError] = useState(false);

  const openDownload = () => {
    setOpening(true);
    setOpenError(false);
    void onOpenNodeDownload().then(
      () => setOpening(false),
      () => {
        setOpening(false);
        setOpenError(true);
      }
    );
  };

  return { opening, openError, openDownload };
}

function DownloadAction({
  opening,
  openError,
  onClick
}: {
  opening: boolean;
  openError: boolean;
  onClick(): void;
}): ReactNode {
  const { t } = useLocalization();
  return (
    <div className="developer-environment-actions">
      <button
        className="secondary-button"
        disabled={opening}
        onClick={onClick}
        type="button"
      >
        {t(opening ? 'providers.environment.opening-download' : 'providers.environment.download-node')}
      </button>
      {openError ? (
        <p className="developer-environment-open-error">
          {t('providers.environment.download-error')}
        </p>
      ) : null}
    </div>
  );
}

export function DeveloperEnvironmentNotice({
  status,
  onOpenNodeDownload
}: EnvironmentComponentProps): ReactNode {
  const { t } = useLocalization();
  const { opening, openError, openDownload } = useNodeDownload(
    onOpenNodeDownload
  );

  if (status.state === 'loading') return null;
  if (status.state === 'error') {
    return (
      <section className="developer-environment-warning" role="alert">
        <div>
          <strong>{t('providers.environment.check-unavailable')}</strong>
          <p>{t('providers.environment.check-unavailable-description')}</p>
        </div>
      </section>
    );
  }

  const message = attentionMessage(status.scan, t);
  if (message === null) return null;

  return (
    <section className="developer-environment-warning" role="alert">
      <div>
        <strong>{message}</strong>
        <p>
          {t('providers.environment.attention-description')}
        </p>
      </div>
      <DownloadAction
        onClick={openDownload}
        openError={openError}
        opening={opening}
      />
    </section>
  );
}

function DeveloperToolCard({
  displayName,
  command,
  tool
}: {
  displayName: string;
  command: 'node' | 'npm';
  tool: DeveloperToolStatus;
}): ReactNode {
  const { t } = useLocalization();
  return (
    <article className={`developer-tool-card developer-tool-${tool.state}`}>
      <header>
        <h3>{displayName}</h3>
        <span className={`developer-tool-state developer-tool-state-${tool.state}`}>
          {t(TOOL_STATE_LABELS[tool.state])}
        </span>
      </header>
      {tool.state === 'ready' ? (
        <dl className="developer-tool-details">
          <div><dt>{t('providers.environment.version')}</dt><dd>{tool.version}</dd></div>
          <div>
            <dt>{t('providers.environment.executable')}</dt>
            <OverflowTooltip content={tool.executablePath}>
              <dd className="developer-tool-path">{tool.executablePath}</dd>
            </OverflowTooltip>
          </div>
        </dl>
      ) : tool.state === 'not_found' ? (
        <p>{t('providers.environment.install-refresh')}</p>
      ) : (
        <>
          <p>{t('providers.environment.verify-command', { command })}</p>
          <OverflowTooltip content={tool.executablePath}>
            <p className="developer-tool-path">{tool.executablePath}</p>
          </OverflowTooltip>
        </>
      )}
    </article>
  );
}

export function DeveloperEnvironmentPanel({
  status,
  onOpenNodeDownload,
  onRefresh,
  refreshing = false
}: EnvironmentPanelProps): ReactNode {
  const { formatDate, formatTime, t } = useLocalization();
  const { opening, openError, openDownload } = useNodeDownload(
    onOpenNodeDownload
  );

  return (
    <section className="developer-environment-panel" aria-labelledby="developer-tools-title">
      <div className="developer-environment-panel-header">
        <div>
          <p className="card-label">{t('providers.environment.eyebrow')}</p>
          <h2 id="developer-tools-title">{t('providers.environment.tools-title')}</h2>
          <p>{t('providers.environment.tools-description')}</p>
        </div>
        <button
          aria-label={t('providers.environment.refresh-label')}
          className="refresh-button"
          onClick={onRefresh}
          type="button"
        >
          {t(refreshing ? 'providers.environment.refreshing' : 'providers.environment.refresh')}
        </button>
      </div>

      {status.state === 'loading' ? (
        <div className="provider-panel-state" role="status">
          <span className="status-dot" aria-hidden="true" />
          {t('providers.environment.checking')}
        </div>
      ) : status.state === 'error' ? (
        <div className="provider-panel-state provider-panel-error" role="alert">
          <span className="status-warning-icon" aria-hidden="true">!</span>
          <div>
            <strong>{t('providers.environment.details-unavailable')}</strong>
            <p>{t('providers.environment.retry')}</p>
          </div>
        </div>
      ) : (
        <>
          <div className="developer-tool-grid">
            <DeveloperToolCard
              command="node"
              displayName="Node.js"
              tool={status.scan.node}
            />
            <DeveloperToolCard
              command="npm"
              displayName="npm"
              tool={status.scan.npm}
            />
          </div>
          <div className="developer-environment-footer">
            <p>
              <time dateTime={status.scan.checkedAt}>
                {t('providers.environment.last-checked', { date: `${formatDate(new Date(status.scan.checkedAt))} ${formatTime(new Date(status.scan.checkedAt))}` })}
              </time>
            </p>
            {attentionMessage(status.scan, t) === null ? null : (
              <DownloadAction
                onClick={openDownload}
                openError={openError}
                opening={opening}
              />
            )}
          </div>
        </>
      )}
    </section>
  );
}
