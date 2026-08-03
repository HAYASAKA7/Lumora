import { useState, type ReactNode } from 'react';

import type {
  DeveloperEnvironmentScanResult,
  DeveloperToolStatus
} from '../../../shared/contracts';
import { OverflowTooltip } from '../ui/Tooltip';

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
}

const TOOL_STATE_LABELS: Record<DeveloperToolStatus['state'], string> = {
  ready: 'Detected',
  not_found: 'Not found',
  probe_failed: 'Version check failed'
};

function attentionMessage(scan: DeveloperEnvironmentScanResult): string | null {
  const missing = [
    scan.node.state === 'not_found' ? 'Node.js' : null,
    scan.npm.state === 'not_found' ? 'npm' : null
  ].filter((tool): tool is string => tool !== null);
  const unverifiable = [
    scan.node.state === 'probe_failed' ? 'Node.js' : null,
    scan.npm.state === 'probe_failed' ? 'npm' : null
  ].filter((tool): tool is string => tool !== null);

  if (missing.length === 0 && unverifiable.length === 0) return null;
  if (missing.length === 2) return 'Node.js and npm were not found.';
  if (missing.length === 1 && unverifiable.length === 0) {
    return `${missing[0]} was not found.`;
  }
  if (missing.length === 0 && unverifiable.length === 1) {
    return `${unverifiable[0]} was found, but its version could not be verified.`;
  }
  if (missing.length === 0) {
    return 'Node.js and npm were found, but their versions could not be verified.';
  }
  return `${missing.join(' and ')} was not found, and ${unverifiable.join(
    ' and '
  )} could not be verified.`;
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
  return (
    <div className="developer-environment-actions">
      <button
        className="secondary-button"
        disabled={opening}
        onClick={onClick}
        type="button"
      >
        {opening ? 'Opening download page' : 'Download Node.js'}
      </button>
      {openError ? (
        <p className="developer-environment-open-error">
          The Node.js download page could not be opened.
        </p>
      ) : null}
    </div>
  );
}

export function DeveloperEnvironmentNotice({
  status,
  onOpenNodeDownload
}: EnvironmentComponentProps): ReactNode {
  const { opening, openError, openDownload } = useNodeDownload(
    onOpenNodeDownload
  );

  if (status.state === 'loading') return null;
  if (status.state === 'error') {
    return (
      <section className="developer-environment-warning" role="alert">
        <div>
          <strong>Developer tool check is unavailable</strong>
          <p>Lumora could not check Node.js or npm. Existing features remain available.</p>
        </div>
      </section>
    );
  }

  const message = attentionMessage(status.scan);
  if (message === null) return null;

  return (
    <section className="developer-environment-warning" role="alert">
      <div>
        <strong>{message}</strong>
        <p>
          Install or repair Node.js for the basic tooling used by many AI agent
          CLIs. Lumora will not install it for you.
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
  return (
    <article className={`developer-tool-card developer-tool-${tool.state}`}>
      <header>
        <h3>{displayName}</h3>
        <span className={`developer-tool-state developer-tool-state-${tool.state}`}>
          {TOOL_STATE_LABELS[tool.state]}
        </span>
      </header>
      {tool.state === 'ready' ? (
        <dl className="developer-tool-details">
          <div><dt>Version</dt><dd>{tool.version}</dd></div>
          <div>
            <dt>Executable</dt>
            <OverflowTooltip content={tool.executablePath}>
              <dd className="developer-tool-path">{tool.executablePath}</dd>
            </OverflowTooltip>
          </div>
        </dl>
      ) : tool.state === 'not_found' ? (
        <p>Install Node.js, then refresh.</p>
      ) : (
        <>
          <p>Run {command} --version in a terminal, then refresh.</p>
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
  onRefresh
}: EnvironmentPanelProps): ReactNode {
  const { opening, openError, openDownload } = useNodeDownload(
    onOpenNodeDownload
  );

  return (
    <section className="developer-environment-panel" aria-labelledby="developer-tools-title">
      <div className="developer-environment-panel-header">
        <div>
          <p className="card-label">Local prerequisites</p>
          <h2 id="developer-tools-title">Developer tools</h2>
          <p>Lumora checks the external Node.js and npm available on PATH.</p>
        </div>
        <button
          aria-label="Refresh environment"
          className="refresh-button"
          onClick={onRefresh}
          type="button"
        >
          Refresh
        </button>
      </div>

      {status.state === 'loading' ? (
        <div className="provider-panel-state" role="status">
          <span className="status-dot" aria-hidden="true" />
          Checking Node.js and npm
        </div>
      ) : status.state === 'error' ? (
        <div className="provider-panel-state provider-panel-error" role="alert">
          <span className="status-warning-icon" aria-hidden="true">!</span>
          <div>
            <strong>Developer tool details are unavailable</strong>
            <p>Refresh to check Node.js and npm again.</p>
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
              Last checked{' '}
              <time dateTime={status.scan.checkedAt}>
                {new Date(status.scan.checkedAt).toLocaleString()}
              </time>
            </p>
            {attentionMessage(status.scan) === null ? null : (
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
