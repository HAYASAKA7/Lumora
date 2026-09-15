import { useState, type ReactNode } from 'react';

import type { ChangesSource } from '../../../shared/contracts';
import { useLocalization } from '../localization/useLocalization';
import { ChangesHistory } from './ChangesHistory';
import { ChangesModeSwitch, type ChangesModeOption } from './ChangesModeSwitch';
import { ChangesView } from './ChangesView';
import type { ChangesApi } from './useWorkspaceChanges';

export type ChangesPanelMode = 'changes' | 'history';

type Choice = 'session' | 'uncommitted' | 'history';

interface ChangesPanelContentProps {
  api: ChangesApi;
  source: ChangesSource;
  active: boolean;
  initialMode: ChangesPanelMode;
  sessionTitle?: ((catalogSessionId: string) => string | null) | undefined;
  highlightSessionId?: string | null | undefined;
  onSourceChange(source: ChangesSource): void;
}

/**
 * Switches the panel between a source's changes and its workspace's review
 * history. A batch opened from the history shows as a review source with a way
 * back to the history it came from.
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
  const [mode, setMode] = useState<ChangesPanelMode>(initialMode);
  /** The source a review opened from the history returns to. */
  const [returnTo, setReturnTo] = useState<ChangesSource | null>(null);
  const [sessionWorkspaceId, setSessionWorkspaceId] = useState<string | null>(null);

  if (source.kind === 'review') {
    const back = returnTo;
    return (
      <ChangesView
        active={active}
        api={api}
        source={source}
        toolbarStart={() => back === null ? <span /> : (
          <button
            className="secondary-button"
            onClick={() => {
              setReturnTo(null);
              setMode('history');
              onSourceChange(back);
            }}
            type="button"
          >
            {t('terminal.changes.history-back')}
          </button>
        )}
      />
    );
  }

  const historyWorkspaceId = source.kind === 'workspace' ? source.workspaceId : sessionWorkspaceId;

  const renderSwitch = (knownWorkspaceId: string | null) => {
    const options: ChangesModeOption<Choice>[] = [
      ...(source.kind === 'session' ? [{ id: 'session' as const, label: t('terminal.changes.view-session') }] : []),
      { id: 'uncommitted', label: t('terminal.changes.view-uncommitted') },
      { id: 'history', label: t('terminal.changes.history'), disabled: knownWorkspaceId === null }
    ];
    const selected: Choice = mode === 'history' ? 'history' : source.kind === 'session' ? source.view : 'uncommitted';
    const select = (choice: Choice) => {
      if (choice === 'history') {
        if (knownWorkspaceId === null) return;
        setSessionWorkspaceId(knownWorkspaceId);
        setMode('history');
        return;
      }
      setMode('changes');
      if (source.kind === 'session' && source.view !== choice) onSourceChange({ ...source, view: choice });
    };
    return <ChangesModeSwitch onSelect={select} options={options} selected={selected} />;
  };

  if (mode === 'history' && historyWorkspaceId !== null) {
    return (
      <div className="changes-history-view">
        <div className="changes-toolbar">{renderSwitch(historyWorkspaceId)}</div>
        <div className="changes-history-scroll">
          <ChangesHistory
            active={active}
            api={api}
            highlightSessionId={highlightSessionId}
            onOpenReview={(reviewId) => {
              setReturnTo(source);
              onSourceChange({ kind: 'review', reviewId });
            }}
            workspaceId={historyWorkspaceId}
            {...(sessionTitle === undefined ? {} : { sessionTitle })}
          />
        </div>
      </div>
    );
  }

  return (
    <ChangesView
      active={active}
      api={api}
      onSourceChange={onSourceChange}
      source={source}
      toolbarStart={(summaryWorkspaceId) =>
        renderSwitch(source.kind === 'workspace' ? source.workspaceId : summaryWorkspaceId)}
    />
  );
}
