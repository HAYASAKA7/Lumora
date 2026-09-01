import {
  useCallback,
  useEffect,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode
} from 'react';

import type {
  AgentInteractionRoute,
  SessionSummary
} from '../../../shared/contracts';
import { ContextMenu, type ContextMenuItem } from '../ui/ContextMenu';
import { useLocalization } from '../localization/useLocalization';
import { useSessionRouteChoice } from './SessionRouteChoiceContext';

interface SessionMenuState {
  anchor: { x: number; y: number };
  disabledReason: string | null;
  running: boolean;
  session: SessionSummary;
}

interface SessionResumeContextMenuOptions {
  onResume?: ((
    session: SessionSummary,
    interactionRoute: AgentInteractionRoute
  ) => void) | undefined;
  onResumeOptions?: ((session: SessionSummary) => void) | undefined;
}

const UNIFIED_REASON_KEYS = {
  unavailable: 'terminal.direct.unified-unavailable',
  incompatible: 'terminal.direct.unified-incompatible',
  failed: 'terminal.direct.unified-failed',
  timed_out: 'terminal.direct.unified-timed-out',
  resume_unsupported: 'terminal.direct.unified-resume-unsupported'
} as const;

function SessionResumeMenu({
  closeMenu,
  menu,
  onResume,
  onResumeOptions
}: {
  closeMenu(): void;
  menu: SessionMenuState;
  onResume: SessionResumeContextMenuOptions['onResume'];
  onResumeOptions: SessionResumeContextMenuOptions['onResumeOptions'];
}): ReactNode {
  const { t } = useLocalization();
  const unifiedChoice = useSessionRouteChoice(menu.session.provider);

  useEffect(() => {
    if (!menu.running) unifiedChoice.resolve();
  }, [menu.running, unifiedChoice.resolve]);

  const items: readonly ContextMenuItem[] = menu.running
    ? [{
        id: 'open-running',
        label: t('common.actions.open'),
        disabled: onResume === undefined,
        onSelect: () => onResume?.(menu.session, 'automatic')
      }]
    : [
        ...(unifiedChoice.visibility === 'visible'
          ? [{
              id: 'resume-unified',
              label: t('terminal.direct.open-unified'),
              disabled:
                onResume === undefined ||
                menu.disabledReason !== null ||
                unifiedChoice.state !== 'available',
              ...(() => {
                const description = menu.disabledReason ?? (
                  unifiedChoice.state === 'checking'
                    ? t('terminal.direct.unified-checking')
                    : unifiedChoice.state === 'unavailable'
                      ? t(UNIFIED_REASON_KEYS[unifiedChoice.reason])
                      : null
                );
                return description === null ? {} : { description };
              })(),
              onSelect: () => onResume?.(menu.session, 'unified')
            }]
          : []),
        {
          id: 'resume-pty',
          label: t('terminal.direct.open-native-terminal'),
          disabled: onResume === undefined || menu.disabledReason !== null,
          ...(menu.disabledReason === null
            ? {}
            : { description: menu.disabledReason }),
          onSelect: () => onResume?.(menu.session, 'pty')
        },
        {
          id: 'resume-options',
          label: t('terminal.direct.resume-options'),
          disabled: onResumeOptions === undefined,
          onSelect: () => onResumeOptions?.(menu.session)
        }
      ];

  return (
    <ContextMenu
      anchor={menu.anchor}
      items={items}
      label={t('shell.topbar.session-actions')}
      onClose={closeMenu}
    />
  );
}

export function useSessionResumeContextMenu({
  onResume,
  onResumeOptions
}: SessionResumeContextMenuOptions) {
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
      <SessionResumeMenu
        closeMenu={closeMenu}
        menu={menu}
        onResume={onResume}
        onResumeOptions={onResumeOptions}
      />
    ),
    openFromKeyboard,
    openFromPointer
  };
}
