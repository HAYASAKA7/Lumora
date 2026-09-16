import { useCallback, useState } from 'react';

import type { ChangesSource } from '../../../shared/contracts';
import {
  useChangesPanelControls,
  type ChangesButtonProps
} from './useChangesPanelControls';

interface SessionChangesPanelOptions {
  /** False where changes are not offered, such as a remote computer's sessions. */
  enabled: boolean;
  /** The active session's owner id; undefined while no session is shown. */
  ownerId: string | undefined;
}

export type SessionChangesButtonProps = ChangesButtonProps;

export interface SessionChangesPanelProps {
  id: string;
  source: ChangesSource;
  onClose(): void;
  onMaximizedChange(maximized: boolean): void;
}

export interface SessionChangesPanel {
  /** True while the active session's panel is shown. */
  isOpen: boolean;
  /** True while the shown panel fills the session. */
  maximized: boolean;
  /** Classes for the session's workspace section, each with a leading space. */
  workspaceClassName: string;
  toggle(): void;
  buttonProps: SessionChangesButtonProps;
  /** Null while the active session's panel is closed. */
  panelProps: SessionChangesPanelProps | null;
}

/**
 * Keeps which sessions have their changes panel open, so each session tab
 * shows its own panel state. Opening moves focus into the panel and closing
 * from the panel's own controls returns it to the Changes button.
 */
export function useSessionChangesPanel({ enabled, ownerId }: SessionChangesPanelOptions): SessionChangesPanel {
  const [openOwners, setOpenOwners] = useState<ReadonlySet<string>>(() => new Set());
  const isOpen = enabled && ownerId !== undefined && openOwners.has(ownerId);
  const controls = useChangesPanelControls({ isOpen, ownerKey: ownerId });

  const setOwnerOpen = useCallback((owner: string, open: boolean) => {
    setOpenOwners((current) => {
      if (current.has(owner) === open) return current;
      const next = new Set(current);
      if (open) next.add(owner);
      else next.delete(owner);
      return next;
    });
  }, []);

  const toggle = () => {
    if (!enabled || ownerId === undefined) return;
    if (!isOpen) controls.focusPanel();
    controls.setMaximized(false);
    setOwnerOpen(ownerId, !isOpen);
  };

  const panelProps: SessionChangesPanelProps | null = !isOpen || ownerId === undefined ? null : {
    id: controls.panelId,
    source: { kind: 'session', ownerId, view: 'session' },
    onClose: () => {
      controls.focusButton();
      controls.setMaximized(false);
      setOwnerOpen(ownerId, false);
    },
    onMaximizedChange: controls.setMaximized
  };

  return {
    isOpen,
    maximized: controls.maximized,
    workspaceClassName: controls.className,
    toggle,
    buttonProps: controls.buttonProps(toggle),
    panelProps
  };
}
