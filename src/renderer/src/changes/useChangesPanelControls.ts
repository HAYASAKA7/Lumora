import { useEffect, useId, useRef, useState, type RefObject } from 'react';

/**
 * Where focus lands when a panel opens: the target when it is already shown,
 * otherwise the fallback, moving on to the target once it appears if focus is
 * still on the fallback. Watching stops once the settled selector matches.
 */
export interface PanelFocusPlan {
  target: string;
  fallback: string;
  settled?: string;
}

export const FILE_LIST_FOCUS: PanelFocusPlan = {
  target: '.changes-file-select[tabindex="0"]',
  fallback: '.changes-panel-actions .close-button'
};

type FocusRequest = { to: 'panel'; plan: PanelFocusPlan } | { to: 'button' };

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
  /** Moves focus into the panel after the next render. */
  focusPanel(plan?: PanelFocusPlan): void;
  /** Returns focus to the Changes button after the next render. */
  focusButton(): void;
  buttonProps(onClick: () => void): ChangesButtonProps;
}

function watchForTarget(panel: HTMLElement, plan: PanelFocusPlan, fallback: HTMLElement): () => void {
  if (typeof MutationObserver === 'undefined') return () => undefined;
  const observer = new MutationObserver(() => {
    const target = panel.querySelector<HTMLElement>(plan.target);
    if (target !== null) {
      observer.disconnect();
      if (panel.ownerDocument.activeElement === fallback) target.focus();
      return;
    }
    if (plan.settled !== undefined && panel.querySelector(plan.settled) !== null) observer.disconnect();
  });
  observer.observe(panel, { childList: true, subtree: true });
  return () => observer.disconnect();
}

/** Open, maximize and focus handling shared by every host of a changes panel. */
export function useChangesPanelControls({ isOpen, ownerKey }: ChangesPanelControlsOptions): ChangesPanelControls {
  const panelId = useId();
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const [maximizedOwner, setMaximizedOwner] = useState<string | null>(null);
  const [shownOwner, setShownOwner] = useState(ownerKey);
  const [focusRequest, setFocusRequest] = useState<FocusRequest | null>(null);

  if (shownOwner !== ownerKey) {
    setShownOwner(ownerKey);
    setMaximizedOwner(null);
  }

  useEffect(() => {
    if (focusRequest === null) return undefined;
    if (focusRequest.to === 'button') {
      buttonRef.current?.focus();
      return undefined;
    }
    const panel = (buttonRef.current?.ownerDocument ?? document).getElementById(panelId);
    if (panel === null) return undefined;
    const { plan } = focusRequest;
    const target = panel.querySelector<HTMLElement>(plan.target);
    if (target !== null) {
      target.focus();
      return undefined;
    }
    const fallback = panel.querySelector<HTMLElement>(plan.fallback);
    if (fallback === null) return undefined;
    fallback.focus();
    return watchForTarget(panel, plan, fallback);
  }, [focusRequest, panelId]);

  const maximized = isOpen && ownerKey !== undefined && maximizedOwner === ownerKey;

  return {
    panelId,
    maximized,
    setMaximized: (next) => setMaximizedOwner(next && ownerKey !== undefined ? ownerKey : null),
    className: `${isOpen ? ' has-changes-panel' : ''}${maximized ? ' changes-maximized' : ''}`,
    focusPanel: (plan = FILE_LIST_FOCUS) => setFocusRequest({ to: 'panel', plan }),
    focusButton: () => setFocusRequest({ to: 'button' }),
    buttonProps: (onClick) => ({
      ref: buttonRef,
      'aria-controls': panelId,
      'aria-expanded': isOpen,
      onClick
    })
  };
}
