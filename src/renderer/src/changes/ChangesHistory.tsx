import { memo, useEffect, useMemo, useRef, type ReactNode } from 'react';

import type { ChangesHistory as History } from '../../../shared/contracts';
import { ProgressiveListControl, useProgressiveList } from '../catalog/progressive-list';
import { useLocalization } from '../localization/useLocalization';
import type { Load } from './useWorkspaceChanges';

/** Segments shown before the list asks for more. */
const HISTORY_PAGE_SIZE = 100;

interface ChangesHistoryProps {
  history: Load<History>;
  /** The catalog title of a session, or null when it is not known. */
  sessionTitle?: ((catalogSessionId: string) => string | null) | undefined;
  /** Segments of this catalog session are marked and scrolled into view. */
  highlightSessionId?: string | null | undefined;
  onOpenReview(reviewId: string): void;
}

interface Row {
  ownerId: string;
  heading: string;
  started: string;
  highlighted: boolean;
  batches: { reviewId: string; label: string }[];
}

function useRows(
  history: Load<History>,
  sessionTitle: ChangesHistoryProps['sessionTitle'],
  highlightSessionId: string | null
): Row[] | null {
  const { formatDate, formatTime, t } = useLocalization();
  return useMemo(() => {
    if (history.state !== 'ready') return null;
    const when = (iso: string) => {
      const date = new Date(iso);
      return `${formatDate(date)} ${formatTime(date)}`;
    };
    return history.value.segments.map((segment) => {
      const title = segment.catalogSessionId === null ? null : sessionTitle?.(segment.catalogSessionId) ?? null;
      return {
        ownerId: segment.ownerId,
        heading: title ?? t(`terminal.changes.history-${segment.ownerKind}`),
        started: t('terminal.changes.history-started', { time: when(segment.createdAt) }),
        highlighted: highlightSessionId !== null && segment.catalogSessionId === highlightSessionId,
        batches: segment.reviews.map((review) => ({
          reviewId: review.reviewId,
          label: t('terminal.changes.history-batch', { count: review.fileCount, time: when(review.reviewedAt) })
        }))
      };
    });
  }, [formatDate, formatTime, highlightSessionId, history, sessionTitle, t]);
}

/** Scrolls the nearest history scroll container so the first highlighted segment sits at its top. */
function scrollToHighlight(list: HTMLElement | null): void {
  const segment = list?.querySelector<HTMLElement>('[data-highlighted="true"]');
  if (list === null || segment === null || segment === undefined) return;
  const container = list.closest<HTMLElement>('.changes-history-scroll') ?? list.parentElement;
  if (container === null) return;
  container.scrollTop += segment.getBoundingClientRect().top - container.getBoundingClientRect().top;
}

export const ChangesHistory = memo(function ChangesHistory({
  highlightSessionId = null,
  history,
  onOpenReview,
  sessionTitle
}: ChangesHistoryProps): ReactNode {
  const { t } = useLocalization();
  const rows = useRows(history, sessionTitle, highlightSessionId);
  const listRef = useRef<HTMLUListElement | null>(null);
  const highlightIndex = rows?.findIndex((row) => row.highlighted) ?? -1;
  const progress = useProgressiveList({
    itemCount: rows?.length ?? 0,
    resetKey: `${highlightSessionId ?? ''}:${highlightIndex}`,
    initialCount: Math.max(HISTORY_PAGE_SIZE, highlightIndex + 1),
    batchSize: HISTORY_PAGE_SIZE
  });

  /** The highlight already scrolled to, so a refresh does not move the list again. */
  const scrolledTo = useRef<string | null>(null);
  useEffect(() => {
    if (highlightIndex < 0 || scrolledTo.current === highlightSessionId) return;
    scrolledTo.current = highlightSessionId;
    scrollToHighlight(listRef.current);
  }, [highlightIndex, highlightSessionId]);

  if (history.state === 'error') {
    return <p className="changes-notice changes-notice-error" role="alert">{t('terminal.changes.error')}</p>;
  }
  if (rows === null) return null;

  return (
    <>
      {highlightSessionId !== null && highlightIndex < 0 ? (
        <p className="changes-notice">{t('terminal.changes.history-no-session')}</p>
      ) : null}
      {rows.length === 0 ? <p className="changes-empty">{t('terminal.changes.history-empty')}</p> : (
        <ul aria-label={t('terminal.changes.history-list')} className="changes-history" ref={listRef}>
          {rows.slice(0, progress.visibleCount).map((row) => (
            <li
              className="changes-history-segment"
              data-highlighted={row.highlighted ? 'true' : undefined}
              key={row.ownerId}
            >
              <h3>{row.heading}</h3>
              <p className="changes-history-started">{row.started}</p>
              {row.batches.length === 0 ? (
                <p className="changes-history-empty">{t('terminal.changes.history-empty')}</p>
              ) : (
                <div className="changes-history-batches">
                  {row.batches.map((batch) => (
                    <button
                      className="changes-history-batch"
                      key={batch.reviewId}
                      onClick={() => onOpenReview(batch.reviewId)}
                      type="button"
                    >
                      {batch.label}
                    </button>
                  ))}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      <ProgressiveListControl
        hasMore={progress.hasMore}
        label={t('terminal.changes.history-show-more')}
        onLoadMore={progress.showMore}
      />
    </>
  );
});
