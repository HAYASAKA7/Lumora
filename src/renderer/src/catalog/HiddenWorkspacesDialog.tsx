import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode
} from 'react';
import { createPortal } from 'react-dom';

import type { HiddenWorkspaceEntry } from './catalog-visibility';
import { OverflowTooltip } from '../ui/Tooltip';

interface HiddenWorkspacesDialogProps {
  busy: boolean;
  entries: readonly HiddenWorkspaceEntry[];
  error: string | null;
  onClose(): void;
  onRestore(workspaceIds: readonly string[]): void;
  onRestoreAll(): void;
}

export function HiddenWorkspacesDialog({
  busy,
  entries,
  error,
  onClose,
  onRestore,
  onRestoreAll
}: HiddenWorkspacesDialogProps): ReactNode {
  const titleId = useId();
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set());
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const visible = useMemo(() => entries.filter(({ workspace }) =>
    normalizedQuery.length === 0 ||
    workspace.displayName.toLocaleLowerCase().includes(normalizedQuery) ||
    workspace.canonicalPath.toLocaleLowerCase().includes(normalizedQuery)
  ), [entries, normalizedQuery]);
  const selectedWorkspaceIds = entries.flatMap(({ workspace }) =>
    selected.has(workspace.id) ? [workspace.id] : []
  );
  const allHiddenSelected = entries.length > 0 && entries.every(({ workspace }) =>
    selected.has(workspace.id)
  );

  useEffect(() => {
    closeRef.current?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || busy) return;
      event.preventDefault();
      onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [busy, onClose]);

  const toggle = (workspaceId: string, checked: boolean) => {
    setSelected((current) => {
      const next = new Set(current);
      if (checked) next.add(workspaceId);
      else next.delete(workspaceId);
      return next;
    });
  };

  return createPortal(
    <div className="dialog-backdrop" role="presentation">
      <section
        aria-labelledby={titleId}
        aria-modal="true"
        className="new-session-dialog hidden-workspaces-dialog"
        role="dialog"
      >
        <header>
          <div>
            <p className="card-label">Workspace visibility</p>
            <h2 id={titleId}>Hidden workspaces</h2>
          </div>
          <button
            aria-label="Close hidden workspaces"
            className="text-button"
            disabled={busy}
            onClick={onClose}
            type="button"
          >
            Close
          </button>
        </header>
        <div className="dialog-body">
          <label className="search-control hidden-workspace-search">
            <span>Search hidden workspaces</span>
            <input
              aria-label="Search hidden workspaces"
              onChange={(event) => setQuery(event.currentTarget.value)}
              placeholder="Search name or path"
              type="search"
              value={query}
            />
          </label>
          {entries.length === 0 ? (
            <div className="catalog-empty hidden-workspace-empty">
              <h3>No hidden workspaces</h3>
              <p>Workspaces you hide will be available here to restore.</p>
            </div>
          ) : (
            <>
              <label className="hidden-workspace-select-all">
                <input
                  aria-label="Select all hidden"
                  checked={allHiddenSelected}
                  disabled={busy || entries.length === 0}
                  onChange={(event) => {
                    const checked = event.currentTarget.checked;
                    setSelected((current) => {
                      const next = new Set(current);
                      for (const { workspace } of entries) {
                        if (checked) next.add(workspace.id);
                        else next.delete(workspace.id);
                      }
                      return next;
                    });
                  }}
                  type="checkbox"
                />
                <span>Select all hidden</span>
              </label>
              <div className="hidden-workspace-list">
                {visible.map(({ workspace, policy }) => (
                  <label className="hidden-workspace-row" key={workspace.id}>
                    <input
                      aria-label={workspace.displayName}
                      checked={selected.has(workspace.id)}
                      disabled={busy}
                      onChange={(event) => toggle(
                        workspace.id,
                        event.currentTarget.checked
                      )}
                      type="checkbox"
                    />
                    <span className="hidden-workspace-copy">
                      <strong>{workspace.displayName}</strong>
                      <OverflowTooltip content={workspace.canonicalPath}>
                        <span>{workspace.canonicalPath}</span>
                      </OverflowTooltip>
                    </span>
                    <span className="availability-badge">
                      {policy.mode === 'workspace_only'
                        ? 'Sessions visible'
                        : 'Sessions hidden'}
                    </span>
                  </label>
                ))}
              </div>
            </>
          )}
          {error === null ? null : <p role="alert" className="general-setting-error">{error}</p>}
        </div>
        <footer className="modal-actions hidden-workspace-actions">
          <button
            className="secondary-button"
            disabled={busy || entries.length === 0}
            onClick={onRestoreAll}
            type="button"
          >
            Restore all
          </button>
          <span className="modal-actions-spacer" />
          <button
            className="secondary-button"
            disabled={busy}
            onClick={onClose}
            ref={closeRef}
            type="button"
          >
            Close
          </button>
          <button
            className="refresh-button"
            disabled={busy || selectedWorkspaceIds.length === 0}
            onClick={() => onRestore(selectedWorkspaceIds)}
            type="button"
          >
            Restore selected
          </button>
        </footer>
      </section>
    </div>,
    document.querySelector('.app-shell') ?? document.body
  );
}
