import { act, renderHook, waitFor } from '@testing-library/react';
import { StrictMode, type ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import type {
  ProviderUpdateCheckResult
} from '../../../shared/contracts';
import {
  useProviderUpdates,
  type UseProviderUpdatesOptions
} from './useProviderUpdates';

const currentCheck: ProviderUpdateCheckResult = {
  checkedAt: '2026-08-24T01:00:00.000Z',
  providers: [
    {
      provider: 'codex',
      displayName: 'Codex',
      state: 'up_to_date',
      installedVersion: '1.0.0',
      latestVersion: '1.0.0',
      issue: null
    }
  ]
};

const availableCheck: ProviderUpdateCheckResult = {
  checkedAt: '2026-08-24T02:00:00.000Z',
  providers: [
    {
      provider: 'codex',
      displayName: 'Codex',
      state: 'update_available',
      installedVersion: '1.0.0',
      latestVersion: '1.1.0',
      issue: null
    }
  ]
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

const strictWrapper = ({ children }: { children: ReactNode }) => (
  <StrictMode>{children}</StrictMode>
);

describe('useProviderUpdates', () => {
  it('checks once only after automatic checking and discovery are ready', async () => {
    const checkProviderUpdates = vi.fn().mockResolvedValue(currentCheck);
    const api = { checkProviderUpdates };
    const { result, rerender } = renderHook(
      (options: Omit<UseProviderUpdatesOptions, 'api'>) =>
        useProviderUpdates({ ...options, api }),
      {
        initialProps: { enabled: false, discoveryReady: false },
        wrapper: strictWrapper
      }
    );

    expect(result.current.status).toEqual({ state: 'idle' });
    expect(checkProviderUpdates).not.toHaveBeenCalled();

    rerender({ enabled: true, discoveryReady: false });
    expect(checkProviderUpdates).not.toHaveBeenCalled();

    rerender({ enabled: true, discoveryReady: true });
    await waitFor(() => expect(result.current.status).toEqual({
      state: 'ready',
      check: currentCheck
    }));
    expect(checkProviderUpdates).toHaveBeenCalledOnce();

    rerender({ enabled: true, discoveryReady: true });
    expect(checkProviderUpdates).toHaveBeenCalledOnce();
  });

  it('returns to idle and ignores a late result when checking is disabled', async () => {
    const pending = deferred<ProviderUpdateCheckResult>();
    const api = { checkProviderUpdates: vi.fn(() => pending.promise) };
    const { result, rerender } = renderHook(
      (options: Omit<UseProviderUpdatesOptions, 'api'>) =>
        useProviderUpdates({ ...options, api }),
      {
        initialProps: { enabled: true, discoveryReady: true }
      }
    );

    await waitFor(() => expect(result.current.status.state).toBe('loading'));
    rerender({ enabled: false, discoveryReady: true });
    expect(result.current.status).toEqual({ state: 'idle' });

    await act(async () => pending.resolve(availableCheck));
    expect(result.current.status).toEqual({ state: 'idle' });
    expect(result.current.refreshing).toBe(false);
  });

  it('allows an explicit settings check while automatic checking is disabled', async () => {
    const checkProviderUpdates = vi.fn().mockResolvedValue(availableCheck);
    const api = { checkProviderUpdates };
    const { result } = renderHook(() => useProviderUpdates({
      api,
      enabled: false,
      discoveryReady: true
    }));

    expect(checkProviderUpdates).not.toHaveBeenCalled();
    await act(() => result.current.refresh());

    expect(checkProviderUpdates).toHaveBeenCalledOnce();
    expect(result.current.status).toEqual({
      state: 'ready',
      check: availableCheck
    });
  });

  it('preserves a trusted result while a refresh is pending or fails', async () => {
    const pending = deferred<ProviderUpdateCheckResult>();
    const checkProviderUpdates = vi.fn()
      .mockResolvedValueOnce(currentCheck)
      .mockImplementationOnce(() => pending.promise);
    const api = { checkProviderUpdates };
    const { result } = renderHook(() => useProviderUpdates({
      api,
      enabled: true,
      discoveryReady: true
    }));

    await waitFor(() => expect(result.current.status.state).toBe('ready'));

    let refresh!: Promise<void>;
    act(() => {
      refresh = result.current.refresh();
    });
    expect(result.current.status).toEqual({
      state: 'ready',
      check: currentCheck
    });
    expect(result.current.refreshing).toBe(true);

    await act(async () => pending.reject(new Error('offline')));
    await refresh;
    expect(result.current.status).toEqual({
      state: 'ready',
      check: currentCheck
    });
    expect(result.current.refreshing).toBe(false);
  });

  it('coalesces concurrent refresh requests', async () => {
    const pending = deferred<ProviderUpdateCheckResult>();
    const checkProviderUpdates = vi.fn()
      .mockResolvedValueOnce(currentCheck)
      .mockImplementationOnce(() => pending.promise);
    const api = { checkProviderUpdates };
    const { result } = renderHook(() => useProviderUpdates({
      api,
      enabled: true,
      discoveryReady: true
    }));
    await waitFor(() => expect(result.current.status.state).toBe('ready'));

    let first!: Promise<void>;
    let second!: Promise<void>;
    act(() => {
      first = result.current.refresh();
      second = result.current.refresh();
    });
    expect(checkProviderUpdates).toHaveBeenCalledTimes(2);

    await act(async () => pending.resolve(availableCheck));
    await Promise.all([first, second]);
    expect(result.current.status).toEqual({
      state: 'ready',
      check: availableCheck
    });
  });

  it('reports an error when the first check fails', async () => {
    const api = {
      checkProviderUpdates: vi.fn().mockRejectedValue(new Error('offline'))
    };
    const { result } = renderHook(() => useProviderUpdates({
      api,
      enabled: true,
      discoveryReady: true
    }));

    await waitFor(() => expect(result.current.status).toEqual({
      state: 'error'
    }));
    expect(result.current.refreshing).toBe(false);
  });
});
