import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  CATALOG_AUTO_REFRESH_INTERVAL_MS,
  CATALOG_EXIT_REFRESH_DELAY_MS,
  useCatalogAutoRefresh
} from './useCatalogAutoRefresh';

function setDocumentHidden(hidden: boolean): void {
  Object.defineProperty(document, 'hidden', {
    configurable: true,
    value: hidden
  });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

describe('useCatalogAutoRefresh', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    setDocumentHidden(false);
  });

  afterEach(() => {
    vi.useRealTimers();
    setDocumentHidden(false);
  });

  it('debounces terminal exits into one delayed refresh', async () => {
    const refresh = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useCatalogAutoRefresh({ refresh }));

    act(() => {
      result.current.scheduleAfterExit();
      result.current.scheduleAfterExit();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(CATALOG_EXIT_REFRESH_DELAY_MS - 1);
    });
    expect(refresh).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(refresh).toHaveBeenCalledOnce();
  });

  it('refreshes on the visible five-minute schedule', async () => {
    const refresh = vi.fn().mockResolvedValue(undefined);
    renderHook(() => useCatalogAutoRefresh({ refresh }));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(CATALOG_AUTO_REFRESH_INTERVAL_MS);
    });

    expect(refresh).toHaveBeenCalledOnce();
  });

  it('defers a hidden scheduled cycle until visibility returns', async () => {
    const refresh = vi.fn().mockResolvedValue(undefined);
    renderHook(() => useCatalogAutoRefresh({ refresh }));
    setDocumentHidden(true);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(CATALOG_AUTO_REFRESH_INTERVAL_MS);
    });
    expect(refresh).not.toHaveBeenCalled();

    setDocumentHidden(false);
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
      await Promise.resolve();
    });
    expect(refresh).toHaveBeenCalledOnce();
  });

  it('coalesces triggers while a refresh is in flight', async () => {
    const pending = deferred<void>();
    const refresh = vi.fn().mockImplementationOnce(() => pending.promise);
    const { result } = renderHook(() => useCatalogAutoRefresh({ refresh }));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(CATALOG_AUTO_REFRESH_INTERVAL_MS);
    });
    act(() => result.current.scheduleAfterExit());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(CATALOG_EXIT_REFRESH_DELAY_MS);
    });
    expect(refresh).toHaveBeenCalledOnce();

    await act(async () => pending.resolve());
  });

  it('retries after a background refresh rejects', async () => {
    const refresh = vi
      .fn()
      .mockRejectedValueOnce(new Error('scan unavailable'))
      .mockResolvedValueOnce(undefined);
    const { result } = renderHook(() => useCatalogAutoRefresh({ refresh }));

    act(() => result.current.scheduleAfterExit());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(CATALOG_EXIT_REFRESH_DELAY_MS);
    });
    act(() => result.current.scheduleAfterExit());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(CATALOG_EXIT_REFRESH_DELAY_MS);
    });

    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it('clears scheduled work when unmounted', async () => {
    const refresh = vi.fn().mockResolvedValue(undefined);
    const { result, unmount } = renderHook(() =>
      useCatalogAutoRefresh({ refresh })
    );
    act(() => result.current.scheduleAfterExit());

    unmount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(
        CATALOG_AUTO_REFRESH_INTERVAL_MS + CATALOG_EXIT_REFRESH_DELAY_MS
      );
    });

    expect(refresh).not.toHaveBeenCalled();
  });
});
