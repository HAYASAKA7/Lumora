import { useCallback, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';

import type { ChangedFile, ChangesSource, ChangesSummary } from '../../../shared/contracts';
import { useLocalization } from '../localization/useLocalization';
import type { ActionMenuItem } from '../ui/ActionMenu';
import { IconButton } from '../ui/IconButton';
import { RefreshIcon } from '../ui/icons';
import { CHANGES_PAGE_SIZE, ChangesFileGroup } from './ChangesFileGroup';
import type { ChangesFileAction, ChangesFileNavigation, ChangesFileRowHandlers } from './ChangesFileRow';
import { ChangesModeSwitch } from './ChangesModeSwitch';
import { ChangesDiff, ChangesNotices } from './ChangesStatus';
import { useWorkspaceChanges, type ChangesApi, type Load } from './useWorkspaceChanges';

/** The view places the file list beside the diff from this width on. */
const WIDE_LAYOUT_MIN_WIDTH = 720;

interface ChangesViewProps {
  api: ChangesApi;
  source: ChangesSource;
  active: boolean;
  onSourceChange?(source: ChangesSource): void;
  /** Replaces the session view switch; receives the loaded summary's workspace id. */
  toolbarStart?(workspaceId: string | null): ReactNode;
}

function useIsWide(root: RefObject<HTMLDivElement | null>): boolean {
  const [wide, setWide] = useState(false);
  useLayoutEffect(() => {
    const node = root.current;
    if (node === null) return undefined;
    setWide(node.getBoundingClientRect().width >= WIDE_LAYOUT_MIN_WIDTH);
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[entries.length - 1];
      if (entry !== undefined) setWide(entry.contentRect.width >= WIDE_LAYOUT_MIN_WIDTH);
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [root]);
  return wide;
}

function emptyKey(source: ChangesSource): string {
  if (source.kind === 'review') return 'terminal.changes.empty-review';
  if (source.kind === 'session' && source.view === 'session') return 'terminal.changes.empty';
  return 'terminal.changes.empty-uncommitted';
}

function navigationTarget(files: readonly ChangedFile[], path: string, key: ChangesFileNavigation): ChangedFile | undefined {
  const index = files.findIndex((file) => file.path === path);
  if (index < 0) return undefined;
  if (key === 'Home') return files[0];
  if (key === 'End') return files[files.length - 1];
  return files[Math.min(files.length - 1, Math.max(0, index + (key === 'ArrowDown' ? 1 : -1)))];
}

const FIRST_PAGE = { files: CHANGES_PAGE_SIZE, committed: CHANGES_PAGE_SIZE };

export function ChangesView({ active, api, onSourceChange, source, toolbarStart }: ChangesViewProps): ReactNode {
  const { t } = useLocalization();
  const { diff, markReviewed, refreshing, reload, selectedPath, setSelectedPath, summary } =
    useWorkspaceChanges(api, source, active);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const wide = useIsWide(rootRef);
  const reviewable = source.kind === 'session' && source.view === 'session';
  const sourceKey = JSON.stringify(source);

  const [actionFailed, setActionFailed] = useState(false);
  const [markingAll, setMarkingAll] = useState(false);
  const [pages, setPages] = useState(FIRST_PAGE);
  const [committedOpen, setCommittedOpen] = useState(false);
  const [seen, setSeen] = useState<{ summary: Load<ChangesSummary>; sourceKey: string }>({ summary, sourceKey });
  if (seen.summary !== summary || seen.sourceKey !== sourceKey) {
    // A new summary replaces whatever a failed action said about the old one.
    setSeen({ summary, sourceKey });
    setActionFailed(false);
    if (seen.sourceKey !== sourceKey) setPages(FIRST_PAGE);
  }

  const value = summary.state === 'ready' ? summary.value : null;
  const latest = useRef({ api, source, markReviewed, value, pages });
  latest.current = { api, source, markReviewed, value, pages };
  const buttons = useRef(new Map<string, HTMLButtonElement>());
  const markingAllRef = useRef(false);

  const attempt = useCallback((work: () => Promise<void>) => {
    setActionFailed(false);
    work().catch(() => setActionFailed(true));
  }, []);

  const handlers = useMemo<ChangesFileRowHandlers>(() => ({
    onSelect: (path) => setSelectedPath(path),
    onNavigate: (path, key) => {
      const current = latest.current;
      if (current.value === null) return;
      const inFiles = current.value.files.some((file) => file.path === path);
      const group = inFiles ? current.value.files : current.value.committed;
      const visible = group.slice(0, inFiles ? current.pages.files : current.pages.committed);
      const target = navigationTarget(visible, path, key);
      if (target === undefined) return;
      setSelectedPath(target.path);
      buttons.current.get(target.path)?.focus();
    },
    onAction: (path, action) => {
      const current = latest.current;
      if (action === 'mark-reviewed') attempt(() => current.markReviewed([path]));
      else if (action === 'copy-path') attempt(() => current.api.writeClipboardText(path));
      else attempt(() => current.api.openChangedFile(current.source, path, action === 'open-file' ? 'open' : 'reveal'));
    },
    registerButton: (path, node) => {
      if (node === null) buttons.current.delete(path);
      else buttons.current.set(path, node);
    }
  }), [attempt, setSelectedPath]);

  const markAll = () => {
    const current = latest.current;
    if (markingAllRef.current || current.value === null) return;
    markingAllRef.current = true;
    setMarkingAll(true);
    setActionFailed(false);
    current.markReviewed(current.value.files.map((file) => file.path))
      .catch(() => setActionFailed(true))
      .finally(() => {
        markingAllRef.current = false;
        setMarkingAll(false);
      });
  };

  const fileMenu = useMemo<ActionMenuItem<ChangesFileAction>[]>(() => [
    ...(reviewable ? [{ id: 'mark-reviewed' as const, label: t('terminal.changes.mark-reviewed') }] : []),
    { id: 'open-file', label: t('terminal.changes.open-file') },
    { id: 'reveal-file', label: t('terminal.changes.reveal-file') },
    { id: 'copy-path', label: t('terminal.changes.copy-path') }
  ], [reviewable, t]);
  const committedMenu = useMemo(() => fileMenu.filter((item) => item.id !== 'mark-reviewed'), [fileMenu]);

  const listed = value !== null && value.state !== 'unavailable';
  const selectedFile = !listed || selectedPath === null
    ? null
    : value.files.find((file) => file.path === selectedPath) ??
      value.committed.find((file) => file.path === selectedPath) ?? null;

  return (
    <div className={`changes-view${wide ? ' is-wide' : ''}`} ref={rootRef}>
      <div className="changes-toolbar">
        {toolbarStart !== undefined ? toolbarStart(value?.workspaceId ?? null) : source.kind === 'session' ? (
          <ChangesModeSwitch
            onSelect={(view) => onSourceChange?.({ ...source, view })}
            options={(['session', 'uncommitted'] as const).map((view) => ({
              id: view,
              label: t(`terminal.changes.view-${view}`)
            }))}
            selected={source.view}
          />
        ) : <span />}
        <div className="changes-toolbar-actions">
          {reviewable ? (
            <button
              className="secondary-button"
              disabled={markingAll || value === null || value.files.length === 0}
              onClick={markAll}
              type="button"
            >
              {t('terminal.changes.mark-all-reviewed')}
            </button>
          ) : null}
          <IconButton
            busy={refreshing}
            busyLabel={t('terminal.changes.refreshing')}
            label={t('terminal.changes.refresh')}
            onClick={() => void reload()}
          >
            <RefreshIcon />
          </IconButton>
        </div>
      </div>
      <ChangesNotices actionFailed={actionFailed} summary={summary} />
      <div className="changes-files">
        {!listed ? null : (
          <>
            {value.files.length === 0 && value.state !== 'capturing' ? (
              <p className="changes-empty">{t(emptyKey(source))}</p>
            ) : null}
            {value.files.length > 0 ? (
              <ChangesFileGroup
                files={value.files}
                handlers={handlers}
                label={t('terminal.changes.file-list')}
                menuItems={fileMenu}
                onShowMore={() => setPages((current) => ({ ...current, files: current.files + CHANGES_PAGE_SIZE }))}
                selectedPath={selectedPath}
                visibleCount={pages.files}
              />
            ) : null}
            {value.committed.length > 0 ? (
              <details
                className="changes-committed"
                onToggle={(event) => setCommittedOpen(event.currentTarget.open)}
                open={committedOpen}
              >
                <summary>{t('terminal.changes.committed', { count: value.committed.length })}</summary>
                {committedOpen ? (
                  <ChangesFileGroup
                    files={value.committed}
                    handlers={handlers}
                    label={t('terminal.changes.committed-files')}
                    menuItems={committedMenu}
                    onShowMore={() =>
                      setPages((current) => ({ ...current, committed: current.committed + CHANGES_PAGE_SIZE }))
                    }
                    selectedPath={selectedPath}
                    visibleCount={pages.committed}
                  />
                ) : null}
              </details>
            ) : null}
          </>
        )}
      </div>
      <div className="changes-diff">
        {listed ? <ChangesDiff diff={diff} oldPath={selectedFile?.oldPath ?? null} /> : null}
      </div>
    </div>
  );
}
