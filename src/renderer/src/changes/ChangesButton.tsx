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

interface ChangesButtonProps {
  /** The active session's changed file count. */
  count: number;
  control: SessionChangesButtonProps;
  /** Marks the button as a command whose focus the app releases after a click. */
  command?: boolean;
}

export function ChangesButton({ command = false, control, count }: ChangesButtonProps): ReactNode {
  const { t } = useLocalization();
  const shortcut = useShortcutLabel('toggleChanges');
  return (
    <Tooltip content={t('terminal.changes.panel-title')} shortcut={shortcut}>
      <button
        aria-controls={control['aria-controls']}
        aria-expanded={control['aria-expanded']}
        className="secondary-button button-with-icon changes-button"
        data-lumora-command={command ? true : undefined}
        onClick={control.onClick}
        ref={control.ref}
        type="button"
      >
        <ChangesIcon />
        {t('terminal.changes.button', { count })}
      </button>
    </Tooltip>
  );
}
