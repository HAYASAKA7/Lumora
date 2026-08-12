import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

import type {
  WorkspaceSummary,
  WorkspaceVisibilityMode
} from '../../../shared/contracts';
import { SelectMenu } from '../ui/SelectMenu';
import { OverflowTooltip } from '../ui/Tooltip';

interface HideWorkspaceDialogProps {
  busy: boolean;
  error: string | null;
  workspace: WorkspaceSummary;
  onClose(): void;
  onHide(mode: WorkspaceVisibilityMode): void;
}

export function HideWorkspaceDialog({
  busy,
  error,
  workspace,
  onClose,
  onHide
}: HideWorkspaceDialogProps): ReactNode {
  const titleId = useId();
  const cancelRef = useRef<HTMLButtonElement | null>(null);
  const [mode, setMode] = useState<WorkspaceVisibilityMode>('workspace_only');

  useEffect(() => {
    cancelRef.current?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || busy) return;
      event.preventDefault();
      onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [busy, onClose]);

  return createPortal(
    <div className="dialog-backdrop" role="presentation">
      <section
        aria-labelledby={titleId}
        aria-modal="true"
        className="new-session-dialog workspace-visibility-dialog"
        role="dialog"
      >
        <header>
          <div>
            <p className="card-label">Workspace visibility</p>
            <h2 id={titleId}>Hide {workspace.displayName}</h2>
          </div>
          <button
            aria-label="Close workspace visibility"
            className="text-button"
            disabled={busy}
            onClick={onClose}
            type="button"
          >
            Close
          </button>
        </header>
        <div className="dialog-body">
          <div className="workspace-visibility-summary">
            <strong>{workspace.displayName}</strong>
            <OverflowTooltip content={workspace.canonicalPath}>
              <span>{workspace.canonicalPath}</span>
            </OverflowTooltip>
          </div>
          <div className="workspace-visibility-field">
            <span>
              <strong>Session visibility</strong>
              <small>
                Choose whether sessions remain available outside the Workspaces page.
              </small>
            </span>
            <SelectMenu
              disabled={busy}
              label="Session visibility"
              onChange={(value) => setMode(value as WorkspaceVisibilityMode)}
              options={[
                {
                  value: 'workspace_only',
                  label: 'Hide workspace only'
                },
                {
                  value: 'workspace_and_sessions',
                  label: 'Hide workspace and its sessions'
                }
              ]}
              value={mode}
            />
          </div>
          <p className="workspace-visibility-note">
            Nothing is deleted from this computer or from the provider.
          </p>
          {error === null ? null : <p role="alert" className="general-setting-error">{error}</p>}
        </div>
        <footer className="modal-actions">
          <button
            className="secondary-button"
            disabled={busy}
            onClick={onClose}
            ref={cancelRef}
            type="button"
          >
            Cancel
          </button>
          <button
            className="refresh-button"
            disabled={busy}
            onClick={() => onHide(mode)}
            type="button"
          >
            {busy ? 'Hiding workspace' : 'Hide workspace'}
          </button>
        </footer>
      </section>
    </div>,
    document.querySelector('.app-shell') ?? document.body
  );
}
