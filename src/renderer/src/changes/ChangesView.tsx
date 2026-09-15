import { useEffect, useRef, useState, type ReactNode } from 'react';

import type { ChangedFile, ChangesFileDiff, ChangesSource, ChangesSummary } from '../../../shared/contracts';
import { useLocalization } from '../localization/useLocalization';
import { DiffPatch } from '../ui/DiffPatch';
import { IconButton } from '../ui/IconButton';
import { RefreshIcon } from '../ui/icons';
import { ChangesFileRow, type ChangesFileAction } from './ChangesFileRow';
import { useWorkspaceChanges, type ChangesApi, type Load } from './useWorkspaceChanges';

/** The view places the file list beside the diff from this width on. */
const WIDE_LAYOUT_MIN_WIDTH = 720;

interface ChangesViewProps {
  api: ChangesApi;
  source: ChangesSource;
  active: boolean;
  onSourceChange?(source: ChangesSource): void;
}

function useIsWide(): [boolean, (node: HTMLDivElement | null) => void] {
  const [node, setNode] = useState<HTMLDivElement | null>(null);
  const [wide, setWide] = useState(false);
  useEffect(() => {
    if (node === null || typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(() => setWide(node.clientWidth >= WIDE_LAYOUT_MIN_WIDTH));
    observer.observe(node);
    return () => observer.disconnect();
  }, [node]);
  return [wide, setNode];
}

function emptyKey(source: ChangesSource): string {
  if (source.kind === 'review') return 'terminal.changes.empty-review';
  if (source.kind === 'session' && source.view === 'session') return 'terminal.changes.empty';
  return 'terminal.changes.empty-uncommitted';
}

export function ChangesView({ active, api, onSourceChange, source }: ChangesViewProps): ReactNode {
  const { t } = useLocalization();
  const changes = useWorkspaceChanges(api, source, active);
  const { diff, markReviewed, refreshing, reload, selectedPath, setSelectedPath, summary } = changes;
  const [actionFailed, setActionFailed] = useState(false);
  const [wide, setRoot] = useIsWide();
  const buttons = useRef(new Map<string, HTMLButtonElement>());
  const sourceKey = JSON.stringify(source);
  const reviewable = source.kind === 'session' && source.view === 'session';

  useEffect(() => setActionFailed(false), [sourceKey]);

  const attempt = (work: () => Promise<void>) => {
    setActionFailed(false);
    work().catch(() => setActionFailed(true));
  };

  const act = (file: ChangedFile, action: ChangesFileAction) => {
    if (action === 'mark-reviewed') attempt(() => markReviewed([file.path]));
    else if (action === 'copy-path') attempt(() => api.writeClipboardText(file.path));
    else attempt(() => api.openChangedFile(source, file.path, action === 'open-file' ? 'open' : 'reveal'));
  };

  const renderList = (files: readonly ChangedFile[], label?: string, canReview = false) => (
    <ul aria-label={label} className="changes-file-list">
      {files.map((file, index) => (
        <ChangesFileRow
          buttonRef={(node) => {
            if (node === null) buttons.current.delete(file.path);
            else buttons.current.set(file.path, node);
          }}
          file={file}
          key={file.path}
          onAction={(action) => act(file, action)}
          onMove={(direction) => {
            const next = files[index + direction];
            if (next === undefined) return;
            setSelectedPath(next.path);
            buttons.current.get(next.path)?.focus();
          }}
          onSelect={() => setSelectedPath(file.path)}
          reviewable={canReview}
          selected={selectedPath === file.path}
        />
      ))}
    </ul>
  );

  const value = summary.state === 'ready' ? summary.value : null;
  const selectedFile = value === null || selectedPath === null
    ? null
    : [...value.files, ...value.committed].find((file) => file.path === selectedPath) ?? null;

  return (
    <div className={`changes-view${wide ? ' is-wide' : ''}`} ref={setRoot}>
      <div className="changes-toolbar">
        {source.kind === 'session' ? (
          <div className="changes-view-switch">
            {(['session', 'uncommitted'] as const).map((view) => (
              <button
                aria-pressed={source.view === view}
                className="changes-view-switch-button"
                key={view}
                onClick={() => onSourceChange?.({ ...source, view })}
                type="button"
              >
                {t(`terminal.changes.view-${view}`)}
              </button>
            ))}
          </div>
        ) : <span />}
        <div className="changes-toolbar-actions">
          {reviewable ? (
            <button
              className="secondary-button"
              disabled={value === null || value.files.length === 0}
              onClick={() => attempt(() => markReviewed((value?.files ?? []).map((file) => file.path)))}
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
        {value === null || value.state === 'unavailable' ? null : (
          <>
            {value.files.length === 0 && value.state !== 'capturing' ? (
              <p className="changes-empty">{t(emptyKey(source))}</p>
            ) : null}
            {value.files.length > 0 ? renderList(value.files, t('terminal.changes.file-list'), reviewable) : null}
            {value.committed.length > 0 ? (
              <details className="changes-committed">
                <summary>{t('terminal.changes.committed', { count: value.committed.length })}</summary>
                {renderList(value.committed)}
              </details>
            ) : null}
          </>
        )}
      </div>
      <div className="changes-diff">
        <ChangesDiff diff={diff} oldPath={selectedFile?.oldPath ?? null} />
      </div>
    </div>
  );
}

function ChangesNotices({ actionFailed, summary }: { actionFailed: boolean; summary: Load<ChangesSummary> }): ReactNode {
  const { t } = useLocalization();
  const value = summary.state === 'ready' ? summary.value : null;
  const notice = (key: string) => (
    <p className="changes-notice" key={key} role="status">{t(`terminal.changes.${key}`)}</p>
  );
  const reason = value?.state === 'unavailable' ? value.unavailableReason ?? 'failed' : null;
  return (
    <div className="changes-notices">
      {summary.state === 'loading' ? (
        <p className="changes-notice" role="status">{t('common.states.loading')}</p>
      ) : null}
      {summary.state === 'error' || actionFailed ? (
        <p className="changes-notice changes-notice-error" role="alert">{t('terminal.changes.error')}</p>
      ) : null}
      {reason === null ? null : (
        <p
          className={`changes-notice${reason === 'failed' ? ' changes-notice-error' : ''}`}
          role={reason === 'failed' ? 'alert' : 'status'}
        >
          {t(`terminal.changes.unavailable-${reason}`)}
        </p>
      )}
      {value?.state === 'capturing' ? notice('capturing') : null}
      {value?.baselineLate === true ? notice('late') : null}
      {value?.sharedWorkspace === true ? notice('shared') : null}
      {value?.truncated === true ? notice('truncated') : null}
    </div>
  );
}

function ChangesDiff({ diff, oldPath }: { diff: Load<ChangesFileDiff> | null; oldPath: string | null }): ReactNode {
  const { t } = useLocalization();
  if (diff === null) return <p className="changes-diff-message">{t('terminal.changes.select-file')}</p>;
  if (diff.state === 'loading') {
    return <p className="changes-diff-message" role="status">{t('common.states.loading')}</p>;
  }
  if (diff.state === 'error') {
    return <p className="changes-diff-message changes-notice-error" role="alert">{t('terminal.changes.error')}</p>;
  }
  if (diff.value.binary) return <p className="changes-diff-message">{t('terminal.changes.binary')}</p>;
  if (diff.value.truncated) return <p className="changes-diff-message">{t('terminal.changes.patch-truncated')}</p>;
  return (
    <>
      {oldPath === null ? null : (
        <p className="changes-diff-renamed">{t('terminal.changes.renamed-from', { path: oldPath })}</p>
      )}
      <DiffPatch patch={diff.value.patch} />
    </>
  );
}
