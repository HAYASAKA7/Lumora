import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';

import type {
  ChangedFile,
  ChangesPlace,
  ChangesPlaceSuggestion,
  ChangesSource,
  ChangesSummary
} from '../../../shared/contracts';
import { useShortcutLabel } from '../keyboard/ShortcutLabels';
import { useLocalization } from '../localization/useLocalization';
import { ActionMenu, type ActionMenuItem } from '../ui/ActionMenu';
import { useRefreshRequest } from '../keyboard/page-requests';
import { IconButton } from '../ui/IconButton';
import { FolderIcon, RefreshIcon } from '../ui/icons';
import { CHANGES_PAGE_SIZE, ChangesFileGroup } from './ChangesFileGroup';
import { ChangesOpenConfirm } from './ChangesOpenConfirm';
import {
  fileKeyOf,
  isSameFile,
  type ChangesFileAction,
  type ChangesFileKey,
  type ChangesFileNavigation,
  type ChangesFileRowHandlers
} from './ChangesFileRow';
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
  /** Replaces the session view switch. */
  toolbarStart?: ReactNode;
  /** Called with the loaded summary's workspace id whenever it changes. */
  onWorkspaceKnown?(workspaceId: string): void;
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

function navigationTarget(
  files: readonly ChangedFile[],
  from: ChangesFileKey,
  key: ChangesFileNavigation
): ChangedFile | undefined {
  const index = files.findIndex((file) => isSameFile(file, from));
  if (index < 0) return undefined;
  if (key === 'Home') return files[0];
  if (key === 'End') return files[files.length - 1];
  return files[Math.min(files.length - 1, Math.max(0, index + (key === 'ArrowDown' ? 1 : -1)))];
}

const FIRST_PAGE = { files: CHANGES_PAGE_SIZE, committed: CHANGES_PAGE_SIZE };

export function ChangesView({
  active,
  api,
  onSourceChange,
  onWorkspaceKnown,
  source,
  toolbarStart
}: ChangesViewProps): ReactNode {
  const { t } = useLocalization();
  const refreshShortcut = useShortcutLabel('refresh');
  const { diff, markReviewed, refreshing, reload, selected, setSelected, summary } =
    useWorkspaceChanges(api, source, active);
  useRefreshRequest(active && !refreshing, () => void reload());
  const rootRef = useRef<HTMLDivElement | null>(null);
  const wide = useIsWide(rootRef);
  const reviewable = source.kind === 'session' && source.view === 'session';
  const sourceKey = JSON.stringify(source);

  const [actionFailed, setActionFailed] = useState(false);
  /** The file whose open is waiting for an answer, since opening it may run it. */
  const [confirmFile, setConfirmFile] = useState<ChangesFileKey | null>(null);
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
  const knownWorkspaceId = value?.workspaceId ?? null;
  useEffect(() => {
    if (knownWorkspaceId !== null) onWorkspaceKnown?.(knownWorkspaceId);
  }, [knownWorkspaceId, onWorkspaceKnown]);
  const latest = useRef({ api, source, markReviewed, value, pages });
  latest.current = { api, source, markReviewed, value, pages };
  const buttons = useRef(new Map<string, HTMLButtonElement>());
  const markingAllRef = useRef(false);

  const attempt = useCallback((work: () => Promise<void>) => {
    setActionFailed(false);
    work().catch(() => setActionFailed(true));
  }, []);

  const handlers = useMemo<ChangesFileRowHandlers>(() => ({
    onSelect: (file) => setSelected(file),
    onNavigate: (file, key) => {
      const current = latest.current;
      if (current.value === null) return;
      const inFiles = current.value.files.some((entry) => isSameFile(entry, file));
      const group = inFiles ? current.value.files : current.value.committed;
      const visible = group.slice(0, inFiles ? current.pages.files : current.pages.committed);
      const target = navigationTarget(visible, file, key);
      if (target === undefined) return;
      setSelected(target);
      buttons.current.get(fileKeyOf(target))?.focus();
    },
    onAction: (file, action) => {
      const current = latest.current;
      if (action === 'mark-reviewed') attempt(() => current.markReviewed([file]));
      else if (action === 'copy-path') attempt(() => current.api.writeClipboardText(file.path));
      else if (action === 'copy-full-path') attempt(async () => {
        const full = await current.api.getChangedFilePath(current.source, file.placeId, file.path);
        await current.api.writeClipboardText(full);
      });
      else if (action === 'reveal-file') attempt(async () => { await openFile(file, 'reveal'); });
      else attempt(async () => {
        const result = await openFile(file, 'open');
        if (result.outcome === 'confirm-required') setConfirmFile(file);
      });
    },
    registerButton: (file, node) => {
      if (node === null) buttons.current.delete(fileKeyOf(file));
      else buttons.current.set(fileKeyOf(file), node);
    }
  }), [attempt, setSelected]);

  const openFile = useCallback((file: ChangesFileKey, action: 'open' | 'reveal' | 'open-anyway') => {
    const current = latest.current;
    return current.api.openChangedFile(current.source, file.placeId, file.path, action);
  }, []);

  const answerConfirm = (action: 'reveal' | 'open-anyway' | null) => {
    const file = confirmFile;
    setConfirmFile(null);
    if (file === null || action === null) return;
    attempt(async () => {
      await openFile(file, action);
    });
  };

  const markAll = () => {
    const current = latest.current;
    if (markingAllRef.current || current.value === null) return;
    markingAllRef.current = true;
    setMarkingAll(true);
    setActionFailed(false);
    current.markReviewed(current.value.files)
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
    { id: 'copy-path', label: t('terminal.changes.copy-path') },
    { id: 'copy-full-path', label: t('terminal.changes.copy-full-path') }
  ], [reviewable, t]);
  const committedMenu = useMemo(() => fileMenu.filter((item) => item.id !== 'mark-reviewed'), [fileMenu]);

  const listed = value !== null && value.state !== 'unavailable';
  /**
   * The files of each watched place, the workspace first. A place with nothing
   * in it is left out: an empty heading says less than no heading at all.
   */
  const placeGroups = useMemo(() => {
    const places = value?.places ?? [];
    if (value === null) return [];
    return places
      .map((place) => ({ place, files: value.files.filter((file) => file.placeId === place.id) }))
      .filter(({ files, place }) => files.length > 0 || place.id === null);
  }, [value]);
  const [suggestion, setSuggestion] = useState<ChangesPlaceSuggestion>(null);
  const placeCount = value?.places.length ?? 0;
  useEffect(() => {
    if (knownWorkspaceId === null) return undefined;
    let cancelled = false;
    api.suggestChangesPlace(knownWorkspaceId).then(
      (value) => { if (!cancelled) setSuggestion(value); },
      () => { if (!cancelled) setSuggestion(null); }
    );
    return () => { cancelled = true; };
  }, [api, knownWorkspaceId, placeCount]);

  const placeMenuItems = useMemo<ActionMenuItem<string>[]>(() => [
    ...(suggestion === null
      ? []
      : [{ id: 'repository', label: t('terminal.changes.place-repository', { name: suggestion.name }) }]),
    { id: 'add', label: t('terminal.changes.place-add') },
    ...(value?.places ?? [])
      .filter((place) => place.id !== null)
      .map((place) => ({
        id: `remove:${place.id}`,
        label: t('terminal.changes.place-remove', { name: place.name })
      }))
  ], [suggestion, t, value?.places]);

  const choosePlaceAction = (id: string) => {
    const workspaceId = knownWorkspaceId;
    if (workspaceId === null) return;
    const current = latest.current;
    if (id === 'repository') {
      attempt(async () => {
        await current.api.addChangesPlace(workspaceId, suggestion?.path ?? null);
        await reload();
      });
      return;
    }
    if (id === 'add') {
      attempt(async () => {
        await current.api.addChangesPlace(workspaceId);
        await reload();
      });
      return;
    }
    const placeId = id.slice('remove:'.length);
    attempt(async () => {
      await current.api.removeChangesPlace(workspaceId, placeId);
      await reload();
    });
  };

  const placeNote = (place: ChangesPlace): string | undefined => {
    if (place.unavailableReason !== null) return t('terminal.changes.place-unreadable');
    return place.baselineLate ? t('terminal.changes.place-late') : undefined;
  };
  const selectedFile = !listed || selected === null
    ? null
    : value.files.find((file) => isSameFile(file, selected)) ??
      value.committed.find((file) => isSameFile(file, selected)) ?? null;

  return (
    <div className={`changes-view${wide ? ' is-wide' : ''}`} ref={rootRef}>
      <div className="changes-toolbar">
        {toolbarStart !== undefined ? toolbarStart : source.kind === 'session' ? (
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
          {knownWorkspaceId === null ? null : (
            <ActionMenu
              className="changes-places-menu"
              items={placeMenuItems}
              label={t('terminal.changes.places')}
              onSelect={choosePlaceAction}
            >
              <FolderIcon />
            </ActionMenu>
          )}
          <IconButton
            busy={refreshing}
            busyLabel={t('terminal.changes.refreshing')}
            label={t('terminal.changes.refresh')}
            onClick={() => void reload()}
            shortcut={refreshShortcut}
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
            {value.files.length > 0 ? placeGroups.map(({ place, files }) => (
              <ChangesFileGroup
                files={files}
                handlers={handlers}
                heading={placeGroups.length > 1 ? place.name : undefined}
                key={place.id ?? ''}
                label={placeGroups.length > 1 ? place.name : t('terminal.changes.file-list')}
                menuItems={fileMenu}
                note={placeNote(place)}
                onShowMore={() => setPages((current) => ({ ...current, files: current.files + CHANGES_PAGE_SIZE }))}
                selected={selected}
                visibleCount={pages.files}
              />
            )) : null}
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
                    selected={selected}
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
      {confirmFile === null ? null : (
        <ChangesOpenConfirm
          onClose={() => answerConfirm(null)}
          onOpenAnyway={() => answerConfirm('open-anyway')}
          onReveal={() => answerConfirm('reveal')}
          path={confirmFile.path}
        />
      )}
    </div>
  );
}
