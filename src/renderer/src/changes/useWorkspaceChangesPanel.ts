import { useEffect, useRef, useState } from 'react';

import type { ChangesSource } from '../../../shared/contracts';
import { type ChangesPanelMode } from './ChangesPanelContent';
import { useToggleChangesRequest } from './changes-shortcut';
import {
  useChangesPanelControls,
  type ChangesButtonProps
} from './useChangesPanelControls';

/** Asks a workspace page to open its changes panel; a new key opens it again. */
export interface WorkspaceChangesRequest {
  workspaceId: string;
  mode: 'history';
  highlightSessionId: string | null;
  key: number;
}

interface WorkspaceChangesPanelOptions {
  enabled: boolean;
  /** True while this page is the one in front, so it answers the shortcut. */
  inFront?: boolean;
  workspaceId: string;
  request: WorkspaceChangesRequest | null;
  /** Told which request opened the panel, so the caller can drop it. */
  onRequestHandled?: ((key: number) => void) | undefined;
}

interface Opened {
  workspaceId: string;
  mode: ChangesPanelMode;
  highlightSessionId: string | null;
  /** Remounts the panel each time it opens so it starts in the asked mode. */
  panelKey: string;
}

export interface WorkspaceChangesPanelProps {
  id: string;
  panelKey: string;
  source: ChangesSource;
  initialMode: ChangesPanelMode;
  maximized: boolean;
  highlightSessionId: string | null;
  onClose(): void;
  onMaximizedChange(maximized: boolean): void;
}

export interface WorkspaceChangesPanel {
  /** Classes for the workspace section, each with a leading space. */
  className: string;
  buttonProps: ChangesButtonProps;
  /** Null while the panel is closed. */
  panelProps: WorkspaceChangesPanelProps | null;
}

/** Keeps whether a workspace page shows its changes panel and in which mode it opened. */
export function useWorkspaceChangesPanel({
  enabled,
  inFront = false,
  onRequestHandled,
  request,
  workspaceId
}: WorkspaceChangesPanelOptions): WorkspaceChangesPanel {
  const [opened, setOpened] = useState<Opened | null>(null);
  const [handledKey, setHandledKey] = useState<number | null>(null);
  const [openCount, setOpenCount] = useState(0);
  const shown = enabled && opened !== null && opened.workspaceId === workspaceId ? opened : null;
  const controls = useChangesPanelControls({ isOpen: shown !== null, ownerKey: workspaceId });

  if (enabled && request !== null && request.workspaceId === workspaceId && request.key !== handledKey) {
    setHandledKey(request.key);
    setOpened({
      workspaceId,
      mode: request.mode,
      highlightSessionId: request.highlightSessionId,
      panelKey: `request-${request.key}`
    });
    controls.setMaximized(false);
  }

  const handled = useRef(onRequestHandled);
  useEffect(() => {
    handled.current = onRequestHandled;
  }, [onRequestHandled]);
  useEffect(() => {
    if (handledKey !== null) handled.current?.(handledKey);
  }, [handledKey]);

  const close = () => {
    setOpened(null);
    controls.setMaximized(false);
  };

  const toggle = () => {
    if (shown !== null) {
      close();
      return;
    }
    const count = openCount + 1;
    setOpenCount(count);
    setOpened({ workspaceId, mode: 'changes', highlightSessionId: null, panelKey: `open-${count}` });
  };

  useToggleChangesRequest(inFront && enabled, toggle);

  return {
    className: controls.className,
    buttonProps: controls.buttonProps(toggle),
    panelProps: shown === null ? null : {
      id: controls.panelId,
      panelKey: `${shown.workspaceId}:${shown.panelKey}`,
      source: { kind: 'workspace', workspaceId: shown.workspaceId },
      initialMode: shown.mode,
      maximized: controls.maximized,
      highlightSessionId: shown.highlightSessionId,
      onClose: close,
      onMaximizedChange: controls.setMaximized
    }
  };
}
