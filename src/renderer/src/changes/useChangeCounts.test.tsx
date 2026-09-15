import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { ChangesCount } from '../../../shared/contracts';
import { useChangeCounts } from './useChangeCounts';

function count(ownerId: string, changedFileCount: number): ChangesCount {
  return { ownerId, workspaceId: 'ws-1', state: 'ready', changedFileCount };
}

function fakeApi(load: () => Promise<ChangesCount[]>) {
  let listener: ((value: ChangesCount) => void) | undefined;
  const unsubscribe = vi.fn();
  const api = {
    getChangesCounts: vi.fn(load),
    onChangesCount: vi.fn((next: (value: ChangesCount) => void) => {
      listener = next;
      return unsubscribe;
    })
  };
  return { api, emit: (value: ChangesCount) => listener?.(value), unsubscribe };
}

describe('useChangeCounts', () => {
  it('loads the counts once and follows count events', async () => {
    const { api, emit, unsubscribe } = fakeApi(async () => [count('r1', 2), count('c1', 0)]);
    const { result, unmount } = renderHook(() => useChangeCounts(api));

    await waitFor(() => expect(result.current.get('r1')).toBe(2));
    expect(result.current.get('c1')).toBe(0);

    const before = result.current;
    act(() => emit(count('r1', 5)));
    expect(result.current.get('r1')).toBe(5);
    expect(before.get('r1')).toBe(2);

    unmount();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
    expect(api.getChangesCounts).toHaveBeenCalledTimes(1);
  });

  it('keeps the same map when a count event repeats the known count', async () => {
    const { api, emit } = fakeApi(async () => [count('r1', 2)]);
    const { result } = renderHook(() => useChangeCounts(api));
    await waitFor(() => expect(result.current.get('r1')).toBe(2));
    const before = result.current;

    // The same map lets React bail out, so the workspaces do not re-render.
    act(() => emit(count('r1', 2)));
    expect(result.current).toBe(before);

    act(() => emit(count('r1', 3)));
    expect(result.current).not.toBe(before);
  });

  it('keeps an event that arrives before the load finishes', async () => {
    let finish!: (counts: ChangesCount[]) => void;
    const { api, emit } = fakeApi(() => new Promise((resolve) => { finish = resolve; }));
    const { result } = renderHook(() => useChangeCounts(api));

    act(() => emit(count('r1', 7)));
    await act(async () => finish([count('r1', 1), count('r2', 3)]));

    expect(result.current.get('r1')).toBe(7);
    expect(result.current.get('r2')).toBe(3);
  });

  it('ignores a failed load', async () => {
    const { api } = fakeApi(async () => {
      throw new Error('unavailable');
    });
    const { result } = renderHook(() => useChangeCounts(api));
    await act(async () => undefined);
    expect(result.current.size).toBe(0);
  });
});
