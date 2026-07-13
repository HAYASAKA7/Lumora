import type { ReactNode } from 'react';

import type {
  LaunchPreview,
  RuntimeSummary,
  WorkspaceSummary
} from '../../../shared/contracts';
import { LaunchConfiguration } from './LaunchConfiguration';

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

interface TerminalDetailsDialogProps {
  runtime: RuntimeSummary;
  preview: LaunchPreview | undefined;
  workspace: WorkspaceSummary | undefined;
  onClose(): void;
}

export function TerminalDetailsDialog({
  runtime,
  preview,
  workspace,
  onClose
}: TerminalDetailsDialogProps): ReactNode {
  return (
    <div className="dialog-backdrop" role="presentation">
      <section
        aria-labelledby="terminal-details-title"
        aria-modal="true"
        className="new-session-dialog terminal-details-dialog"
        role="dialog"
      >
        <header>
          <div>
            <p className="card-label">Runtime and launch metadata</p>
            <h2 id="terminal-details-title">Terminal details</h2>
          </div>
          <button
            aria-label="Close terminal details"
            className="text-button"
            onClick={onClose}
            type="button"
          >
            Close
          </button>
        </header>

        <aside aria-label="Launch inspector" className="terminal-inspector">
          <dl>
            <div><dt>Provider</dt><dd>{runtime.provider}</dd></div>
            <div><dt>Process</dt><dd>{runtime.pid ?? 'Not live'}</dd></div>
            <div><dt>Executable</dt><dd>{preview?.executablePath ?? 'Saved runtime'}</dd></div>
            <div><dt>Working directory</dt><dd>{preview?.workingDirectory ?? workspace?.canonicalPath ?? 'Unavailable'}</dd></div>
            <div><dt>Launch type</dt><dd>{runtime.strategy === 'resume' ? 'Resume' : 'New session'}</dd></div>
            <div><dt>Identity match</dt><dd>{IDENTITY_MATCH_LABELS[runtime.reconciliationState]}</dd></div>
            <div><dt>Session</dt><dd>{runtime.sessionId?.slice(0, 12) ?? 'Not linked'}</dd></div>
            <div><dt>Launch hash</dt><dd>{runtime.launchHash.slice(0, 16)}</dd></div>
          </dl>
          {preview === undefined ? null : (
            <LaunchConfiguration preview={preview} />
          )}
        </aside>
      </section>
    </div>
  );
}
