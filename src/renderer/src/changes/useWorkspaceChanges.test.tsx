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

function count(ownerId: string): ChangesCount {
  return { ownerId, workspaceId: 'ws-1', state: 'ready', changedFileCount: 1 };
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
    const { api } = fakeApi();
    const { result } = renderHook(() => useWorkspaceChanges(api, sessionSource, false));
    await act(async () => {
      await result.current.reload();
    });
    expect(api.getChangesSummary).not.toHaveBeenCalled();
    expect(api.onChangesCount).not.toHaveBeenCalled();
    expect(result.current.summary).toEqual({ state: 'loading' });
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

  it('does not subscribe to count events for workspace sources', async () => {
    const source: ChangesSource = { kind: 'workspace', workspaceId: 'ws-1' };
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

  it('ignores a stale summary that resolves after a newer one', async () => {
    const { api, emit } = fakeApi();
    const { result } = renderHook(() => useWorkspaceChanges(api, sessionSource, true));
    await waitFor(() => expect(result.current.summary.state).toBe('ready'));

    let resolveSlow!: (value: ChangesSummary) => void;
    api.getChangesSummary
      .mockImplementationOnce(() => new Promise((resolve) => { resolveSlow = resolve; }))
      .mockResolvedValueOnce(summary(['new.txt']));
    act(() => emit(count('owner-1')));
    act(() => emit(count('owner-1')));
    await waitFor(() => expect(result.current.summary).toEqual({ state: 'ready', value: summary(['new.txt']) }));
    await act(async () => {
      resolveSlow(summary(['old.txt']));
    });
    expect(result.current.summary).toEqual({ state: 'ready', value: summary(['new.txt']) });
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
