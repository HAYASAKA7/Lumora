import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type {
  ChangedFile,
  ChangesCount,
  ChangesFileDiff,
  ChangesSource,
  ChangesSummary
} from '../../../shared/contracts';
import { useWorkspaceChanges, type ChangesApi } from './useWorkspaceChanges';

const sessionSource: ChangesSource = { kind: 'session', ownerId: 'owner-1', view: 'session' };

function file(path: string): ChangedFile {
  return { path, oldPath: null, status: 'modified', additions: 1, deletions: 0, binary: false };
}

function summary(paths: readonly string[], source: ChangesSource = sessionSource): ChangesSummary {
  return {
    source,
    workspaceId: 'ws-1',
    state: 'ready',
    unavailableReason: null,
    baselineLate: false,
    sharedWorkspace: false,
    files: paths.map(file),
    committed: [],
    truncated: false,
    checkedAt: '2026-09-15T00:00:00.000Z'
  };
}

function fakeApi(initial: ChangesSummary = summary(['a.txt', 'b.txt'])) {
  const listeners = new Set<(count: ChangesCount) => void>();
  const unsubscribe = vi.fn();
  const api = {
    getChangesSummary: vi.fn(async (_source: ChangesSource) => initial),
    getChangesFileDiff: vi.fn(async (_source: ChangesSource, path: string): Promise<ChangesFileDiff> => ({
      path,
      patch: `+${path}`,
      binary: false,
      truncated: false
    })),
    markChangesReviewed: vi.fn(async () => summary(['b.txt'])),
    openChangedFile: vi.fn(async () => undefined),
    writeClipboardText: vi.fn(async () => undefined),
    getChangesHistory: vi.fn(async () => ({ segments: [] })),
    onChangesCount: vi.fn((listener: (count: ChangesCount) => void) => {
      listeners.add(listener);
      return () => {
        unsubscribe();
        listeners.delete(listener);
      };
    })
  };
  const emit = (count: ChangesCount) => {
    for (const listener of listeners) listener(count);
  };
  return { api: api as unknown as ChangesApi & typeof api, emit, listeners, unsubscribe };
}

function count(ownerId: string, workspaceId = 'ws-1'): ChangesCount {
  return { ownerId, workspaceId, state: 'ready', changedFileCount: 1 };
}

describe('useWorkspaceChanges', () => {
  it('loads the summary while active', async () => {
    const { api } = fakeApi();
    const { result } = renderHook(() => useWorkspaceChanges(api, sessionSource, true));
    expect(result.current.summary).toEqual({ state: 'loading' });
    await waitFor(() => expect(result.current.summary.state).toBe('ready'));
    expect(api.getChangesSummary).toHaveBeenCalledWith(sessionSource);
    expect(result.current.diff).toBeNull();
  });

  it('does nothing while inactive', async () => {
    const { api, emit } = fakeApi();
    const { result } = renderHook(() => useWorkspaceChanges(api, sessionSource, false));
    await act(async () => {
      await result.current.reload();
    });
    act(() => emit(count('owner-1')));
    expect(api.getChangesSummary).not.toHaveBeenCalled();
    expect(api.onChangesCount).not.toHaveBeenCalled();
    expect(result.current.summary).toEqual({ state: 'loading' });
  });

  it('stops reacting to count events once inactive and keeps the last summary', async () => {
    const { api, emit } = fakeApi();
    const { result, rerender } = renderHook(
      ({ active }: { active: boolean }) => useWorkspaceChanges(api, sessionSource, active),
      { initialProps: { active: true } }
    );
    await waitFor(() => expect(result.current.summary.state).toBe('ready'));
    rerender({ active: false });
    act(() => emit(count('owner-1')));
    expect(api.getChangesSummary).toHaveBeenCalledTimes(1);
    expect(result.current.summary.state).toBe('ready');
    expect(result.current.refreshing).toBe(false);
  });

  it('reloads on a count event for its owner and ignores other owners', async () => {
    const { api, emit } = fakeApi();
    const { result } = renderHook(() => useWorkspaceChanges(api, sessionSource, true));
    await waitFor(() => expect(result.current.summary.state).toBe('ready'));
    expect(api.getChangesSummary).toHaveBeenCalledTimes(1);

    act(() => emit(count('someone-else')));
    expect(api.getChangesSummary).toHaveBeenCalledTimes(1);

    act(() => emit(count('owner-1')));
    await waitFor(() => expect(api.getChangesSummary).toHaveBeenCalledTimes(2));
  });

  it('unsubscribes from count events on unmount', async () => {
    const { api, listeners, unsubscribe } = fakeApi();
    const { unmount } = renderHook(() => useWorkspaceChanges(api, sessionSource, true));
    await waitFor(() => expect(listeners.size).toBe(1));
    unmount();
    expect(unsubscribe).toHaveBeenCalled();
    expect(listeners.size).toBe(0);
  });

  it('reloads a workspace source when a session in that workspace changes', async () => {
    const source: ChangesSource = { kind: 'workspace', workspaceId: 'ws-1' };
    const { api, emit } = fakeApi(summary(['a.txt'], source));
    const { result } = renderHook(() => useWorkspaceChanges(api, source, true));
    await waitFor(() => expect(result.current.summary.state).toBe('ready'));
    expect(api.getChangesSummary).toHaveBeenCalledTimes(1);

    act(() => emit(count('owner-1', 'ws-other')));
    expect(api.getChangesSummary).toHaveBeenCalledTimes(1);

    act(() => emit(count('owner-1')));
    await waitFor(() => expect(api.getChangesSummary).toHaveBeenCalledTimes(2));
  });

  it('does not subscribe to count events for a review, which never changes', async () => {
    const source: ChangesSource = { kind: 'review', reviewId: 'review-1' };
    const { api } = fakeApi(summary(['a.txt'], source));
    const { result } = renderHook(() => useWorkspaceChanges(api, source, true));
    await waitFor(() => expect(result.current.summary.state).toBe('ready'));
    expect(api.onChangesCount).not.toHaveBeenCalled();
  });

  it('loads the diff for the selected path', async () => {
    const { api } = fakeApi();
    const { result } = renderHook(() => useWorkspaceChanges(api, sessionSource, true));
    await waitFor(() => expect(result.current.summary.state).toBe('ready'));

    act(() => result.current.setSelectedPath('a.txt'));
    expect(result.current.selectedPath).toBe('a.txt');
    await waitFor(() => expect(result.current.diff?.state).toBe('ready'));
    expect(api.getChangesFileDiff).toHaveBeenCalledWith(sessionSource, 'a.txt');
    expect(result.current.diff).toEqual({
      state: 'ready',
      value: { path: 'a.txt', patch: '+a.txt', binary: false, truncated: false }
    });
  });

  it('fetches only the last of several quick selections', async () => {
    const { api } = fakeApi(summary(['a.txt', 'b.txt', 'c.txt']));
    const { result } = renderHook(() => useWorkspaceChanges(api, sessionSource, true));
    await waitFor(() => expect(result.current.summary.state).toBe('ready'));

    vi.useFakeTimers();
    try {
      act(() => result.current.setSelectedPath('a.txt'));
      act(() => vi.advanceTimersByTime(60));
      act(() => result.current.setSelectedPath('b.txt'));
      act(() => vi.advanceTimersByTime(60));
      act(() => result.current.setSelectedPath('c.txt'));
      expect(result.current.selectedPath).toBe('c.txt');
      expect(result.current.diff).toEqual({ state: 'loading' });
      act(() => vi.advanceTimersByTime(149));
      expect(api.getChangesFileDiff).not.toHaveBeenCalled();
      await act(async () => {
        vi.advanceTimersByTime(1);
      });
      expect(api.getChangesFileDiff).toHaveBeenCalledTimes(1);
      expect(api.getChangesFileDiff).toHaveBeenCalledWith(sessionSource, 'c.txt');
    } finally {
      vi.useRealTimers();
    }
  });

  it('refreshes the diff of the same path without waiting', async () => {
    const { api, emit } = fakeApi();
    const { result } = renderHook(() => useWorkspaceChanges(api, sessionSource, true));
    await waitFor(() => expect(result.current.summary.state).toBe('ready'));
    act(() => result.current.setSelectedPath('a.txt'));
    await waitFor(() => expect(result.current.diff?.state).toBe('ready'));

    vi.useFakeTimers();
    try {
      await act(async () => {
        emit(count('owner-1'));
      });
      await act(async () => {
        await Promise.resolve();
      });
      expect(api.getChangesFileDiff).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('reports a failed diff as an error', async () => {
    const { api } = fakeApi();
    api.getChangesFileDiff.mockRejectedValueOnce(new Error('nope'));
    const { result } = renderHook(() => useWorkspaceChanges(api, sessionSource, true));
    await waitFor(() => expect(result.current.summary.state).toBe('ready'));
    act(() => result.current.setSelectedPath('a.txt'));
    await waitFor(() => expect(result.current.diff).toEqual({ state: 'error' }));
  });

  it('marks paths reviewed, stores the new summary and clears a reviewed selection', async () => {
    const { api } = fakeApi();
    const { result } = renderHook(() => useWorkspaceChanges(api, sessionSource, true));
    await waitFor(() => expect(result.current.summary.state).toBe('ready'));
    act(() => result.current.setSelectedPath('a.txt'));

    await act(async () => {
      await result.current.markReviewed(['a.txt']);
    });

    expect(api.markChangesReviewed).toHaveBeenCalledWith('owner-1', ['a.txt']);
    expect(result.current.summary).toEqual({ state: 'ready', value: summary(['b.txt']) });
    expect(result.current.selectedPath).toBeNull();
    expect(result.current.diff).toBeNull();
  });

  it('does not mark reviews for non-session sources', async () => {
    const source: ChangesSource = { kind: 'review', reviewId: 'review-1' };
    const { api } = fakeApi(summary(['a.txt'], source));
    const { result } = renderHook(() => useWorkspaceChanges(api, source, true));
    await waitFor(() => expect(result.current.summary.state).toBe('ready'));
    await act(async () => {
      await result.current.markReviewed(['a.txt']);
    });
    expect(api.markChangesReviewed).not.toHaveBeenCalled();
  });

  it('does not mark reviews for the uncommitted view of a session', async () => {
    const source: ChangesSource = { kind: 'session', ownerId: 'owner-1', view: 'uncommitted' };
    const { api } = fakeApi(summary(['a.txt'], source));
    const { result } = renderHook(() => useWorkspaceChanges(api, source, true));
    await waitFor(() => expect(result.current.summary.state).toBe('ready'));
    await act(async () => {
      await result.current.markReviewed(['a.txt']);
    });
    expect(api.markChangesReviewed).not.toHaveBeenCalled();
  });

  it('gives an error when the summary fails', async () => {
    const { api } = fakeApi();
    api.getChangesSummary.mockRejectedValueOnce(new Error('broken'));
    const { result } = renderHook(() => useWorkspaceChanges(api, sessionSource, true));
    await waitFor(() => expect(result.current.summary).toEqual({ state: 'error' }));
  });

  it('clears the selection when a reload no longer lists the selected path', async () => {
    const { api, emit } = fakeApi();
    const { result } = renderHook(() => useWorkspaceChanges(api, sessionSource, true));
    await waitFor(() => expect(result.current.summary.state).toBe('ready'));
    act(() => result.current.setSelectedPath('a.txt'));

    api.getChangesSummary.mockResolvedValueOnce(summary(['b.txt']));
    act(() => emit(count('owner-1')));
    await waitFor(() => expect(result.current.selectedPath).toBeNull());
  });

  it('fetches the open diff again when the summary reloads without flashing loading', async () => {
    const { api, emit } = fakeApi();
    const { result } = renderHook(() => useWorkspaceChanges(api, sessionSource, true));
    await waitFor(() => expect(result.current.summary.state).toBe('ready'));
    act(() => result.current.setSelectedPath('a.txt'));
    await waitFor(() => expect(result.current.diff?.state).toBe('ready'));
    expect(api.getChangesFileDiff).toHaveBeenCalledTimes(1);

    let resolveDiff!: (value: ChangesFileDiff) => void;
    api.getChangesFileDiff.mockImplementationOnce(() => new Promise((resolve) => { resolveDiff = resolve; }));
    act(() => emit(count('owner-1')));
    await waitFor(() => expect(api.getChangesFileDiff).toHaveBeenCalledTimes(2));
    expect(result.current.diff).toEqual({
      state: 'ready',
      value: { path: 'a.txt', patch: '+a.txt', binary: false, truncated: false }
    });

    const refreshed = { path: 'a.txt', patch: '+a.txt\n+more', binary: false, truncated: false };
    await act(async () => {
      resolveDiff(refreshed);
    });
    expect(result.current.diff).toEqual({ state: 'ready', value: refreshed });
  });

  it('fetches the open diff again after reload()', async () => {
    const { api } = fakeApi();
    const { result } = renderHook(() => useWorkspaceChanges(api, sessionSource, true));
    await waitFor(() => expect(result.current.summary.state).toBe('ready'));
    act(() => result.current.setSelectedPath('b.txt'));
    await waitFor(() => expect(result.current.diff?.state).toBe('ready'));

    await act(async () => {
      await result.current.reload();
    });
    await waitFor(() => expect(api.getChangesFileDiff).toHaveBeenCalledTimes(2));
    expect(api.getChangesFileDiff).toHaveBeenLastCalledWith(sessionSource, 'b.txt');
    expect(result.current.diff?.state).toBe('ready');
  });

  it('coalesces reloads requested while one is in flight into one more load', async () => {
    const { api, emit } = fakeApi();
    const { result } = renderHook(() => useWorkspaceChanges(api, sessionSource, true));
    await waitFor(() => expect(result.current.summary.state).toBe('ready'));

    let resolveSlow!: (value: ChangesSummary) => void;
    api.getChangesSummary
      .mockImplementationOnce(() => new Promise((resolve) => { resolveSlow = resolve; }))
      .mockResolvedValueOnce(summary(['new.txt']));
    act(() => emit(count('owner-1')));
    act(() => emit(count('owner-1')));
    act(() => emit(count('owner-1')));
    expect(api.getChangesSummary).toHaveBeenCalledTimes(2);

    await act(async () => {
      resolveSlow(summary(['old.txt']));
    });
    await waitFor(() => expect(result.current.summary).toEqual({ state: 'ready', value: summary(['new.txt']) }));
    expect(api.getChangesSummary).toHaveBeenCalledTimes(3);
  });

  it('reports refreshing while a reload runs over a ready summary', async () => {
    const { api, emit } = fakeApi();
    const { result } = renderHook(() => useWorkspaceChanges(api, sessionSource, true));
    expect(result.current.refreshing).toBe(false);
    await waitFor(() => expect(result.current.summary.state).toBe('ready'));
    expect(result.current.refreshing).toBe(false);

    let resolveSlow!: (value: ChangesSummary) => void;
    api.getChangesSummary.mockImplementationOnce(() => new Promise((resolve) => { resolveSlow = resolve; }));
    act(() => emit(count('owner-1')));
    expect(result.current.refreshing).toBe(true);
    expect(result.current.summary.state).toBe('ready');

    await act(async () => {
      resolveSlow(summary(['a.txt']));
    });
    expect(result.current.refreshing).toBe(false);
  });

  it('keeps the same diff object when a refreshed diff is unchanged', async () => {
    const { api, emit } = fakeApi();
    const { result } = renderHook(() => useWorkspaceChanges(api, sessionSource, true));
    await waitFor(() => expect(result.current.summary.state).toBe('ready'));
    act(() => result.current.setSelectedPath('a.txt'));
    await waitFor(() => expect(result.current.diff?.state).toBe('ready'));
    const first = result.current.diff;

    act(() => emit(count('owner-1')));
    await waitFor(() => expect(api.getChangesFileDiff).toHaveBeenCalledTimes(2));
    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current.diff).toBe(first);
  });

  it('ignores a diff that answers for the previous source', async () => {
    const { api } = fakeApi();
    const { result, rerender } = renderHook(
      ({ source }: { source: ChangesSource }) => useWorkspaceChanges(api, source, true),
      { initialProps: { source: sessionSource } }
    );
    await waitFor(() => expect(result.current.summary.state).toBe('ready'));
    let resolveOld!: (value: ChangesFileDiff) => void;
    api.getChangesFileDiff.mockImplementationOnce(() => new Promise((resolve) => { resolveOld = resolve; }));
    act(() => result.current.setSelectedPath('a.txt'));
    await waitFor(() => expect(api.getChangesFileDiff).toHaveBeenCalledTimes(1));

    const uncommitted: ChangesSource = { kind: 'session', ownerId: 'owner-1', view: 'uncommitted' };
    api.getChangesSummary.mockResolvedValue(summary(['a.txt'], uncommitted));
    rerender({ source: uncommitted });
    await waitFor(() => expect(result.current.summary).toEqual({ state: 'ready', value: summary(['a.txt'], uncommitted) }));
    act(() => result.current.setSelectedPath('a.txt'));
    await waitFor(() => expect(result.current.diff?.state).toBe('ready'));

    await act(async () => {
      resolveOld({ path: 'a.txt', patch: '+from the old source', binary: false, truncated: false });
    });
    expect(result.current.diff).toEqual({
      state: 'ready',
      value: { path: 'a.txt', patch: '+a.txt', binary: false, truncated: false }
    });
    expect(api.getChangesFileDiff).toHaveBeenLastCalledWith(uncommitted, 'a.txt');
  });

  it('drops a review result that lands after the source changed', async () => {
    const { api } = fakeApi();
    const { result, rerender } = renderHook(
      ({ source }: { source: ChangesSource }) => useWorkspaceChanges(api, source, true),
      { initialProps: { source: sessionSource } }
    );
    await waitFor(() => expect(result.current.summary.state).toBe('ready'));
    let resolveReview!: (value: ChangesSummary) => void;
    api.markChangesReviewed.mockImplementationOnce(() => new Promise((resolve) => { resolveReview = resolve; }));
    let pending!: Promise<void>;
    act(() => {
      pending = result.current.markReviewed(['a.txt']);
    });

    const uncommitted: ChangesSource = { kind: 'session', ownerId: 'owner-1', view: 'uncommitted' };
    api.getChangesSummary.mockResolvedValue(summary(['u.txt'], uncommitted));
    rerender({ source: uncommitted });
    await waitFor(() => expect(result.current.summary).toEqual({ state: 'ready', value: summary(['u.txt'], uncommitted) }));

    await act(async () => {
      resolveReview(summary(['b.txt']));
      await pending;
    });
    expect(result.current.summary).toEqual({ state: 'ready', value: summary(['u.txt'], uncommitted) });
  });

  it('loads again instead of storing a review result when a newer summary landed meanwhile', async () => {
    const { api, emit } = fakeApi();
    const { result } = renderHook(() => useWorkspaceChanges(api, sessionSource, true));
    await waitFor(() => expect(result.current.summary.state).toBe('ready'));
    let resolveReview!: (value: ChangesSummary) => void;
    api.markChangesReviewed.mockImplementationOnce(() => new Promise((resolve) => { resolveReview = resolve; }));
    let pending!: Promise<void>;
    act(() => {
      pending = result.current.markReviewed(['a.txt']);
    });

    api.getChangesSummary.mockResolvedValueOnce(summary(['c.txt'])).mockResolvedValueOnce(summary(['d.txt']));
    act(() => emit(count('owner-1')));
    await waitFor(() => expect(result.current.summary).toEqual({ state: 'ready', value: summary(['c.txt']) }));

    await act(async () => {
      resolveReview(summary(['b.txt']));
      await pending;
    });
    await waitFor(() => expect(result.current.summary).toEqual({ state: 'ready', value: summary(['d.txt']) }));
    expect(api.getChangesSummary).toHaveBeenCalledTimes(3);
  });

  it('rejects when marking reviewed fails and leaves the state unchanged', async () => {
    const { api } = fakeApi();
    const { result } = renderHook(() => useWorkspaceChanges(api, sessionSource, true));
    await waitFor(() => expect(result.current.summary.state).toBe('ready'));
    act(() => result.current.setSelectedPath('a.txt'));
    const before = result.current.summary;
    api.markChangesReviewed.mockRejectedValueOnce(new Error('denied'));

    let failure: unknown = null;
    await act(async () => {
      await result.current.markReviewed(['a.txt']).catch((error: unknown) => {
        failure = error;
      });
    });
    expect(failure).toBeInstanceOf(Error);
    expect(result.current.summary).toBe(before);
    expect(result.current.selectedPath).toBe('a.txt');
  });

  it('resets the selection and reloads when the source changes', async () => {
    const { api } = fakeApi();
    const { result, rerender } = renderHook(
      ({ source }: { source: ChangesSource }) => useWorkspaceChanges(api, source, true),
      { initialProps: { source: sessionSource } }
    );
    await waitFor(() => expect(result.current.summary.state).toBe('ready'));
    act(() => result.current.setSelectedPath('a.txt'));

    rerender({ source: { kind: 'session', ownerId: 'owner-1', view: 'session' } });
    expect(result.current.selectedPath).toBe('a.txt');
    expect(api.getChangesSummary).toHaveBeenCalledTimes(1);

    const uncommitted: ChangesSource = { kind: 'session', ownerId: 'owner-1', view: 'uncommitted' };
    rerender({ source: uncommitted });
    expect(result.current.selectedPath).toBeNull();
    await waitFor(() => expect(api.getChangesSummary).toHaveBeenLastCalledWith(uncommitted));
  });
});
