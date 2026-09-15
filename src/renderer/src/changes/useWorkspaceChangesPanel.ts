import { useEffect, useId, useRef, useState, type RefObject } from 'react';

import type { ChangesSource } from '../../../shared/contracts';
import type { ChangesPanelMode } from './ChangesPanelContent';

/** Asks a workspace page to open its changes panel; a new key opens it again. */
export interface WorkspaceChangesRequest {
  workspaceId: string;
  mode: 'history';
  highlightSessionId: string | null;
  key: number;
}

interface WorkspaceChangesPanelOptions {
  enabled: boolean;
  workspaceId: string;
  request: WorkspaceChangesRequest | null;
}

interface Opened {
  workspaceId: string;
  mode: ChangesPanelMode;
  highlightSessionId: string | null;
  /** Remounts the panel each time it opens so it starts in the asked mode. */
  generation: number;
}

export interface WorkspaceChangesPanelProps {
  id: string;
  panelKey: string;
  source: ChangesSource;
  initialMode: ChangesPanelMode;
  highlightSessionId: string | null;
  onClose(): void;
  onMaximizedChange(maximized: boolean): void;
}

export interface WorkspaceChangesPanel {
  /** Classes for the workspace section, each with a leading space. */
  className: string;
  buttonProps: {
    ref: RefObject<HTMLButtonElement | null>;
    'aria-controls': string;
    'aria-expanded': boolean;
    onClick(): void;
  };
  /** Null while the panel is closed. */
  panelProps: WorkspaceChangesPanelProps | null;
}

/** Keeps whether a workspace page shows its changes panel and in which mode it opened. */
export function useWorkspaceChangesPanel({ enabled, request, workspaceId }: WorkspaceChangesPanelOptions): WorkspaceChangesPanel {
  const panelId = useId();
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const [opened, setOpened] = useState<Opened | null>(null);
  const [maximized, setMaximized] = useState(false);
  const [handledKey, setHandledKey] = useState<number | null>(null);
  const [focusButton, setFocusButton] = useState(false);
  const generation = useRef(0);

  if (enabled && request !== null && request.workspaceId === workspaceId && request.key !== handledKey) {
    setHandledKey(request.key);
    generation.current += 1;
    setMaximized(false);
    setOpened({
      workspaceId,
      mode: request.mode,
      highlightSessionId: request.highlightSessionId,
      generation: generation.current
    });
  }

  useEffect(() => {
    if (!focusButton) return;
    setFocusButton(false);
    buttonRef.current?.focus();
  }, [focusButton]);

  const shown = enabled && opened !== null && opened.workspaceId === workspaceId ? opened : null;

  const close = (returnFocus: boolean) => {
    setOpened(null);
    setMaximized(false);
    if (returnFocus) setFocusButton(true);
  };

  const toggle = () => {
    if (shown !== null) {
      close(false);
      return;
    }
    generation.current += 1;
    setOpened({ workspaceId, mode: 'changes', highlightSessionId: null, generation: generation.current });
  };

  return {
    className: `${shown === null ? '' : ' has-changes-panel'}${shown !== null && maximized ? ' changes-maximized' : ''}`,
    buttonProps: {
      ref: buttonRef,
      'aria-controls': panelId,
      'aria-expanded': shown !== null,
      onClick: toggle
    },
    panelProps: shown === null ? null : {
      id: panelId,
      panelKey: `${shown.workspaceId}:${shown.generation}`,
      source: { kind: 'workspace', workspaceId: shown.workspaceId },
      initialMode: shown.mode,
      highlightSessionId: shown.highlightSessionId,
      onClose: () => close(true),
      onMaximizedChange: setMaximized
    }
  };
}
