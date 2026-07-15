import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode
} from 'react';

interface ProgressiveListOptions {
  itemCount: number;
  resetKey: string;
  initialCount: number;
  batchSize: number;
}

interface ProgressiveListState {
  visibleCount: number;
  hasMore: boolean;
  showMore(): void;
}

function positiveInteger(value: number): number {
  return Math.max(1, Math.trunc(value));
}

export function useProgressiveList({
  itemCount,
  resetKey,
  initialCount,
  batchSize
}: ProgressiveListOptions): ProgressiveListState {
  const boundedItemCount = Math.max(0, Math.trunc(itemCount));
  const boundedInitialCount = positiveInteger(initialCount);
  const boundedBatchSize = positiveInteger(batchSize);
  const [progress, setProgress] = useState(() => ({
    resetKey,
    requestedCount: boundedInitialCount
  }));

  useEffect(() => {
    setProgress((current) =>
      current.resetKey === resetKey
        ? current
        : { resetKey, requestedCount: boundedInitialCount }
    );
  }, [boundedInitialCount, resetKey]);

  const requestedCount =
    progress.resetKey === resetKey
      ? progress.requestedCount
      : boundedInitialCount;
  const visibleCount = Math.min(boundedItemCount, requestedCount);

  const showMore = useCallback(() => {
    setProgress((current) => {
      const currentCount =
        current.resetKey === resetKey
          ? current.requestedCount
          : boundedInitialCount;
      return {
        resetKey,
        requestedCount: Math.min(
          boundedItemCount,
          currentCount + boundedBatchSize
        )
      };
    });
  }, [boundedBatchSize, boundedInitialCount, boundedItemCount, resetKey]);

  return {
    visibleCount,
    hasMore: visibleCount < boundedItemCount,
    showMore
  };
}

export function ProgressiveListControl({
  hasMore,
  label,
  onLoadMore
}: {
  hasMore: boolean;
  label: string;
  onLoadMore(): void;
}): ReactNode {
  const buttonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    const target = buttonRef.current;
    if (
      !hasMore ||
      target === null ||
      typeof IntersectionObserver === 'undefined'
    ) {
      return undefined;
    }

    const scrollRoot = target.closest<HTMLElement>('.main-content');
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          onLoadMore();
        }
      },
      { root: scrollRoot, rootMargin: '600px 0px' }
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, [hasMore, onLoadMore]);

  if (!hasMore) {
    return null;
  }

  return (
    <div className="progressive-list-control">
      <button
        className="secondary-button"
        onClick={onLoadMore}
        ref={buttonRef}
        type="button"
      >
        {label}
      </button>
    </div>
  );
}
