import type { KeyboardEvent, ReactNode } from 'react';

import type { ChangedFile } from '../../../shared/contracts';
import { useLocalization } from '../localization/useLocalization';
import { ActionMenu, type ActionMenuItem } from '../ui/ActionMenu';
import { ChevronDownIcon } from '../ui/icons';
import { OverflowTooltip } from '../ui/Tooltip';

export type ChangesFileAction = 'mark-reviewed' | 'open-file' | 'reveal-file' | 'copy-path';

const STATUS_LETTER: Record<ChangedFile['status'], string> = {
  added: 'A',
  modified: 'M',
  deleted: 'D',
  renamed: 'R',
  'type-changed': 'T'
};

interface ChangesFileRowProps {
  file: ChangedFile;
  selected: boolean;
  /** Offers "Mark reviewed" in the file's menu. */
  reviewable: boolean;
  onSelect(): void;
  /** Moves the selection to the neighbouring file in the same list. */
  onMove(direction: -1 | 1): void;
  onAction(action: ChangesFileAction): void;
  buttonRef(node: HTMLButtonElement | null): void;
}

export function ChangesFileRow({
  buttonRef,
  file,
  onAction,
  onMove,
  onSelect,
  reviewable,
  selected
}: ChangesFileRowProps): ReactNode {
  const { t } = useLocalization();
  const items: ActionMenuItem<ChangesFileAction>[] = [
    ...(reviewable ? [{ id: 'mark-reviewed' as const, label: t('terminal.changes.mark-reviewed') }] : []),
    { id: 'open-file', label: t('terminal.changes.open-file') },
    { id: 'reveal-file', label: t('terminal.changes.reveal-file') },
    { id: 'copy-path', label: t('terminal.changes.copy-path') }
  ];

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault();
    onMove(event.key === 'ArrowDown' ? 1 : -1);
  };

  return (
    <li className="changes-file-row">
      <button
        aria-pressed={selected}
        className="changes-file-select"
        onClick={onSelect}
        onKeyDown={handleKeyDown}
        ref={buttonRef}
        type="button"
      >
        <span
          aria-label={t(`terminal.changes.status-${file.status}`)}
          className={`changes-file-status changes-file-status-${file.status}`}
          role="img"
        >
          {STATUS_LETTER[file.status]}
        </span>
        <OverflowTooltip content={file.path}>
          <span className="changes-file-path">{file.path}</span>
        </OverflowTooltip>
        {file.binary || file.additions === null || file.deletions === null ? null : (
          <span className="changes-file-counts">
            <span className="changes-file-additions">+{file.additions}</span>
            <span className="changes-file-deletions">−{file.deletions}</span>
          </span>
        )}
      </button>
      <ActionMenu
        align="end"
        className="changes-file-menu"
        items={items}
        label={t('terminal.changes.file-actions')}
        onSelect={onAction}
      >
        <ChevronDownIcon />
      </ActionMenu>
    </li>
  );
}
