import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { CatalogSnapshot, SessionSummary } from '../../../shared/contracts';
import { useWorkspaceChangesNavigation } from './useWorkspaceChangesNavigation';

const session = {
  id: 'session-1',
  title: 'Catalog implementation',
  workspaceId: 'ws-1'
} as SessionSummary;

const snapshot = {
  refreshedAt: '2026-09-15T00:00:00.000Z',
  workspaces: [],
  sessions: [session, { ...session, id: 'session-2', title: 'Other work' }],
  providerStatus: [],
  providerFacets: [],
  diagnostics: []
} as unknown as CatalogSnapshot;

interface Props {
  shownWorkspaceId: string | null;
  /** Defaults to the shown page, which is what a loaded workspace looks like. */
  selectedWorkspaceId?: string | null;
  snapshot?: CatalogSnapshot | null;
}

function setup(initial: Props = { shownWorkspaceId: null }) {
  const openWorkspace = vi.fn();
  const view = renderHook(
    (props: Props) => useWorkspaceChangesNavigation({
      openWorkspace,
      selectedWorkspaceId: props.selectedWorkspaceId === undefined
        ? props.shownWorkspaceId
        : props.selectedWorkspaceId,
      shownWorkspaceId: props.shownWorkspaceId,
      snapshot: props.snapshot === undefined ? snapshot : props.snapshot
    }),
    { initialProps: initial }
  );
  return { ...view, openWorkspace };
}

describe('useWorkspaceChangesNavigation', () => {
  it('opens the workspace page and asks it for the session history', () => {
    const { openWorkspace, result } = setup();

    act(() => result.current.viewSessionChanges(session));

    expect(openWorkspace).toHaveBeenCalledWith('ws-1');
    expect(result.current.request).toEqual({
      workspaceId: 'ws-1',
      mode: 'history',
      highlightSessionId: 'session-1',
      key: 1
    });
  });

  it('only asks again when that workspace page is already shown', () => {
    const { openWorkspace, result } = setup({ shownWorkspaceId: 'ws-1' });

    act(() => result.current.viewSessionChanges(session));
    expect(openWorkspace).not.toHaveBeenCalled();
    expect(result.current.request?.key).toBe(1);

    act(() => result.current.viewSessionChanges({ ...session, id: 'session-2' }));
    expect(openWorkspace).not.toHaveBeenCalled();
    expect(result.current.request).toMatchObject({ highlightSessionId: 'session-2', key: 2 });
  });

  it('drops the request once the page has opened it', () => {
    const { result } = setup({ shownWorkspaceId: 'ws-1' });
    act(() => result.current.viewSessionChanges(session));
    const key = result.current.request?.key ?? 0;

    act(() => result.current.onRequestHandled(key + 1));
    expect(result.current.request).not.toBeNull();

    act(() => result.current.onRequestHandled(key));
    expect(result.current.request).toBeNull();
  });

  it('drops a request the user navigated away from', () => {
    const { rerender, result } = setup({ shownWorkspaceId: null });
    act(() => result.current.viewSessionChanges(session));

    rerender({ shownWorkspaceId: 'ws-1' });
    expect(result.current.request).not.toBeNull();

    rerender({ shownWorkspaceId: null });
    expect(result.current.request).toBeNull();
  });

  it('drops a request when its workspace page is left before it is ready', () => {
    const { rerender, result } = setup({ shownWorkspaceId: null });
    act(() => result.current.viewSessionChanges(session));

    rerender({ shownWorkspaceId: null, selectedWorkspaceId: 'ws-1' });
    expect(result.current.request).not.toBeNull();

    rerender({ shownWorkspaceId: null, selectedWorkspaceId: null });
    expect(result.current.request).toBeNull();

    rerender({ shownWorkspaceId: 'ws-1', selectedWorkspaceId: 'ws-1' });
    expect(result.current.request).toBeNull();
  });

  it('keeps a request while its workspace page reloads', () => {
    const { rerender, result } = setup({ shownWorkspaceId: 'ws-1' });
    act(() => result.current.viewSessionChanges(session));

    rerender({ shownWorkspaceId: null, selectedWorkspaceId: 'ws-1' });
    expect(result.current.request).not.toBeNull();

    rerender({ shownWorkspaceId: 'ws-1', selectedWorkspaceId: 'ws-1' });
    expect(result.current.request).not.toBeNull();
  });

  it('reads titles from the shown catalog and keeps the lookup stable', () => {
    const { rerender, result } = setup({ shownWorkspaceId: 'ws-1' });
    const lookup = result.current.sessionTitle;
    expect(lookup('session-1')).toBe('Catalog implementation');
    expect(lookup('missing')).toBeNull();

    rerender({ shownWorkspaceId: 'ws-1' });
    expect(result.current.sessionTitle).toBe(lookup);

    rerender({ shownWorkspaceId: 'ws-1', snapshot: null });
    expect(result.current.sessionTitle).not.toBe(lookup);
    expect(result.current.sessionTitle('session-1')).toBeNull();
  });
});
