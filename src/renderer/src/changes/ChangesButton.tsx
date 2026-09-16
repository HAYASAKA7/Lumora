import type { ReactNode } from 'react';

import { useShortcutLabel } from '../keyboard/ShortcutLabels';
import { useLocalization } from '../localization/useLocalization';
import { ChangesIcon } from '../ui/icons';
import { Tooltip } from '../ui/Tooltip';
import type { SessionChangesButtonProps } from './useSessionChangesPanel';

type Translate = ReturnType<typeof useLocalization>['t'];

/** The " · N changed" ending of a background session tab; empty without changes. */
export function changeCountSuffix(t: Translate, count: number): string {
  return count > 0 ? ` · ${t('terminal.changes.tab-count', { count })}` : '';
}

/** Past this the exact number stops being worth the width it costs. */
const BADGE_LIMIT = 99;

interface ChangesButtonProps {
  /** The active session's changed file count. */
  count: number;
  control: SessionChangesButtonProps;
  /** Marks the button as a command whose focus the app releases after a click. */
  command?: boolean;
}

/**
 * Opens the changes panel. The button shows the branch mark alone, with the
 * number of changed files as a badge on its corner: the count is what changes
 * from moment to moment, and the word beside it never did.
 */
export function ChangesButton({ command = false, control, count }: ChangesButtonProps): ReactNode {
  const { t } = useLocalization();
  const shortcut = useShortcutLabel('toggleChanges');
  const name = t('terminal.changes.button', { count });
  return (
    <Tooltip content={name} shortcut={shortcut}>
      <button
        aria-controls={control['aria-controls']}
        aria-expanded={control['aria-expanded']}
        aria-label={name}
        className="icon-button changes-button"
        data-lumora-command={command ? true : undefined}
        onClick={control.onClick}
        ref={control.ref}
        type="button"
      >
        <ChangesIcon />
        {count > 0 ? (
          <span aria-hidden="true" className="changes-button-count">
            {count > BADGE_LIMIT ? `${BADGE_LIMIT}+` : count}
          </span>
        ) : null}
      </button>
    </Tooltip>
  );
}
