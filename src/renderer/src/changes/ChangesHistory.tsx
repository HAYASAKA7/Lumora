import { useEffect, useRef, useState, type ReactNode } from 'react';

import type { ChangesHistory as History } from '../../../shared/contracts';
import { useLocalization } from '../localization/useLocalization';
import type { ChangesApi, Load } from './useWorkspaceChanges';

type Segment = History['segments'][number];

interface ChangesHistoryProps {
  api: ChangesApi;
  workspaceId: string;
  /** False while hidden; nothing loads then. */
  active: boolean;
  /** The catalog title of a session, or null when it is not known. */
  sessionTitle?(catalogSessionId: string): string | null;
  /** Segments of this catalog session are marked and scrolled into view. */
  highlightSessionId?: string | null;
  onOpenReview(reviewId: string): void;
}

interface Loaded {
  workspaceId: string;
  load: Load<History>;
}

function useHistory(api: ChangesApi, workspaceId: string, active: boolean): Load<History> {
  const apiRef = useRef(api);
  apiRef.current = api;
  const [loaded, setLoaded] = useState<Loaded>({ workspaceId, load: { state: 'loading' } });

  useEffect(() => {
    if (!active) return undefined;
    let current = true;
    apiRef.current.getChangesHistory(workspaceId).then(
      (value) => {
        if (current) setLoaded({ workspaceId, load: { state: 'ready', value } });
      },
      () => {
        if (current) setLoaded({ workspaceId, load: { state: 'error' } });
      }
    );
    return () => {
      current = false;
    };
  }, [active, workspaceId]);

  return loaded.workspaceId === workspaceId ? loaded.load : { state: 'loading' };
}

export function ChangesHistory({
  active,
  api,
  highlightSessionId = null,
  onOpenReview,
  sessionTitle,
  workspaceId
}: ChangesHistoryProps): ReactNode {
  const { formatDate, formatTime, t } = useLocalization();
  const history = useHistory(api, workspaceId, active);
  const listRef = useRef<HTMLUListElement | null>(null);

  const highlighted = (segment: Segment) =>
    highlightSessionId !== null && segment.catalogSessionId === highlightSessionId;
  const segments = history.state === 'ready' ? history.value.segments : null;
  const hasHighlight = segments?.some(highlighted) ?? false;

  useEffect(() => {
    if (!hasHighlight) return;
    const first = listRef.current?.querySelector<HTMLElement>('[data-highlighted="true"]');
    // jsdom and older engines may lack scrollIntoView.
    if (typeof first?.scrollIntoView === 'function') first.scrollIntoView({ block: 'nearest' });
  }, [hasHighlight, highlightSessionId, segments]);

  const when = (iso: string) => {
    const date = new Date(iso);
    return `${formatDate(date)} ${formatTime(date)}`;
  };

  const heading = (segment: Segment) => {
    const title = segment.catalogSessionId === null ? null : sessionTitle?.(segment.catalogSessionId) ?? null;
    return title ?? t(`terminal.changes.history-${segment.ownerKind}`);
  };

  if (history.state === 'error') {
    return <p className="changes-notice changes-notice-error" role="alert">{t('terminal.changes.error')}</p>;
  }
  if (segments === null) return null;
  if (segments.length === 0) return <p className="changes-empty">{t('terminal.changes.history-empty')}</p>;

  return (
    <ul aria-label={t('terminal.changes.history-list')} className="changes-history" ref={listRef}>
      {segments.map((segment) => (
        <li
          className="changes-history-segment"
          data-highlighted={highlighted(segment) ? 'true' : undefined}
          key={segment.ownerId}
        >
          <h3>{heading(segment)}</h3>
          <p className="changes-history-started">
            {t('terminal.changes.history-started', { time: when(segment.createdAt) })}
          </p>
          {segment.reviews.length === 0 ? (
            <p className="changes-history-empty">{t('terminal.changes.history-empty')}</p>
          ) : (
            <div className="changes-history-batches">
              {segment.reviews.map((review) => (
                <button
                  className="changes-history-batch"
                  key={review.reviewId}
                  onClick={() => onOpenReview(review.reviewId)}
                  type="button"
                >
                  {t('terminal.changes.history-batch', { count: review.fileCount, time: when(review.reviewedAt) })}
                </button>
              ))}
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}
