import { memo, useCallback, type KeyboardEvent, type ReactNode } from 'react';

import type { ChangedFile } from '../../../shared/contracts';
import { useLocalization } from '../localization/useLocalization';
import { ActionMenu, type ActionMenuItem } from '../ui/ActionMenu';
import { ChevronDownIcon } from '../ui/icons';
import { OverflowTooltip } from '../ui/Tooltip';

export type ChangesFileAction = 'mark-reviewed' | 'open-file' | 'reveal-file' | 'copy-path';
export type ChangesFileNavigation = 'ArrowUp' | 'ArrowDown' | 'Home' | 'End';

const NAVIGATION_KEYS: ReadonlySet<string> = new Set<ChangesFileNavigation>(['ArrowUp', 'ArrowDown', 'Home', 'End']);
/** Keys that open the row's actions, which are otherwise only a pointer away. */
const MENU_KEYS: ReadonlySet<string> = new Set(['ContextMenu', 'ArrowRight']);

const STATUS_LETTER: Record<ChangedFile['status'], string> = {
  added: 'A',
  modified: 'M',
  deleted: 'D',
  renamed: 'R',
  'type-changed': 'T'
};

export interface ChangesFileRowHandlers {
  onSelect(path: string): void;
  /** Moves the selection within the row's list. */
  onNavigate(path: string, key: ChangesFileNavigation): void;
  onAction(path: string, action: ChangesFileAction): void;
  registerButton(path: string, node: HTMLButtonElement | null): void;
}

interface ChangesFileRowProps {
  file: ChangedFile;
  selected: boolean;
  /** The one row of its list that the Tab key reaches. */
  tabStop: boolean;
  menuItems: readonly ActionMenuItem<ChangesFileAction>[];
  handlers: ChangesFileRowHandlers;
}

function ChangesFileRowView({ file, handlers, menuItems, selected, tabStop }: ChangesFileRowProps): ReactNode {
  const { t } = useLocalization();
  const { path } = file;
  const setButton = useCallback(
    (node: HTMLButtonElement | null) => handlers.registerButton(path, node),
    [handlers, path]
  );
  const choose = useCallback((action: ChangesFileAction) => handlers.onAction(path, action), [handlers, path]);

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (MENU_KEYS.has(event.key) || (event.shiftKey && event.key === 'F10')) {
      const trigger = event.currentTarget.parentElement?.querySelector<HTMLButtonElement>('button.changes-file-menu');
      if (trigger === null || trigger === undefined) return;
      event.preventDefault();
      trigger.focus();
      trigger.click();
      return;
    }
    if (!NAVIGATION_KEYS.has(event.key)) return;
    event.preventDefault();
    handlers.onNavigate(path, event.key as ChangesFileNavigation);
  };

  return (
    <li className="changes-file-row">
      <button
        aria-current={selected ? 'true' : undefined}
        className="changes-file-select"
        onClick={() => handlers.onSelect(path)}
        onKeyDown={handleKeyDown}
        ref={setButton}
        tabIndex={tabStop ? 0 : -1}
        type="button"
      >
        <span
          aria-label={t(`terminal.changes.status-${file.status}`)}
          className={`changes-file-status changes-file-status-${file.status}`}
          role="img"
        >
          {STATUS_LETTER[file.status]}
        </span>
        <OverflowTooltip content={path}>
          <span className="changes-file-path">{path}</span>
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
        items={menuItems}
        label={t('terminal.changes.file-actions')}
        onSelect={choose}
      >
        <ChevronDownIcon />
      </ActionMenu>
    </li>
  );
}

export const ChangesFileRow = memo(ChangesFileRowView);
