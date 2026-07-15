import { act, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  ProgressiveListControl,
  useProgressiveList
} from './progressive-list';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('useProgressiveList', () => {
  it('bounds the initial result and reveals one batch at a time', () => {
    const { result, rerender } = renderHook(
      ({ itemCount, resetKey }) =>
        useProgressiveList({
          itemCount,
          resetKey,
          initialCount: 20,
          batchSize: 20
        }),
      { initialProps: { itemCount: 55, resetKey: 'all' } }
    );

    expect(result.current).toMatchObject({ visibleCount: 20, hasMore: true });

    act(() => result.current.showMore());
    expect(result.current).toMatchObject({ visibleCount: 40, hasMore: true });

    rerender({ itemCount: 12, resetKey: 'all' });
    expect(result.current).toMatchObject({ visibleCount: 12, hasMore: false });

    rerender({ itemCount: 55, resetKey: 'filtered' });
    expect(result.current).toMatchObject({ visibleCount: 20, hasMore: true });

    rerender({ itemCount: 55, resetKey: 'all' });
    expect(result.current).toMatchObject({ visibleCount: 20, hasMore: true });
  });
});

describe('ProgressiveListControl', () => {
  it('keeps a native manual fallback when observation is unavailable', () => {
    vi.stubGlobal('IntersectionObserver', undefined);
    const onLoadMore = vi.fn();

    render(
      <ProgressiveListControl
        hasMore
        label="Load more workspaces"
        onLoadMore={onLoadMore}
      />
    );

    fireEvent.click(
      screen.getByRole('button', { name: 'Load more workspaces' })
    );
    expect(onLoadMore).toHaveBeenCalledOnce();
  });

  it('loads ahead of the viewport and disconnects its observer', () => {
    const disconnect = vi.fn();
    const observe = vi.fn();
    let observerCallback: IntersectionObserverCallback = () => undefined;
    let observerOptions: IntersectionObserverInit | undefined;

    class Observer {
      constructor(
        callback: IntersectionObserverCallback,
        options?: IntersectionObserverInit
      ) {
        observerCallback = callback;
        observerOptions = options;
      }

      observe = observe;
      disconnect = disconnect;
    }

    vi.stubGlobal('IntersectionObserver', Observer);
    const onLoadMore = vi.fn();
    const { unmount } = render(
      <main className="main-content">
        <ProgressiveListControl
          hasMore
          label="Load more sessions"
          onLoadMore={onLoadMore}
        />
      </main>
    );

    expect(observe).toHaveBeenCalledOnce();
    expect(observerOptions).toMatchObject({
      root: screen.getByRole('main'),
      rootMargin: '600px 0px'
    });
    act(() => {
      observerCallback(
        [{ isIntersecting: true } as IntersectionObserverEntry],
        {} as IntersectionObserver
      );
    });
    expect(onLoadMore).toHaveBeenCalledOnce();

    unmount();
    expect(disconnect).toHaveBeenCalledOnce();
  });
});
