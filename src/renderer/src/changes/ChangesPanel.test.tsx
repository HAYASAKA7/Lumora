import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ChangesSource } from '../../../shared/contracts';
import {
  createLocalStorage,
  fakeChangesApi,
  findFileList,
  openFileMenu,
  rowFor,
  selectButton,
  sessionSource,
  sessionSummary,
  summaryFor,
  uncommittedSource
} from '../test/changes-test-support';
import { renderWithLocalization } from '../test/render-with-localization';
import { CHANGES_PANEL_WIDTH_KEY } from './changes-panel-preference';
import { ChangesPanel } from './ChangesPanel';
import type { ChangesApi } from './useWorkspaceChanges';

interface PanelOptions {
  source?: ChangesSource;
  active?: boolean;
  onMaximizedChange?(maximized: boolean): void;
  onParentKeyDown?(): void;
}

function renderPanel(api: ChangesApi, options: PanelOptions = {}) {
  const onClose = vi.fn();
  const view = renderWithLocalization(
    <div onKeyDown={options.onParentKeyDown}>
      <ChangesPanel
        api={api}
        onClose={onClose}
        source={options.source ?? sessionSource}
        {...(options.active === undefined ? {} : { active: options.active })}
        {...(options.onMaximizedChange === undefined ? {} : { onMaximizedChange: options.onMaximizedChange })}
      />
    </div>
  );
  return { ...view, onClose };
}

function separator(): HTMLElement {
  return screen.getByRole('separator', { name: 'Resize changes' });
}

function panelWidth(): number {
  return Number(separator().getAttribute('aria-valuenow'));
}

function columnWidth(): string {
  const parent = screen.getByRole('complementary', { name: 'Changes' }).parentElement;
  return parent?.style.getPropertyValue('--changes-column-width') ?? '';
}

function guideShown(): boolean {
  return separator().dataset.dragging === 'true';
}

function guideOffset(): string {
  return separator().style.getPropertyValue('--changes-resize-guide-offset');
}

function stubResizeObserver() {
  const callbacks: { callback: ResizeObserverCallback; targets: Element[] }[] = [];
  vi.stubGlobal('ResizeObserver', class {
    private readonly record: { callback: ResizeObserverCallback; targets: Element[] };
    constructor(callback: ResizeObserverCallback) {
      this.record = { callback, targets: [] };
      callbacks.push(this.record);
    }
    observe(target: Element) {
      this.record.targets.push(target);
    }
    disconnect() {
      this.record.targets = [];
    }
    unobserve() {}
  });
  return (target: Element) => {
    for (const record of callbacks.filter((entry) => entry.targets.includes(target))) {
      record.callback([], {} as ResizeObserver);
    }
  };
}

beforeEach(() => {
  Object.defineProperty(window, 'localStorage', { configurable: true, value: createLocalStorage() });
});

afterEach(() => {
  window.localStorage.clear();
  vi.unstubAllGlobals();
});

describe('ChangesPanel', () => {
  it('lists the source changes with notices', async () => {
    const { api } = fakeChangesApi();
    renderPanel(api);

    const list = await findFileList();
    expect(within(list).getAllByRole('listitem')).toHaveLength(2);
    expect(screen.getByText(/Tracking started after the agent began/)).toBeInTheDocument();
    expect(screen.getByText('Committed (1 file)')).toBeInTheDocument();
  });

  it('loads nothing while inactive', async () => {
    const { api } = fakeChangesApi();
    renderPanel(api, { active: false });
    await act(async () => undefined);
    expect(api.getChangesSummary).not.toHaveBeenCalled();
  });

  it('switches to all uncommitted changes without review actions', async () => {
    const { api } = fakeChangesApi((source) =>
      source.kind === 'session' && source.view === 'uncommitted'
        ? summaryFor(source, { state: 'unavailable', unavailableReason: 'not-a-repository' })
        : sessionSummary
    );
    renderPanel(api);
    await findFileList();

    fireEvent.click(screen.getByRole('button', { name: 'All uncommitted' }));

    expect(await screen.findByText('All uncommitted is available only in a git repository.')).toBeInTheDocument();
    expect(api.getChangesSummary).toHaveBeenCalledWith(uncommittedSource);
    expect(screen.getByRole('button', { name: 'All uncommitted' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByRole('button', { name: 'Mark all reviewed' })).not.toBeInTheDocument();
  });

  it('reloads when the session count changes and ignores other sessions', async () => {
    const { api, emit } = fakeChangesApi();
    renderPanel(api);
    await findFileList();
    const calls = api.getChangesSummary.mock.calls.length;

    await act(async () => emit('other'));
    expect(api.getChangesSummary).toHaveBeenCalledTimes(calls);

    await act(async () => emit('r1'));
    await waitFor(() => expect(api.getChangesSummary).toHaveBeenCalledTimes(calls + 1));
  });

  it('resizes from the keyboard and saves only changed widths', async () => {
    const { api } = fakeChangesApi();
    renderPanel(api);
    await findFileList();
    const setItem = vi.spyOn(window.localStorage, 'setItem');

    const start = panelWidth();
    expect(columnWidth()).toBe(`${start}px`);
    fireEvent.keyDown(separator(), { key: 'ArrowLeft' });
    expect(panelWidth()).toBe(start + 24);
    expect(columnWidth()).toBe(`${start + 24}px`);
    expect(window.localStorage.getItem(CHANGES_PANEL_WIDTH_KEY)).toBe(String(start + 24));
    fireEvent.keyDown(separator(), { key: 'ArrowRight' });
    expect(panelWidth()).toBe(start);

    fireEvent.keyDown(separator(), { key: 'Home' });
    expect(panelWidth()).toBe(320);
    fireEvent.keyDown(separator(), { key: 'ArrowRight' });
    expect(panelWidth()).toBe(320);
    fireEvent.keyDown(separator(), { key: 'End' });
    expect(panelWidth()).toBe(Number(separator().getAttribute('aria-valuemax')));
    expect(setItem).toHaveBeenCalledTimes(4);
  });

  it('toggles the maximized size and hides the separator while maximized', async () => {
    const { api } = fakeChangesApi();
    const onMaximizedChange = vi.fn();
    renderPanel(api, { onMaximizedChange });
    await findFileList();

    const panel = screen.getByRole('complementary', { name: 'Changes' });
    expect(panel).toHaveAttribute('data-maximized', 'false');
    fireEvent.click(screen.getByRole('button', { name: 'Maximize changes' }));
    expect(panel).toHaveAttribute('data-maximized', 'true');
    expect(onMaximizedChange).toHaveBeenLastCalledWith(true);
    expect(screen.queryByRole('separator')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Restore changes size' }));
    expect(panel).toHaveAttribute('data-maximized', 'false');
    expect(onMaximizedChange).toHaveBeenLastCalledWith(false);
    expect(separator()).toBeInTheDocument();
  });

  it('commits a pointer drag once on release', async () => {
    const { api } = fakeChangesApi();
    renderPanel(api);
    await findFileList();

    const start = panelWidth();
    fireEvent.pointerDown(separator(), { clientX: 500, pointerId: 1, button: 0 });
    fireEvent.pointerMove(separator(), { clientX: 460, pointerId: 1 });
    // The column keeps its width while a guide shows where the edge will land.
    expect(columnWidth()).toBe(`${start}px`);
    expect(guideShown()).toBe(true);
    expect(guideOffset()).toBe('-40px');
    expect(window.localStorage.getItem(CHANGES_PANEL_WIDTH_KEY)).toBeNull();
    fireEvent.pointerUp(separator(), { clientX: 460, pointerId: 1 });

    expect(guideShown()).toBe(false);
    expect(columnWidth()).toBe(`${start + 40}px`);
    expect(panelWidth()).toBe(start + 40);
    expect(window.localStorage.getItem(CHANGES_PANEL_WIDTH_KEY)).toBe(String(start + 40));
  });

  it('cancels a drag on Escape or pointer cancel without closing', async () => {
    const { api } = fakeChangesApi();
    const { onClose } = renderPanel(api);
    await findFileList();
    const start = panelWidth();

    fireEvent.pointerDown(separator(), { clientX: 500, pointerId: 1, button: 0 });
    fireEvent.pointerMove(separator(), { clientX: 400, pointerId: 1 });
    expect(guideShown()).toBe(true);
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
    expect(guideShown()).toBe(false);
    expect(columnWidth()).toBe(`${start}px`);
    fireEvent.pointerUp(separator(), { clientX: 400, pointerId: 1 });
    expect(panelWidth()).toBe(start);

    fireEvent.pointerDown(separator(), { clientX: 500, pointerId: 2, button: 0 });
    fireEvent.pointerMove(separator(), { clientX: 420, pointerId: 2 });
    fireEvent.pointerCancel(separator(), { pointerId: 2 });
    expect(guideShown()).toBe(false);
    expect(columnWidth()).toBe(`${start}px`);
    expect(window.localStorage.getItem(CHANGES_PANEL_WIDTH_KEY)).toBeNull();
  });

  it('clamps the column to the parent width as the parent resizes without saving it', async () => {
    const resize = stubResizeObserver();
    let parentWidth = 1000;
    const clientWidth = vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function (this: HTMLElement) {
      return this.querySelector(':scope > .changes-panel') === null ? 0 : parentWidth;
    });
    window.localStorage.setItem(CHANGES_PANEL_WIDTH_KEY, '640');
    const setItem = vi.spyOn(window.localStorage, 'setItem');
    const { api } = fakeChangesApi();
    const { unmount } = renderPanel(api);
    await findFileList();
    const parent = screen.getByRole('complementary', { name: 'Changes' }).parentElement as HTMLElement;

    expect(columnWidth()).toBe('640px');
    expect(separator()).toHaveAttribute('aria-valuemax', '700');

    parentWidth = 600;
    act(() => resize(parent));
    expect(columnWidth()).toBe('420px');
    expect(separator()).toHaveAttribute('aria-valuemax', '420');

    parentWidth = 1200;
    act(() => resize(parent));
    expect(columnWidth()).toBe('640px');
    expect(setItem).not.toHaveBeenCalled();

    unmount();
    expect(parent.style.getPropertyValue('--changes-column-width')).toBe('');
    clientWidth.mockRestore();
  });

  it('closes on Escape without letting it reach the parent unless a file menu is open', async () => {
    const { api } = fakeChangesApi();
    const onParentKeyDown = vi.fn();
    const { onClose } = renderPanel(api, { onParentKeyDown });
    await findFileList();

    openFileMenu('src/login.ts');
    fireEvent.keyDown(within(rowFor('src/login.ts')).getByRole('button', { name: 'File actions' }), { key: 'Escape' });
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    onParentKeyDown.mockClear();

    fireEvent.keyDown(selectButton('src/login.ts'), { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onParentKeyDown).not.toHaveBeenCalled();
  });

  describe('history', () => {
    const workspaceSource: ChangesSource = { kind: 'workspace', workspaceId: 'ws-1' };
    const reviewSource: ChangesSource = { kind: 'review', reviewId: 'review-1' };
    const history = {
      segments: [{
        ownerId: 'owner-1',
        ownerKind: 'terminal' as const,
        catalogSessionId: null,
        createdAt: '2026-09-15T00:00:00.000Z',
        endedAt: null,
        reviews: [{ reviewId: 'review-1', fileCount: 2, reviewedAt: '2026-09-15T01:00:00.000Z' }]
      }]
    };

    function historyApi() {
      const fake = fakeChangesApi((source) =>
        source.kind === 'review'
          ? summaryFor(source, { files: [summaryFile('src/reviewed.ts')] })
          : sessionSummary
      );
      fake.api.getChangesHistory.mockResolvedValue(history);
      return fake;
    }

    function summaryFile(path: string) {
      return { path, oldPath: null, status: 'modified' as const, additions: 1, deletions: 0, binary: false };
    }

    it('switches a workspace source to history, opens a batch and goes back', async () => {
      const { api } = historyApi();
      renderPanel(api, { source: workspaceSource });
      await findFileList();

      expect(screen.getByRole('button', { name: 'All uncommitted' })).toHaveAttribute('aria-pressed', 'true');
      fireEvent.click(screen.getByRole('button', { name: 'History' }));
      expect(screen.getByRole('button', { name: 'History' })).toHaveAttribute('aria-pressed', 'true');
      await screen.findByRole('list', { name: 'Change history' });
      expect(api.getChangesHistory).toHaveBeenCalledWith('ws-1');

      fireEvent.click(screen.getByRole('button', { name: /^2 files reviewed · / }));
      expect(await screen.findByText('src/reviewed.ts')).toBeInTheDocument();
      expect(api.getChangesSummary).toHaveBeenLastCalledWith(reviewSource);
      expect(screen.queryByRole('button', { name: 'History' })).not.toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: 'Back to history' }));
      expect(await screen.findByRole('list', { name: 'Change history' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'History' })).toHaveAttribute('aria-pressed', 'true');

      fireEvent.click(screen.getByRole('button', { name: 'All uncommitted' }));
      await findFileList();
      expect(api.getChangesSummary).toHaveBeenLastCalledWith(workspaceSource);
    });

    it('opens straight into history', async () => {
      const { api } = historyApi();
      render(api, workspaceSource, 'history');
      expect(await screen.findByRole('list', { name: 'Change history' })).toBeInTheDocument();
      expect(api.getChangesSummary).not.toHaveBeenCalled();
    });

    it('offers history for a session once its workspace is known', async () => {
      const { api } = historyApi();
      let finish!: (summary: typeof sessionSummary) => void;
      api.getChangesSummary.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
      renderPanel(api);

      expect(screen.getByRole('button', { name: 'History' })).toBeDisabled();
      await act(async () => finish(sessionSummary));
      await findFileList();
      fireEvent.click(screen.getByRole('button', { name: 'History' }));
      await screen.findByRole('list', { name: 'Change history' });
      expect(api.getChangesHistory).toHaveBeenCalledWith('ws-1');
      expect(screen.getByRole('button', { name: 'This session' })).toHaveAttribute('aria-pressed', 'false');

      fireEvent.click(screen.getByRole('button', { name: /^2 files reviewed · / }));
      await screen.findByText('src/reviewed.ts');
      fireEvent.click(screen.getByRole('button', { name: 'Back to history' }));
      await screen.findByRole('list', { name: 'Change history' });

      fireEvent.click(screen.getByRole('button', { name: 'This session' }));
      await findFileList();
      expect(api.getChangesSummary).toHaveBeenLastCalledWith(sessionSource);
      expect(screen.getByRole('button', { name: 'Mark all reviewed' })).toBeInTheDocument();
    });

    it('refreshes the history from its toolbar', async () => {
      const { api } = historyApi();
      render(api, workspaceSource, 'history');
      await screen.findByRole('list', { name: 'Change history' });
      expect(api.getChangesHistory).toHaveBeenCalledTimes(1);

      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Refresh changes' }));
      });
      expect(api.getChangesHistory).toHaveBeenCalledTimes(2);
    });

    it('goes back to the history on Escape while a batch is shown', async () => {
      const { api } = historyApi();
      const { onClose } = render(api, workspaceSource, 'history');
      fireEvent.click(await screen.findByRole('button', { name: /^2 files reviewed · / }));
      await screen.findByText('src/reviewed.ts');

      fireEvent.keyDown(screen.getByRole('button', { name: 'Back to history' }), { key: 'Escape' });
      expect(onClose).not.toHaveBeenCalled();
      await screen.findByRole('list', { name: 'Change history' });
      expect(screen.getByRole('button', { name: 'History' })).toHaveFocus();

      fireEvent.keyDown(screen.getByRole('button', { name: 'History' }), { key: 'Escape' });
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('opens a session into history once its workspace is known', async () => {
      const { api } = historyApi();
      let finish!: (summary: typeof sessionSummary) => void;
      api.getChangesSummary.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
      render(api, sessionSource, 'history');

      expect(screen.getByRole('button', { name: 'This session' })).toHaveAttribute('aria-pressed', 'true');
      expect(screen.getByRole('button', { name: 'History' })).toHaveAttribute('aria-pressed', 'false');
      expect(screen.getByRole('button', { name: 'History' })).toBeDisabled();
      await act(async () => finish(sessionSummary));

      expect(await screen.findByRole('list', { name: 'Change history' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'History' })).toHaveAttribute('aria-pressed', 'true');
    });

    function render(api: ChangesApi, source: ChangesSource, initialMode: 'changes' | 'history') {
      const onClose = vi.fn();
      const view = renderWithLocalization(
        <div>
          <ChangesPanel api={api} initialMode={initialMode} onClose={onClose} source={source} />
        </div>
      );
      return { ...view, onClose };
    }
  });

  it('renders no native tooltips or selects', async () => {
    const { api } = fakeChangesApi();
    const { container } = renderPanel(api);
    await findFileList();
    expect(container.querySelector('[title]')).toBeNull();
    expect(container.querySelector('select')).toBeNull();
  });
});
