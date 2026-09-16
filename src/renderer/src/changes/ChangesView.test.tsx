import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ChangesFileDiff, ChangesSource, ChangesSummary } from '../../../shared/contracts';
import {
  changed,
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
import { ChangesView } from './ChangesView';
import type { ChangesApi } from './useWorkspaceChanges';

const ACTION_FAILED = "That didn't work. Try again.";

function renderView(api: ChangesApi, source: ChangesSource = sessionSource) {
  return renderWithLocalization(<ChangesView active api={api} source={source} />);
}

function committedGroup(): HTMLDetailsElement {
  const details = screen.getByText(/^Committed \(/).closest('details');
  if (details === null) throw new Error('no committed group');
  return details;
}

function setCommittedOpen(open: boolean): void {
  const details = committedGroup();
  act(() => {
    details.open = open;
    details.dispatchEvent(new Event('toggle'));
  });
}

function openCommitted(): void {
  setCommittedOpen(true);
}

function manyFiles(count: number): ChangesSummary {
  return summaryFor(sessionSource, {
    files: Array.from({ length: count }, (_, index) => changed(`src/file-${index}.ts`))
  });
}

function diffWith(overrides: Partial<ChangesFileDiff>) {
  return async (_source: ChangesSource, path: string): Promise<ChangesFileDiff> => ({
    path, patch: '+new', binary: false, truncated: false, ...overrides
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('ChangesView', () => {
  it('lists changed files and shows the diff of a selected file', async () => {
    const { api } = fakeChangesApi();
    renderView(api);

    const list = await findFileList();
    expect(within(list).getAllByRole('listitem')).toHaveLength(2);
    expect(screen.getByText(/Tracking started after the agent began/).closest('[aria-live="polite"]')).not.toBeNull();
    expect(screen.getByText('Committed (1 file)')).toBeInTheDocument();
    openCommitted();
    expect(screen.getByRole('list', { name: 'Committed files' })).toBeInTheDocument();
    expect(screen.getByText('Select a file to see its changes.')).toBeInTheDocument();

    fireEvent.click(selectButton('src/login.ts'));

    expect(selectButton('src/login.ts')).toHaveAttribute('aria-current', 'true');
    expect(selectButton('src/new.ts')).not.toHaveAttribute('aria-current');
    expect(screen.getByText('Loading…')).not.toHaveAttribute('role');
    expect(await screen.findByText('+new')).toBeInTheDocument();
    expect(api.getChangesFileDiff).toHaveBeenCalledWith(sessionSource, 'src/login.ts');
  });

  it('marks one file or every listed file reviewed', async () => {
    const { api } = fakeChangesApi();
    renderView(api);
    await findFileList();

    fireEvent.click(within(openFileMenu('src/login.ts')).getByRole('menuitem', { name: 'Mark reviewed' }));
    await waitFor(() => expect(api.markChangesReviewed).toHaveBeenCalledWith('r1', ['src/login.ts']));

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Refresh changes' }));
    });
    await findFileList();
    fireEvent.click(screen.getByRole('button', { name: 'Mark all reviewed' }));
    await waitFor(() =>
      expect(api.markChangesReviewed).toHaveBeenLastCalledWith('r1', ['src/login.ts', 'src/new.ts'])
    );
  });

  it('sends one request for a double click on mark all reviewed', async () => {
    const { api } = fakeChangesApi();
    let finish!: (summary: ChangesSummary) => void;
    api.markChangesReviewed.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    renderView(api);
    await findFileList();

    const button = screen.getByRole('button', { name: 'Mark all reviewed' });
    fireEvent.click(button);
    fireEvent.click(button);

    expect(button).toBeDisabled();
    expect(api.markChangesReviewed).toHaveBeenCalledTimes(1);
    await act(async () => finish(summaryFor(sessionSource)));
    expect(await screen.findByText('No changes since this session started.')).toBeInTheDocument();
  });

  it('reports a failed action and clears it when a new summary lands', async () => {
    const { api, emit } = fakeChangesApi();
    api.markChangesReviewed.mockRejectedValueOnce(new Error('broken'));
    renderView(api);
    await findFileList();

    fireEvent.click(screen.getByRole('button', { name: 'Mark all reviewed' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(ACTION_FAILED);
    expect(screen.getByRole('button', { name: 'Mark all reviewed' })).toBeEnabled();

    await act(async () => emit('r1'));
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
  });

  it('opens, reveals and copies a file and reports each failure', async () => {
    const { api } = fakeChangesApi();
    renderView(api);
    await findFileList();

    fireEvent.click(within(openFileMenu('src/login.ts')).getByRole('menuitem', { name: 'Show in folder' }));
    expect(api.openChangedFile).toHaveBeenCalledWith(sessionSource, 'src/login.ts', 'reveal');
    fireEvent.click(within(openFileMenu('src/login.ts')).getByRole('menuitem', { name: 'Copy path' }));
    expect(api.writeClipboardText).toHaveBeenCalledWith('src/login.ts');

    api.openChangedFile.mockRejectedValueOnce(new Error('blocked'));
    fireEvent.click(within(openFileMenu('src/new.ts')).getByRole('menuitem', { name: 'Open' }));
    expect(api.openChangedFile).toHaveBeenCalledWith(sessionSource, 'src/new.ts', 'open');
    expect(await screen.findByRole('alert')).toHaveTextContent(ACTION_FAILED);

    // A successful action clears the earlier failure so the copy failure below is its own.
    fireEvent.click(within(openFileMenu('src/new.ts')).getByRole('menuitem', { name: 'Show in folder' }));
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());

    api.writeClipboardText.mockRejectedValueOnce(new Error('denied'));
    fireEvent.click(within(openFileMenu('src/new.ts')).getByRole('menuitem', { name: 'Copy path' }));
    await waitFor(() => expect(api.writeClipboardText).toHaveBeenCalledTimes(2));
    expect(await screen.findByRole('alert')).toHaveTextContent(ACTION_FAILED);
  });

  it('acts on committed files without offering a review', async () => {
    const { api } = fakeChangesApi();
    renderView(api);
    await findFileList();

    openCommitted();
    const menu = openFileMenu('docs/readme.md');
    expect(within(menu).queryByRole('menuitem', { name: 'Mark reviewed' })).not.toBeInTheDocument();
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Open' }));
    expect(api.openChangedFile).toHaveBeenCalledWith(sessionSource, 'docs/readme.md', 'open');

    fireEvent.click(selectButton('docs/readme.md'));
    await waitFor(() => expect(api.getChangesFileDiff).toHaveBeenCalledWith(sessionSource, 'docs/readme.md'));
  });

  it('offers no review actions in the uncommitted view', async () => {
    const { api } = fakeChangesApi(() => summaryFor(uncommittedSource, { files: [changed('src/login.ts')] }));
    renderView(api, uncommittedSource);
    await findFileList();

    const menu = openFileMenu('src/login.ts');
    expect(within(menu).queryByRole('menuitem', { name: 'Mark reviewed' })).not.toBeInTheDocument();
    expect(within(menu).getByRole('menuitem', { name: 'Open' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Mark all reviewed' })).not.toBeInTheDocument();
  });

  it('asks to switch views through the segmented control', async () => {
    const { api } = fakeChangesApi();
    const onSourceChange = vi.fn();
    renderWithLocalization(<ChangesView active api={api} onSourceChange={onSourceChange} source={sessionSource} />);
    await findFileList();

    expect(screen.getByRole('button', { name: 'This session' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'All uncommitted' }));
    expect(onSourceChange).toHaveBeenCalledWith(uncommittedSource);
  });

  it('moves the selection with arrows, Home and End and stops at the ends', async () => {
    const { api } = fakeChangesApi(() => summaryFor(sessionSource, {
      files: [changed('a.ts'), changed('b.ts'), changed('c.ts')]
    }));
    renderView(api);
    await findFileList();

    fireEvent.keyDown(selectButton('a.ts'), { key: 'ArrowUp' });
    expect(selectButton('a.ts')).toHaveAttribute('aria-current', 'true');
    expect(selectButton('a.ts')).toHaveFocus();

    fireEvent.keyDown(selectButton('a.ts'), { key: 'ArrowDown' });
    expect(selectButton('b.ts')).toHaveAttribute('aria-current', 'true');
    expect(selectButton('b.ts')).toHaveFocus();

    fireEvent.keyDown(selectButton('b.ts'), { key: 'End' });
    expect(selectButton('c.ts')).toHaveFocus();
    fireEvent.keyDown(selectButton('c.ts'), { key: 'ArrowDown' });
    expect(selectButton('c.ts')).toHaveAttribute('aria-current', 'true');

    fireEvent.keyDown(selectButton('c.ts'), { key: 'Home' });
    expect(selectButton('a.ts')).toHaveAttribute('aria-current', 'true');
    expect(selectButton('a.ts')).toHaveFocus();
    await waitFor(() => expect(api.getChangesFileDiff).toHaveBeenLastCalledWith(sessionSource, 'a.ts'));
  });

  it('keeps one tab stop in a file list', async () => {
    const { api } = fakeChangesApi(() => summaryFor(sessionSource, {
      files: [changed('a.ts'), changed('b.ts'), changed('c.ts')]
    }));
    renderView(api);
    await findFileList();

    expect(['a.ts', 'b.ts', 'c.ts'].map((path) => selectButton(path).tabIndex)).toEqual([0, -1, -1]);
    fireEvent.click(selectButton('b.ts'));
    expect(['a.ts', 'b.ts', 'c.ts'].map((path) => selectButton(path).tabIndex)).toEqual([-1, 0, -1]);
  });

  it('renders a large list in pages', async () => {
    const { api } = fakeChangesApi(() => manyFiles(5_000));
    renderView(api);

    const list = await findFileList();
    // Role queries over hundreds of rows are slow in jsdom; count the rows directly.
    expect(list.querySelectorAll(':scope > li')).toHaveLength(300);
    const more = screen.getByText('Show more (4,700 files not shown)');
    expect(more.tagName).toBe('BUTTON');

    fireEvent.click(more);

    expect(list.querySelectorAll(':scope > li')).toHaveLength(600);
    expect(screen.getByText('Show more (4,400 files not shown)')).toBeInTheDocument();
  });

  it('moves focus to the first newly shown row when the last page appears', async () => {
    const { api } = fakeChangesApi(() => manyFiles(301));
    renderView(api);
    const list = await findFileList();

    fireEvent.click(screen.getByText('Show more (1 file not shown)'));

    expect(list.querySelectorAll(':scope > li')).toHaveLength(301);
    expect(screen.queryByText(/^Show more/)).not.toBeInTheDocument();
    expect(selectButton('src/file-300.ts')).toHaveFocus();
  });

  it('renders committed rows only while the committed group is open', async () => {
    const { api } = fakeChangesApi();
    renderView(api);
    await findFileList();

    expect(screen.queryByRole('list', { name: 'Committed files' })).not.toBeInTheDocument();
    setCommittedOpen(true);
    expect(screen.getByRole('list', { name: 'Committed files' })).toBeInTheDocument();
    setCommittedOpen(false);
    expect(screen.queryByRole('list', { name: 'Committed files' })).not.toBeInTheDocument();
  });

  it.each([
    ['binary', { binary: true }, 'Binary file; no text changes to show.'],
    ['too large', { truncated: true }, 'This change is too large to show.']
  ])('explains a %s diff', async (_name, overrides, text) => {
    const { api } = fakeChangesApi();
    api.getChangesFileDiff.mockImplementation(diffWith(overrides));
    renderView(api);
    await findFileList();
    fireEvent.click(selectButton('src/login.ts'));
    expect(await screen.findByText(text)).toBeInTheDocument();
  });

  it('shows a failed diff as an alert', async () => {
    const { api } = fakeChangesApi();
    api.getChangesFileDiff.mockRejectedValue(new Error('broken'));
    renderView(api);
    await findFileList();
    fireEvent.click(selectButton('src/login.ts'));
    expect(await screen.findByRole('alert')).toHaveTextContent('Lumora could not read changes. Try again.');
  });

  it('names the previous path of a renamed file', async () => {
    const { api } = fakeChangesApi(() => summaryFor(sessionSource, {
      files: [changed('src/auth.ts', { status: 'renamed', oldPath: 'src/login.ts' })]
    }));
    renderView(api);
    await findFileList();
    fireEvent.click(selectButton('src/auth.ts'));
    expect(await screen.findByText('Renamed from src/login.ts')).toBeInTheDocument();
    expect(screen.getByText('+new')).toBeInTheDocument();
  });

  it('shows a failed workspace as an alert and leaves the diff pane empty', async () => {
    const { api } = fakeChangesApi(() => summaryFor(sessionSource, { state: 'unavailable', unavailableReason: 'failed' }));
    renderView(api);
    expect(await screen.findByRole('alert')).toHaveTextContent('Lumora could not read changes in this workspace.');
    expect(screen.queryByText('Select a file to see its changes.')).not.toBeInTheDocument();
  });

  it('announces a missing repository politely', async () => {
    const { api } = fakeChangesApi(() =>
      summaryFor(uncommittedSource, { state: 'unavailable', unavailableReason: 'not-a-repository' })
    );
    renderView(api, uncommittedSource);
    const notice = await screen.findByText('All uncommitted is available only in a git repository.');
    expect(notice.closest('[aria-live="polite"]')).not.toBeNull();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('leaves the diff pane empty while the summary loads', () => {
    const { api } = fakeChangesApi();
    api.getChangesSummary.mockImplementation(() => new Promise(() => undefined));
    renderView(api);
    expect(screen.queryByText('Select a file to see its changes.')).not.toBeInTheDocument();
  });

  it('lays the list beside the diff when wide', async () => {
    const observers: { callback: ResizeObserverCallback; targets: Element[] }[] = [];
    vi.stubGlobal('ResizeObserver', class {
      private readonly record: { callback: ResizeObserverCallback; targets: Element[] };
      constructor(callback: ResizeObserverCallback) {
        this.record = { callback, targets: [] };
        observers.push(this.record);
      }
      observe(target: Element) {
        this.record.targets.push(target);
      }
      disconnect() {}
      unobserve() {}
    });
    const { api } = fakeChangesApi();
    const { container } = renderView(api);
    await findFileList();
    const root = container.querySelector('.changes-view');
    expect(root).not.toHaveClass('is-wide');
    const resize = (width: number) => {
      for (const observer of observers.filter((entry) => root !== null && entry.targets.includes(root))) {
        observer.callback([{ contentRect: { width } } as ResizeObserverEntry], {} as ResizeObserver);
      }
    };

    act(() => resize(800));
    expect(root).toHaveClass('is-wide');
    act(() => resize(600));
    expect(root).not.toHaveClass('is-wide');
  });

  it('shows a workspace source without a view switch or review actions', async () => {
    const source: ChangesSource = { kind: 'workspace', workspaceId: 'ws-1' };
    const { api } = fakeChangesApi(() => summaryFor(source));
    renderView(api, source);

    expect(await screen.findByText('No uncommitted changes.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'This session' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Mark all reviewed' })).not.toBeInTheDocument();
    // The workspace view follows every session working in that workspace.
    expect(api.onChangesCount).toHaveBeenCalled();
  });

  it('describes an empty review and an empty session', async () => {
    const review: ChangesSource = { kind: 'review', reviewId: 'rev-1' };
    const { api } = fakeChangesApi((source) => summaryFor(source));
    const { unmount } = renderView(api, review);
    expect(await screen.findByText('No files in this review.')).toBeInTheDocument();
    unmount();

    renderView(api);
    expect(await screen.findByText('No changes since this session started.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Mark all reviewed' })).toBeDisabled();
  });

  it('opens a file row menu from the keyboard', async () => {
    const { api } = fakeChangesApi();
    renderView(api);
    await findFileList();
    const other = selectButton('src/new.ts');
    other.focus();
    fireEvent.keyDown(other, { key: 'ArrowRight' });
    expect(screen.getByRole('menu', { name: 'File actions' })).toBeInTheDocument();
    expect(within(rowFor('src/new.ts')).getByRole('button', { name: 'File actions' })).toHaveFocus();
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });

    const row = selectButton('src/login.ts');
    row.focus();
    fireEvent.keyDown(row, { key: 'ContextMenu' });

    expect(screen.getByRole('menu', { name: 'File actions' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Mark reviewed' }));
    await waitFor(() => expect(api.markChangesReviewed).toHaveBeenCalledWith('r1', ['src/login.ts']));
  });

  it('renders no native tooltips or selects', async () => {
    const { api } = fakeChangesApi(() => sessionSummary);
    const { container } = renderView(api);
    await findFileList();
    fireEvent.click(selectButton('src/login.ts'));
    await screen.findByText('+new');
    expect(rowFor('src/login.ts')).toBeInTheDocument();

    expect(container.querySelector('[title]')).toBeNull();
    expect(container.querySelector('select')).toBeNull();
  });
});
