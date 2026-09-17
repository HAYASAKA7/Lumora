import type { ReactNode } from 'react';

import type { ChangedFile } from '../../../shared/contracts';
import { useLocalization } from '../localization/useLocalization';
import type { ActionMenuItem } from '../ui/ActionMenu';
import {
  ChangesFileRow,
  fileKeyOf,
  isSameFile,
  type ChangesFileAction,
  type ChangesFileKey,
  type ChangesFileRowHandlers
} from './ChangesFileRow';

/** How many more rows each "Show more" reveals; a list of thousands renders in pages. */
export const CHANGES_PAGE_SIZE = 300;

interface ChangesFileGroupProps {
  files: readonly ChangedFile[];
  label: string;
  /** Names the place these files came from; absent while the workspace is the only one. */
  heading?: string | undefined;
  /** What this place says about itself, such as a baseline taken late. */
  note?: string | undefined;
  visibleCount: number;
  selected: ChangesFileKey | null;
  menuItems: readonly ActionMenuItem<ChangesFileAction>[];
  handlers: ChangesFileRowHandlers;
  onShowMore(): void;
}

export function ChangesFileGroup({
  files,
  handlers,
  heading,
  label,
  note,
  menuItems,
  onShowMore,
  selected,
  visibleCount
}: ChangesFileGroupProps): ReactNode {
  const { t } = useLocalization();
  const visible = files.length > visibleCount ? files.slice(0, visibleCount) : files;
  const tabStop = visible.find((file) => isSameFile(file, selected)) ?? visible[0];
  const hidden = files.length - visible.length;

  return (
    <>
      {heading === undefined ? null : (
        <p className="changes-place-heading">
          <span className="changes-place-name">{heading}</span>
          {note === undefined ? null : <span className="changes-place-note">{note}</span>}
        </p>
      )}
      <ul aria-label={label} className="changes-file-list">
        {visible.map((file) => (
          <ChangesFileRow
            file={file}
            handlers={handlers}
            key={fileKeyOf(file)}
            menuItems={menuItems}
            selected={isSameFile(file, selected)}
            tabStop={isSameFile(file, tabStop ?? null)}
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
