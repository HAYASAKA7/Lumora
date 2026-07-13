import { useState, type ReactNode } from 'react';

import type {
  LaunchPreview,
  RuntimeSummary,
  WorkspaceSummary
} from '../../../shared/contracts';
import { ManagedTerminal } from './ManagedTerminal';
import { TerminalDetailsDialog } from './TerminalDetailsDialog';

interface TerminalWorkspaceProps {
  runtimes: readonly RuntimeSummary[];
  activeRuntimeId: string;
  previews: ReadonlyMap<string, LaunchPreview>;
  workspaces: readonly WorkspaceSummary[];
  onActivate(runtimeId: string): void;
  onClose(runtimeId: string): void;
  onRuntimeChange(runtime: RuntimeSummary): void;
}

export function TerminalWorkspace({
  runtimes,
  activeRuntimeId,
  previews,
  workspaces,
  onActivate,
  onClose,
  onRuntimeChange
}: TerminalWorkspaceProps): ReactNode {
  const [stopping, setStopping] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const runtime = runtimes.find((item) => item.id === activeRuntimeId) ?? runtimes[0];
  if (runtime === undefined) return null;
  const preview = previews.get(runtime.id);
  const workspace = workspaces.find((item) => item.id === runtime.workspaceId);
  const isLive = runtime.state === 'launching' || runtime.state === 'running';

  const stop = () => {
    setStopping(true);
    void window.lumora.terminateRuntime(runtime.id).then(
      (value) => { onRuntimeChange(value); setStopping(false); },
      () => setStopping(false)
    );
  };

  return (
    <section className="terminal-workspace" aria-label="Managed terminals">
      <div className="terminal-tabbar" role="tablist" aria-label="Terminal tabs">
        {runtimes.map((item) => (
          <button
            aria-selected={item.id === runtime.id}
            className="terminal-tab"
            key={item.id}
            onClick={() => onActivate(item.id)}
            role="tab"
            type="button"
          >
            <span>{item.provider === 'codex' ? 'Codex' : 'Claude Code'}</span>
            <small>{item.state}</small>
          </button>
        ))}
      </div>

      <header className="terminal-header">
        <div>
          <p className="card-label">{workspace?.displayName ?? 'Workspace'}</p>
          <h2>{runtime.provider === 'codex' ? 'Codex' : 'Claude Code'} terminal</h2>
        </div>
        <div className="catalog-actions">
          <span className={`runtime-state runtime-${runtime.state}`}>{runtime.state}</span>
          <button
            className="secondary-button"
            onClick={() => setDetailsOpen(true)}
            type="button"
          >
            Terminal details
          </button>
          <button className="secondary-button" disabled={!isLive || stopping} onClick={stop} type="button">
            {stopping ? 'Stopping' : 'Stop'}
          </button>
          <button className="secondary-button" onClick={() => onClose(runtime.id)} type="button">Close tab</button>
        </div>
      </header>

      <div className="terminal-grid">
        <ManagedTerminal runtime={runtime} onRuntimeChange={onRuntimeChange} />
      </div>

      {detailsOpen ? (
        <TerminalDetailsDialog
          onClose={() => setDetailsOpen(false)}
          preview={preview}
          runtime={runtime}
          workspace={workspace}
        />
      ) : null}
    </section>
  );
}
