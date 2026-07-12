import { useState, type ReactNode } from 'react';

import type {
  LaunchPreview,
  RuntimeSummary,
  WorkspaceSummary
} from '../../../shared/contracts';
import { ManagedTerminal } from './ManagedTerminal';

interface TerminalWorkspaceProps {
  runtimes: readonly RuntimeSummary[];
  activeRuntimeId: string;
  previews: ReadonlyMap<string, LaunchPreview>;
  workspaces: readonly WorkspaceSummary[];
  onActivate(runtimeId: string): void;
  onClose(runtimeId: string): void;
  onRuntimeChange(runtime: RuntimeSummary): void;
}

const IDENTITY_MATCH_LABELS: Record<
  RuntimeSummary['reconciliationState'],
  string
> = {
  not_required: 'Native resume',
  pending: 'Matching provider session',
  linked: 'Linked',
  ambiguous: 'Ambiguous — not linked',
  unresolved: 'Not found — unlinked'
};

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
          <button className="secondary-button" disabled={!isLive || stopping} onClick={stop} type="button">
            {stopping ? 'Stopping' : 'Stop'}
          </button>
          <button className="secondary-button" onClick={() => onClose(runtime.id)} type="button">Close tab</button>
        </div>
      </header>

      <div className="terminal-grid">
        <ManagedTerminal runtime={runtime} onRuntimeChange={onRuntimeChange} />
        <aside className="terminal-inspector" aria-label="Launch inspector">
          <p className="card-label">Effective launch</p>
          <dl>
            <div><dt>Provider</dt><dd>{runtime.provider}</dd></div>
            <div><dt>Process</dt><dd>{runtime.pid ?? 'Not live'}</dd></div>
            {preview?.command == null ? null : (
              <div><dt>Start command</dt><dd>{preview.command}</dd></div>
            )}
            <div><dt>Executable</dt><dd>{preview?.executablePath ?? 'Saved runtime'}</dd></div>
            <div><dt>Working directory</dt><dd>{preview?.workingDirectory ?? workspace?.canonicalPath ?? 'Unavailable'}</dd></div>
            <div><dt>Profile</dt><dd>{preview?.terminalProfile.name ?? runtime.terminalProfileId.slice(0, 12)}</dd></div>
            <div><dt>Launch type</dt><dd>{runtime.strategy === 'resume' ? 'Resume' : 'New session'}</dd></div>
            <div><dt>Identity match</dt><dd>{IDENTITY_MATCH_LABELS[runtime.reconciliationState]}</dd></div>
            <div><dt>Session</dt><dd>{runtime.sessionId?.slice(0, 12) ?? 'Not linked'}</dd></div>
            <div><dt>Launch hash</dt><dd>{runtime.launchHash.slice(0, 16)}</dd></div>
          </dl>
        </aside>
      </div>
    </section>
  );
}
