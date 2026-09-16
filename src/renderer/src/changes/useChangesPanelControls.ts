import { useId, useRef, useState, type RefObject } from 'react';

export interface ChangesButtonProps {
  ref: RefObject<HTMLButtonElement | null>;
  'aria-controls': string;
  'aria-expanded': boolean;
  onClick(): void;
}

interface ChangesPanelControlsOptions {
  /** What the panel belongs to; a different owner starts its panel restored. */
  ownerKey: string | undefined;
  isOpen: boolean;
}

export interface ChangesPanelControls {
  panelId: string;
  maximized: boolean;
  setMaximized(maximized: boolean): void;
  /** Classes for the panel's host, each with a leading space. */
  className: string;
  buttonProps(onClick: () => void): ChangesButtonProps;
}

/**
 * Open and maximize handling shared by every host of a changes panel.
 *
 * Opening the panel moves no focus. Lumora does not leave focus sitting on a
 * button, and the panel is there to be read: whatever the person was typing in
 * keeps the keyboard.
 */
export function useChangesPanelControls({ isOpen, ownerKey }: ChangesPanelControlsOptions): ChangesPanelControls {
  const panelId = useId();
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const [maximizedOwner, setMaximizedOwner] = useState<string | null>(null);
  const [shownOwner, setShownOwner] = useState(ownerKey);

  if (shownOwner !== ownerKey) {
    setShownOwner(ownerKey);
    setMaximizedOwner(null);
  }

  const maximized = isOpen && ownerKey !== undefined && maximizedOwner === ownerKey;

  return {
    panelId,
    maximized,
    setMaximized: (next) => setMaximizedOwner(next && ownerKey !== undefined ? ownerKey : null),
    className: `${isOpen ? ' has-changes-panel' : ''}${maximized ? ' changes-maximized' : ''}`,
    buttonProps: (onClick) => ({
      ref: buttonRef,
      'aria-controls': panelId,
      'aria-expanded': isOpen,
      onClick
    })
  };
}
