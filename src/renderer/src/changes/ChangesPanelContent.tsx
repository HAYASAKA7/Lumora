import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';

import type { ChangesSource } from '../../../shared/contracts';
import { useShortcutLabel } from '../keyboard/ShortcutLabels';
import { useLocalization } from '../localization/useLocalization';
import { useRefreshRequest } from '../keyboard/page-requests';
import { IconButton } from '../ui/IconButton';
import { BackIcon, RefreshIcon } from '../ui/icons';
import { ChangesHistory } from './ChangesHistory';
import { ChangesModeSwitch, type ChangesModeOption } from './ChangesModeSwitch';
import { ChangesView } from './ChangesView';
import { useChangesHistory } from './useChangesHistory';
import type { ChangesApi } from './useWorkspaceChanges';

export type ChangesPanelMode = 'changes' | 'history';

type Choice = 'session' | 'uncommitted' | 'history';

/** The pressed choice in the mode switch. */
const OPEN_MENU_SELECTOR = '[aria-haspopup="menu"][aria-expanded="true"]';

interface ChangesPanelContentProps {
  api: ChangesApi;
  source: ChangesSource;
  active: boolean;
  /** History is honoured once the workspace id is known. */
  initialMode: ChangesPanelMode;
  sessionTitle?: ((catalogSessionId: string) => string | null) | undefined;
  highlightSessionId?: string | null | undefined;
  onSourceChange(source: ChangesSource): void;
}

/**
 * Switches the panel between a source's changes and its workspace's review
 * history. A batch opened from the history shows as a review source with a way
 * back to the history it came from; Escape takes that way back too.
 */
export function ChangesPanelContent({
  active,
  api,
  highlightSessionId = null,
  initialMode,
  onSourceChange,
  sessionTitle,
  source
}: ChangesPanelContentProps): ReactNode {
  const { t } = useLocalization();
  const refreshShortcut = useShortcutLabel('refresh');
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [mode, setMode] = useState<ChangesPanelMode>(initialMode);
  /** The source a review opened from the history returns to. */
  const [returnTo, setReturnTo] = useState<ChangesSource | null>(null);
  const [sessionWorkspaceId, setSessionWorkspaceId] = useState<string | null>(null);

  const historyWorkspaceId = source.kind === 'workspace'
    ? source.workspaceId
    : source.kind === 'session' ? sessionWorkspaceId : null;
  const showHistory = source.kind !== 'review' && mode === 'history' && historyWorkspaceId !== null;
  const history = useChangesHistory(api, historyWorkspaceId, active && showHistory);
  useRefreshRequest(active && showHistory && !history.refreshing, history.reload);

  const latest = useRef({ source, onSourceChange });
  useLayoutEffect(() => {
    latest.current = { source, onSourceChange };
  });

  const openReview = useCallback((reviewId: string) => {
    setReturnTo(latest.current.source);
    latest.current.onSourceChange({ kind: 'review', reviewId });
  }, []);

  const goBack = () => {
    if (returnTo === null) return;
    setReturnTo(null);
    setMode('history');
    onSourceChange(returnTo);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Escape' || event.defaultPrevented || source.kind !== 'review' || returnTo === null) return;
    if (event.currentTarget.querySelector(OPEN_MENU_SELECTOR) !== null) return;
    event.preventDefault();
    event.stopPropagation();
    goBack();
  };

  const modeSwitch = () => {
    const options: ChangesModeOption<Choice>[] = [
      ...(source.kind === 'session' ? [{ id: 'session' as const, label: t('terminal.changes.view-session') }] : []),
      { id: 'uncommitted', label: t('terminal.changes.view-uncommitted') },
      { id: 'history', label: t('terminal.changes.history'), disabled: historyWorkspaceId === null }
    ];
    const selected: Choice = showHistory ? 'history' : source.kind === 'session' ? source.view : 'uncommitted';
    const select = (choice: Choice) => {
      if (choice === 'history') {
        if (historyWorkspaceId !== null) setMode('history');
        return;
      }
      setMode('changes');
      if (source.kind === 'session' && source.view !== choice) onSourceChange({ ...source, view: choice });
    };
    return <ChangesModeSwitch onSelect={select} options={options} selected={selected} />;
  };

  let body: ReactNode;
  if (source.kind === 'review') {
    body = (
      <ChangesView
        active={active}
        api={api}
        source={source}
        toolbarStart={returnTo === null ? <span /> : (
          <IconButton label={t('terminal.changes.history-back')} onClick={goBack}>
            <BackIcon />
          </IconButton>
        )}
      />
    );
  } else if (showHistory) {
    body = (
      <div className="changes-history-view">
        <div className="changes-toolbar">
          {modeSwitch()}
          <div className="changes-toolbar-actions">
            <IconButton
              busy={history.refreshing}
              busyLabel={t('terminal.changes.refreshing')}
              label={t('terminal.changes.refresh')}
              onClick={history.reload}
              shortcut={refreshShortcut}
            >
              <RefreshIcon />
            </IconButton>
          </div>
        </div>
        <div className="changes-history-scroll">
          <ChangesHistory
            highlightSessionId={highlightSessionId}
            history={history.history}
            onOpenReview={openReview}
            sessionTitle={sessionTitle}
          />
        </div>
      </div>
    );
  } else {
    body = (
      <ChangesView
        active={active}
        api={api}
        onSourceChange={onSourceChange}
        source={source}
        toolbarStart={modeSwitch()}
        {...(source.kind === 'session' ? { onWorkspaceKnown: setSessionWorkspaceId } : {})}
      />
    );
  }

  return (
    <div className="changes-panel-content" onKeyDown={handleKeyDown} ref={rootRef}>
      {body}
    </div>
  );
}
