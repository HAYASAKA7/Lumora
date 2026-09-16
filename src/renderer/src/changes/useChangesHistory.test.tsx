import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { ChangesHistory } from '../../../shared/contracts';
import { fakeChangesApi } from '../test/changes-test-support';
import { useChangesHistory } from './useChangesHistory';

const oneSegment: ChangesHistory = {
  segments: [{
    ownerId: 'owner-1',
    ownerKind: 'terminal',
    catalogSessionId: null,
    createdAt: '2026-09-15T00:00:00.000Z',
    endedAt: null,
    reviews: []
  }]
};

describe('useChangesHistory', () => {
  it('loads nothing while inactive and loads once active', async () => {
    const { api } = fakeChangesApi();
    const { result, rerender } = renderHook(({ active }) => useChangesHistory(api, 'ws-1', active), {
      initialProps: { active: false }
    });
    await act(async () => undefined);
    expect(api.getChangesHistory).not.toHaveBeenCalled();
    expect(result.current.history).toEqual({ state: 'loading' });

    rerender({ active: true });
    await waitFor(() => expect(result.current.history).toEqual({ state: 'ready', value: { segments: [] } }));
    expect(api.getChangesHistory).toHaveBeenCalledWith('ws-1');
  });

  it('loads nothing without a workspace', async () => {
    const { api } = fakeChangesApi();
    const { result } = renderHook(() => useChangesHistory(api, null, true));
    await act(async () => undefined);
    expect(api.getChangesHistory).not.toHaveBeenCalled();
    expect(result.current.history).toEqual({ state: 'loading' });
    expect(result.current.refreshing).toBe(false);
  });

  it('reports a failed load', async () => {
    const { api } = fakeChangesApi();
    api.getChangesHistory.mockRejectedValue(new Error('broken'));
    const { result } = renderHook(() => useChangesHistory(api, 'ws-1', true));
    await waitFor(() => expect(result.current.history).toEqual({ state: 'error' }));
  });

  it('keeps the shown history while a reload runs and marks it refreshing', async () => {
    const { api } = fakeChangesApi();
    const { result } = renderHook(() => useChangesHistory(api, 'ws-1', true));
    await waitFor(() => expect(result.current.history.state).toBe('ready'));

    let finish!: (value: ChangesHistory) => void;
    api.getChangesHistory.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    act(() => result.current.reload());
    expect(result.current.refreshing).toBe(true);
    expect(result.current.history).toEqual({ state: 'ready', value: { segments: [] } });

    await act(async () => finish(oneSegment));
    expect(result.current.refreshing).toBe(false);
    expect(result.current.history).toEqual({ state: 'ready', value: oneSegment });
  });

  it('drops a response for a workspace no longer shown', async () => {
    const { api } = fakeChangesApi();
    let finishFirst!: (value: ChangesHistory) => void;
    api.getChangesHistory
      .mockImplementationOnce(() => new Promise((resolve) => { finishFirst = resolve; }))
      .mockResolvedValueOnce({ segments: [] });
    const { result, rerender } = renderHook(({ workspaceId }) => useChangesHistory(api, workspaceId, true), {
      initialProps: { workspaceId: 'ws-1' }
    });
    rerender({ workspaceId: 'ws-2' });
    await waitFor(() => expect(result.current.history.state).toBe('ready'));
    await act(async () => finishFirst(oneSegment));
    expect(result.current.history).toEqual({ state: 'ready', value: { segments: [] } });
    expect(api.getChangesHistory).toHaveBeenLastCalledWith('ws-2');
  });
});
