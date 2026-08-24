import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

import type {
  WorkspaceSummary,
  WorkspaceVisibilityMode
} from '../../../shared/contracts';
import { SelectMenu } from '../ui/SelectMenu';
import { OverflowTooltip } from '../ui/Tooltip';
import { useLocalization } from '../localization/useLocalization';

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
  const { t } = useLocalization();
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
            <p className="card-label">{t('catalog.workspaces.visibility-label')}</p>
            <h2 id={titleId}>{t('catalog.workspaces.hide-title', { workspace: workspace.displayName })}</h2>
          </div>
          <button
            aria-label={t('catalog.workspaces.close-visibility-label')}
            className="text-button"
            disabled={busy}
            onClick={onClose}
            type="button"
          >
            {t('common.actions.close')}
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
              <strong>{t('catalog.workspaces.session-visibility')}</strong>
              <small>
                {t('catalog.workspaces.session-visibility-description')}
              </small>
            </span>
            <SelectMenu
              disabled={busy}
              label={t('catalog.workspaces.session-visibility')}
              onChange={(value) => setMode(value as WorkspaceVisibilityMode)}
              options={[
                {
                  value: 'workspace_only',
                  label: t('catalog.workspaces.hide-workspace-only')
                },
                {
                  value: 'workspace_and_sessions',
                  label: t('catalog.workspaces.hide-workspace-sessions')
                }
              ]}
              value={mode}
            />
          </div>
          <p className="workspace-visibility-note">
            {t('catalog.workspaces.hide-note')}
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
            {t('common.actions.cancel')}
          </button>
          <button
            className="refresh-button"
            disabled={busy}
            onClick={() => onHide(mode)}
            type="button"
          >
            {t(busy ? 'catalog.workspaces.hiding' : 'catalog.workspaces.hide-action')}
          </button>
        </footer>
      </section>
    </div>,
    document.querySelector('.app-shell') ?? document.body
  );
}
