import { fireEvent, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ChangesHistory as History } from '../../../shared/contracts';
import { renderWithLocalization } from '../test/render-with-localization';
import { ChangesHistory } from './ChangesHistory';
import type { Load } from './useWorkspaceChanges';

const history: History = {
  segments: [
    {
      ownerId: 'owner-2',
      ownerKind: 'unified',
      catalogSessionId: 'session-2',
      createdAt: '2026-09-15T02:00:00.000Z',
      endedAt: null,
      reviews: [
        { reviewId: 'review-3', fileCount: 3, reviewedAt: '2026-09-15T03:00:00.000Z' },
        { reviewId: 'review-2', fileCount: 1, reviewedAt: '2026-09-15T02:30:00.000Z' }
      ]
    },
    {
      ownerId: 'owner-1',
      ownerKind: 'terminal',
      catalogSessionId: 'unknown-session',
      createdAt: '2026-09-15T01:00:00.000Z',
      endedAt: '2026-09-15T01:30:00.000Z',
      reviews: []
    },
    {
      ownerId: 'owner-0',
      ownerKind: 'unified',
      catalogSessionId: null,
      createdAt: '2026-09-15T00:00:00.000Z',
      endedAt: '2026-09-15T00:30:00.000Z',
      reviews: [{ reviewId: 'review-1', fileCount: 2, reviewedAt: '2026-09-15T00:20:00.000Z' }]
    }
  ]
};

const ready = (value: History): Load<History> => ({ state: 'ready', value });

function segmentOf(index: number, ownerKind: 'terminal' | 'unified' = 'terminal'): History['segments'][number] {
  return {
    ownerId: `owner-${index}`,
    ownerKind,
    catalogSessionId: `session-${index}`,
    createdAt: '2026-09-15T00:00:00.000Z',
    endedAt: null,
    reviews: [{ reviewId: `review-${index}`, fileCount: 1, reviewedAt: '2026-09-15T00:10:00.000Z' }]
  };
}

function renderHistory(load: Load<History>, highlightSessionId: string | null = null) {
  const onOpenReview = vi.fn();
  const sessionTitle = (id: string) => (id === 'session-2' ? 'Fix the login flow' : null);
  const view = renderWithLocalization(
    <div className="changes-history-scroll">
      <ChangesHistory
        highlightSessionId={highlightSessionId}
        history={load}
        onOpenReview={onOpenReview}
        sessionTitle={sessionTitle}
      />
    </div>
  );
  return { ...view, onOpenReview };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('ChangesHistory', () => {
  it('lists segments newest first with titles or kind fallbacks and their batches', () => {
    const { onOpenReview } = renderHistory(ready(history));

    const list = screen.getByRole('list', { name: 'Change history' });
    const segments = within(list).getAllByRole('listitem');
    expect(segments).toHaveLength(3);
    expect(within(segments[0]!).getByRole('heading', { name: 'Fix the login flow' })).toBeInTheDocument();
    expect(within(segments[1]!).getByRole('heading', { name: 'Native terminal session' })).toBeInTheDocument();
    expect(within(segments[2]!).getByRole('heading', { name: 'Unified UI session' })).toBeInTheDocument();
    expect(within(segments[0]!).getByText(/^Started /)).toBeInTheDocument();
    expect(within(segments[1]!).getByText('Nothing reviewed yet.')).toBeInTheDocument();

    expect(within(segments[0]!).getByRole('button', { name: /^1 file reviewed · / })).toBeInTheDocument();
    fireEvent.click(within(segments[0]!).getByRole('button', { name: /^3 files reviewed · / }));
    expect(onOpenReview).toHaveBeenCalledWith('review-3');
  });

  it('says nothing was reviewed when there are no segments and shows nothing while loading', () => {
    const { unmount } = renderHistory({ state: 'loading' });
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
    expect(screen.queryByText('Nothing reviewed yet.')).not.toBeInTheDocument();
    unmount();

    renderHistory(ready({ segments: [] }));
    expect(screen.getByText('Nothing reviewed yet.')).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Change history' })).not.toBeInTheDocument();
  });

  it('shows an alert when the history cannot be read', () => {
    renderHistory({ state: 'error' });
    expect(screen.getByRole('alert')).toHaveTextContent('Lumora could not read changes. Try again.');
  });

  it('marks the highlighted session and scrolls only its container to it', () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      const top = this.classList.contains('changes-history-scroll') ? 100 : this.dataset.highlighted === 'true' ? 340 : 0;
      return { top, bottom: top, left: 0, right: 0, width: 0, height: 0, x: 0, y: top, toJSON: () => ({}) };
    });
    const { container } = renderHistory(ready(history), 'session-2');

    const segments = within(screen.getByRole('list', { name: 'Change history' })).getAllByRole('listitem');
    expect(segments[0]).toHaveAttribute('data-highlighted', 'true');
    expect(segments[1]).not.toHaveAttribute('data-highlighted');
    const scroller = container.querySelector<HTMLElement>('.changes-history-scroll')!;
    expect(scroller.scrollTop).toBe(240);
    expect(screen.queryByText('No changes were recorded for this session.')).not.toBeInTheDocument();
  });

  it('notes when the highlighted session recorded no changes', () => {
    renderHistory(ready(history), 'session-without-changes');
    expect(screen.getByText('No changes were recorded for this session.')).toBeInTheDocument();
    expect(screen.getByRole('list', { name: 'Change history' })).toBeInTheDocument();
  });

  it('shows long histories in pages and keeps a highlighted segment on the first page', () => {
    const many: History = { segments: Array.from({ length: 150 }, (_, index) => segmentOf(index)) };
    const { unmount } = renderHistory(ready(many));
    expect(within(screen.getByRole('list', { name: 'Change history' })).getAllByRole('listitem')).toHaveLength(100);
    fireEvent.click(screen.getByRole('button', { name: 'Show earlier sessions' }));
    expect(within(screen.getByRole('list', { name: 'Change history' })).getAllByRole('listitem')).toHaveLength(150);
    unmount();

    renderHistory(ready(many), 'session-120');
    const shown = within(screen.getByRole('list', { name: 'Change history' })).getAllByRole('listitem');
    expect(shown).toHaveLength(121);
    expect(shown[120]).toHaveAttribute('data-highlighted', 'true');
  });
});
