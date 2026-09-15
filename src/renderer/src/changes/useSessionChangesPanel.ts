import { useCallback, useEffect, useId, useRef, useState, type RefObject } from 'react';

import type { ChangesSource } from '../../../shared/contracts';

interface SessionChangesPanelOptions {
  /** False where changes are not offered, such as a remote computer's sessions. */
  enabled: boolean;
  /** The active session's owner id; undefined while no session is shown. */
  ownerId: string | undefined;
}

export interface SessionChangesButtonProps {
  ref: RefObject<HTMLButtonElement | null>;
  'aria-controls': string;
  'aria-expanded': boolean;
  onClick(): void;
}

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

type FocusRequest = 'panel' | 'button' | null;

const LIST_TAB_STOP = '.changes-file-select[tabindex="0"]';

function firstPanelTarget(panel: HTMLElement): HTMLElement | null {
  return panel.querySelector<HTMLElement>(LIST_TAB_STOP) ??
    panel.querySelector<HTMLElement>('.changes-panel-actions .close-button');
}

/**
 * Moves focus from the close button to the file list when the list first
 * appears, unless focus has moved on by then. Returns a cleanup.
 */
function focusListWhenLoaded(panel: HTMLElement, closeButton: HTMLElement): () => void {
  if (typeof MutationObserver === 'undefined') return () => undefined;
  const observer = new MutationObserver(() => {
    const tabStop = panel.querySelector<HTMLElement>(LIST_TAB_STOP);
    if (tabStop === null) return;
    observer.disconnect();
    if (panel.ownerDocument.activeElement === closeButton) tabStop.focus();
  });
  observer.observe(panel, { childList: true, subtree: true });
  return () => observer.disconnect();
}

/**
 * Keeps which sessions have their changes panel open, so each session tab
 * shows its own panel state. Opening moves focus into the panel: to the file
 * list when it is already shown, otherwise to the close button and then on to
 * the file list once it first loads if focus is still on the close button.
 * Closing from the panel's own controls returns focus to the Changes button.
 */
export function useSessionChangesPanel({ enabled, ownerId }: SessionChangesPanelOptions): SessionChangesPanel {
  const panelId = useId();
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const [openOwners, setOpenOwners] = useState<ReadonlySet<string>>(() => new Set());
  const [maximizedOwner, setMaximizedOwner] = useState<string | null>(null);
  const focusRequest = useRef<FocusRequest>(null);
  const [shownOwner, setShownOwner] = useState(ownerId);
  if (shownOwner !== ownerId) {
    // Another session's panel mounts fresh, so it starts beside the session.
    setShownOwner(ownerId);
    setMaximizedOwner(null);
  }

  const isOpen = enabled && ownerId !== undefined && openOwners.has(ownerId);
  const maximized = isOpen && maximizedOwner === ownerId;

  const setOwnerOpen = useCallback((owner: string, open: boolean) => {
    setOpenOwners((current) => {
      if (current.has(owner) === open) return current;
      const next = new Set(current);
      if (open) next.add(owner);
      else next.delete(owner);
      return next;
    });
    setMaximizedOwner((current) => (current === owner ? null : current));
  }, []);

  useEffect(() => {
    const request = focusRequest.current;
    if (request === null) return;
    focusRequest.current = null;
    if (request === 'button') {
      buttonRef.current?.focus();
      return;
    }
    const panel = buttonRef.current?.ownerDocument.getElementById(panelId);
    if (panel === null || panel === undefined) return undefined;
    const target = firstPanelTarget(panel);
    target?.focus();
    return target === null || target.matches(LIST_TAB_STOP) ? undefined : focusListWhenLoaded(panel, target);
  }, [isOpen, panelId]);

  const toggle = () => {
    if (!enabled || ownerId === undefined) return;
    focusRequest.current = isOpen ? null : 'panel';
    setOwnerOpen(ownerId, !isOpen);
  };

  const panelProps: SessionChangesPanelProps | null = !isOpen || ownerId === undefined ? null : {
    id: panelId,
    source: { kind: 'session', ownerId, view: 'session' },
    onClose: () => {
      focusRequest.current = 'button';
      setOwnerOpen(ownerId, false);
    },
    onMaximizedChange: (next) => setMaximizedOwner(next ? ownerId : null)
  };

  return {
    isOpen,
    maximized,
    workspaceClassName: `${isOpen ? ' has-changes-panel' : ''}${maximized ? ' changes-maximized' : ''}`,
    toggle,
    buttonProps: {
      ref: buttonRef,
      'aria-controls': panelId,
      'aria-expanded': isOpen,
      onClick: toggle
    },
    panelProps
  };
}
