import { act, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ChangesHistory as History } from '../../../shared/contracts';
import { fakeChangesApi } from '../test/changes-test-support';
import { renderWithLocalization } from '../test/render-with-localization';
import { ChangesHistory } from './ChangesHistory';

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

interface Options {
  active?: boolean;
  workspaceId?: string;
  highlightSessionId?: string | null;
}

function setup(options: Options = {}) {
  const { api } = fakeChangesApi();
  api.getChangesHistory.mockResolvedValue(history);
  const onOpenReview = vi.fn();
  const sessionTitle = (id: string) => (id === 'session-2' ? 'Fix the login flow' : null);
  const element = (next: Options) => (
    <ChangesHistory
      active={next.active ?? true}
      api={api}
      highlightSessionId={next.highlightSessionId ?? null}
      onOpenReview={onOpenReview}
      sessionTitle={sessionTitle}
      workspaceId={next.workspaceId ?? 'ws-1'}
    />
  );
  const view = renderWithLocalization(element(options));
  return { api, onOpenReview, rerender: (next: Options) => view.rerender(element(next)) };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('ChangesHistory', () => {
  it('lists segments newest first with titles or kind fallbacks and their batches', async () => {
    const { api, onOpenReview } = setup();

    const list = await screen.findByRole('list', { name: 'Change history' });
    const segments = within(list).getAllByRole('listitem');
    expect(segments).toHaveLength(3);
    expect(within(segments[0]!).getByRole('heading', { name: 'Fix the login flow' })).toBeInTheDocument();
    expect(within(segments[1]!).getByRole('heading', { name: 'Native terminal session' })).toBeInTheDocument();
    expect(within(segments[2]!).getByRole('heading', { name: 'Unified UI session' })).toBeInTheDocument();
    expect(within(segments[0]!).getByText(/^Started /)).toBeInTheDocument();
    expect(within(segments[1]!).getByText('Nothing reviewed yet.')).toBeInTheDocument();
    expect(api.getChangesHistory).toHaveBeenCalledWith('ws-1');

    const batch = within(segments[0]!).getByRole('button', { name: /^3 files reviewed · / });
    expect(within(segments[0]!).getByRole('button', { name: /^1 file reviewed · / })).toBeInTheDocument();
    fireEvent.click(batch);
    expect(onOpenReview).toHaveBeenCalledWith('review-3');
  });

  it('says nothing was reviewed when there are no segments', async () => {
    const { api } = fakeChangesApi();
    renderWithLocalization(
      <ChangesHistory active api={api} onOpenReview={vi.fn()} workspaceId="ws-1" />
    );
    expect(await screen.findByText('Nothing reviewed yet.')).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Change history' })).not.toBeInTheDocument();
  });

  it('shows an alert when the history cannot be read', async () => {
    const { api } = fakeChangesApi();
    api.getChangesHistory.mockRejectedValue(new Error('broken'));
    renderWithLocalization(
      <ChangesHistory active api={api} onOpenReview={vi.fn()} workspaceId="ws-1" />
    );
    expect(await screen.findByRole('alert')).toHaveTextContent('Lumora could not read changes. Try again.');
  });

  it('marks and scrolls to the highlighted session', async () => {
    const scrollIntoView = vi.fn();
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: scrollIntoView });
    setup({ highlightSessionId: 'session-2' });

    const list = await screen.findByRole('list', { name: 'Change history' });
    const segments = within(list).getAllByRole('listitem');
    expect(segments[0]).toHaveAttribute('data-highlighted', 'true');
    expect(segments[1]).not.toHaveAttribute('data-highlighted');
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    delete (HTMLElement.prototype as { scrollIntoView?: unknown }).scrollIntoView;
  });

  it('loads nothing while inactive and reloads for another workspace', async () => {
    const { api, rerender } = setup({ active: false });
    await act(async () => undefined);
    expect(api.getChangesHistory).not.toHaveBeenCalled();

    rerender({ active: true });
    await screen.findByRole('list', { name: 'Change history' });
    rerender({ active: true, workspaceId: 'ws-2' });
    await act(async () => undefined);
    expect(api.getChangesHistory).toHaveBeenLastCalledWith('ws-2');
  });

  it('ignores a response for a workspace no longer shown', async () => {
    const { api } = fakeChangesApi();
    let finishFirst!: (value: History) => void;
    api.getChangesHistory
      .mockImplementationOnce(() => new Promise((resolve) => { finishFirst = resolve; }))
      .mockResolvedValueOnce({ segments: [] });
    const element = (workspaceId: string) => (
      <ChangesHistory active api={api} onOpenReview={vi.fn()} workspaceId={workspaceId} />
    );
    const view = renderWithLocalization(element('ws-1'));
    view.rerender(element('ws-2'));
    expect(await screen.findByText('Nothing reviewed yet.')).toBeInTheDocument();
    await act(async () => finishFirst(history));
    expect(screen.queryByRole('list', { name: 'Change history' })).not.toBeInTheDocument();
  });
});
