import type { ReactNode } from 'react';

import type { ChangesFileDiff, ChangesSummary } from '../../../shared/contracts';
import { useLocalization } from '../localization/useLocalization';
import { DiffPatch } from '../ui/DiffPatch';
import type { Load } from './useWorkspaceChanges';

const INFO_NOTICES = [
  ['capturing', (summary: ChangesSummary) => summary.state === 'capturing'],
  ['late', (summary: ChangesSummary) => summary.baselineLate],
  ['shared', (summary: ChangesSummary) => summary.sharedWorkspace],
  ['truncated', (summary: ChangesSummary) => summary.truncated]
] as const;

/**
 * Status lines above the file list. Informational ones share one polite live
 * region that stays mounted so each change is announced; failures are alerts.
 */
export function ChangesNotices({
  actionFailed,
  summary
}: {
  actionFailed: boolean;
  summary: Load<ChangesSummary>;
}): ReactNode {
  const { t } = useLocalization();
  const value = summary.state === 'ready' ? summary.value : null;
  const reason = value?.state === 'unavailable' ? value.unavailableReason ?? 'failed' : null;

  return (
    <div className="changes-notice-stack">
      <div aria-live="polite" className="changes-notices">
        {summary.state === 'loading' ? <p className="changes-notice">{t('common.states.loading')}</p> : null}
        {reason !== null && reason !== 'failed' ? (
          <p className="changes-notice">{t(`terminal.changes.unavailable-${reason}`)}</p>
        ) : null}
        {value === null ? null : INFO_NOTICES.filter(([, applies]) => applies(value)).map(([key]) => (
          <p className="changes-notice" key={key}>{t(`terminal.changes.${key}`)}</p>
        ))}
      </div>
      {summary.state === 'error' ? <ErrorNotice text={t('terminal.changes.error')} /> : null}
      {reason === 'failed' ? <ErrorNotice text={t('terminal.changes.unavailable-failed')} /> : null}
      {actionFailed ? <ErrorNotice text={t('terminal.changes.action-failed')} /> : null}
    </div>
  );
}

function ErrorNotice({ text }: { text: string }): ReactNode {
  return <p className="changes-notice changes-notice-error" role="alert">{text}</p>;
}

export function ChangesDiff({
  diff,
  oldPath
}: {
  diff: Load<ChangesFileDiff> | null;
  oldPath: string | null;
}): ReactNode {
  const { t } = useLocalization();
  if (diff === null) return <p className="changes-diff-message">{t('terminal.changes.select-file')}</p>;
  // No live region here: arrowing through files would announce every load.
  if (diff.state === 'loading') return <p className="changes-diff-message">{t('common.states.loading')}</p>;
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
