import type { ReactNode } from 'react';

import type { ChangedFile } from '../../../shared/contracts';
import { useLocalization } from '../localization/useLocalization';
import type { ActionMenuItem } from '../ui/ActionMenu';
import { ChangesFileRow, type ChangesFileAction, type ChangesFileRowHandlers } from './ChangesFileRow';

/** How many more rows each "Show more" reveals; a list of thousands renders in pages. */
export const CHANGES_PAGE_SIZE = 300;

interface ChangesFileGroupProps {
  files: readonly ChangedFile[];
  label: string;
  visibleCount: number;
  selectedPath: string | null;
  menuItems: readonly ActionMenuItem<ChangesFileAction>[];
  handlers: ChangesFileRowHandlers;
  onShowMore(): void;
}

export function ChangesFileGroup({
  files,
  handlers,
  label,
  menuItems,
  onShowMore,
  selectedPath,
  visibleCount
}: ChangesFileGroupProps): ReactNode {
  const { t } = useLocalization();
  const visible = files.length > visibleCount ? files.slice(0, visibleCount) : files;
  const tabStopPath = visible.some((file) => file.path === selectedPath) ? selectedPath : visible[0]?.path;
  const hidden = files.length - visible.length;

  return (
    <>
      <ul aria-label={label} className="changes-file-list">
        {visible.map((file) => (
          <ChangesFileRow
            file={file}
            handlers={handlers}
            key={file.path}
            menuItems={menuItems}
            selected={file.path === selectedPath}
            tabStop={file.path === tabStopPath}
          />
        ))}
      </ul>
      {hidden > 0 ? (
        <button className="changes-show-more" onClick={onShowMore} type="button">
          {t('terminal.changes.show-more', { count: hidden })}
        </button>
      ) : null}
    </>
  );
}
