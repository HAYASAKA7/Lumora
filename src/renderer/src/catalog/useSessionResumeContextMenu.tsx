import { useCallback, useState, type KeyboardEvent, type MouseEvent } from 'react';

import type { SessionSummary } from '../../../shared/contracts';
import { ContextMenu } from '../ui/ContextMenu';
import { useLocalization } from '../localization/useLocalization';

interface SessionMenuState {
  anchor: { x: number; y: number };
  disabledReason: string | null;
  running: boolean;
  session: SessionSummary;
}

interface SessionResumeContextMenuOptions {
  onResume?: ((session: SessionSummary) => void) | undefined;
  onResumeOptions?: ((session: SessionSummary) => void) | undefined;
}

export function useSessionResumeContextMenu({
  onResume,
  onResumeOptions
}: SessionResumeContextMenuOptions) {
  const { t } = useLocalization();
  const [menu, setMenu] = useState<SessionMenuState | null>(null);
  const closeMenu = useCallback(() => setMenu(null), []);

  const openAt = useCallback((
    session: SessionSummary,
    running: boolean,
    disabledReason: string | null,
    anchor: { x: number; y: number }
  ) => {
    if (onResume === undefined && onResumeOptions === undefined) return;
    setMenu({ anchor, disabledReason, running, session });
  }, [onResume, onResumeOptions]);

  const openFromPointer = useCallback((
    event: MouseEvent<HTMLElement>,
    session: SessionSummary,
    running: boolean,
    disabledReason: string | null
  ) => {
    event.preventDefault();
    event.stopPropagation();
    openAt(session, running, disabledReason, {
      x: event.clientX,
      y: event.clientY
    });
  }, [openAt]);

  const openFromKeyboard = useCallback((
    event: KeyboardEvent<HTMLElement>,
    session: SessionSummary,
    running: boolean,
    disabledReason: string | null
  ) => {
    if (!(event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10'))) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    const bounds = event.currentTarget.getBoundingClientRect();
    openAt(session, running, disabledReason, {
      x: bounds.left + Math.min(24, bounds.width / 2),
      y: bounds.top + Math.min(24, bounds.height / 2)
    });
  }, [openAt]);

  return {
    closeMenu,
    menu: menu === null ? null : (
      <ContextMenu
        anchor={menu.anchor}
        items={[
          {
            id: 'resume-now',
            label: t(
              menu.running
                ? 'common.actions.open'
                : 'terminal.direct.resume-now'
            ),
            disabled: onResume === undefined || menu.disabledReason !== null,
            ...(menu.disabledReason === null
              ? {}
              : { description: menu.disabledReason }),
            onSelect: () => onResume?.(menu.session)
          },
          {
            id: 'resume-options',
            label: t('terminal.direct.resume-options'),
            disabled: onResumeOptions === undefined || menu.running,
            onSelect: () => onResumeOptions?.(menu.session)
          }
        ]}
        label={t('shell.topbar.session-actions')}
        onClose={closeMenu}
      />
    ),
    openFromKeyboard,
    openFromPointer
  };
}
