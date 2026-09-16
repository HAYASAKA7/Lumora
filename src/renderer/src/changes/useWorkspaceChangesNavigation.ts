import { useCallback, useMemo, useRef, useState } from 'react';

import type { CatalogSnapshot, SessionSummary } from '../../../shared/contracts';
import type { WorkspaceChangesRequest } from './useWorkspaceChangesPanel';

interface WorkspaceChangesNavigationOptions {
  /** The workspace page on screen with its sessions loaded, else null. */
  shownWorkspaceId: string | null;
  /** The sessions behind that page; titles come from here. */
  snapshot: CatalogSnapshot | null;
  /** Shows a workspace's page; not called when that page is already on screen. */
  openWorkspace(workspaceId: string): void;
}

export interface WorkspaceChangesNavigation {
  /** Passed to the workspace page; null once the page has opened it. */
  request: WorkspaceChangesRequest | null;
  onRequestHandled(key: number): void;
  sessionTitle(catalogSessionId: string): string | null;
  viewSessionChanges(session: SessionSummary): void;
}

/**
 * Takes a session to its workspace's changes. The page keeps the request only
 * until it opens the panel, and a request for a workspace the user has left is
 * dropped rather than opening the panel when that page comes back.
 */
export function useWorkspaceChangesNavigation({
  openWorkspace,
  shownWorkspaceId,
  snapshot
}: WorkspaceChangesNavigationOptions): WorkspaceChangesNavigation {
  const [request, setRequest] = useState<WorkspaceChangesRequest | null>(null);
  const [trackedWorkspaceId, setTrackedWorkspaceId] = useState(shownWorkspaceId);
  const lastKey = useRef(0);

  if (trackedWorkspaceId !== shownWorkspaceId) {
    setTrackedWorkspaceId(shownWorkspaceId);
    if (request !== null && request.workspaceId !== shownWorkspaceId) setRequest(null);
  }

  const titles = useMemo(
    () => new Map((snapshot?.sessions ?? []).map((session) => [session.id, session.title])),
    [snapshot]
  );

  const sessionTitle = useCallback(
    (catalogSessionId: string) => titles.get(catalogSessionId) ?? null,
    [titles]
  );

  const onRequestHandled = useCallback(
    (key: number) => setRequest((current) => (current !== null && current.key === key ? null : current)),
    []
  );

  const viewSessionChanges = useCallback((session: SessionSummary) => {
    if (shownWorkspaceId !== session.workspaceId) openWorkspace(session.workspaceId);
    lastKey.current += 1;
    setRequest({
      workspaceId: session.workspaceId,
      mode: 'history',
      highlightSessionId: session.id,
      key: lastKey.current
    });
  }, [openWorkspace, shownWorkspaceId]);

  return { request, onRequestHandled, sessionTitle, viewSessionChanges };
}
