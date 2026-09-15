import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  ChangedFile,
  ChangesCount,
  ChangesFileDiff,
  ChangesSource,
  ChangesSummary
} from '../../../shared/contracts';
import { renderWithLocalization } from '../test/render-with-localization';
import { CHANGES_PANEL_WIDTH_KEY } from './changes-panel-preference';
import { ChangesPanel } from './ChangesPanel';
import type { ChangesApi } from './useWorkspaceChanges';

const sessionSource: ChangesSource = { kind: 'session', ownerId: 'r1', view: 'session' };

function changed(path: string, status: ChangedFile['status'] = 'modified'): ChangedFile {
  return { path, oldPath: null, status, additions: 3, deletions: 1, binary: false };
}

function summaryFor(source: ChangesSource, overrides: Partial<ChangesSummary> = {}): ChangesSummary {
  return {
    source,
    workspaceId: 'ws-1',
    state: 'ready',
    unavailableReason: null,
    baselineLate: false,
    sharedWorkspace: false,
    files: [],
    committed: [],
    truncated: false,
    checkedAt: '2026-09-15T00:00:00.000Z',
    ...overrides
  };
}

const sessionSummary = summaryFor(sessionSource, {
  baselineLate: true,
  files: [changed('src/login.ts'), changed('src/new.ts', 'added')],
  committed: [changed('docs/readme.md')]
});

function fakeApi(summaries: (source: ChangesSource) => ChangesSummary = () => sessionSummary) {
  const listeners = new Set<(count: ChangesCount) => void>();
  const api = {
    getChangesSummary: vi.fn(async (source: ChangesSource) => summaries(source)),
    getChangesFileDiff: vi.fn(async (_source: ChangesSource, path: string): Promise<ChangesFileDiff> => ({
      path,
      patch: '@@ -1 +1 @@\n-old\n+new',
      binary: false,
      truncated: false
    })),
    markChangesReviewed: vi.fn(async () => summaryFor(sessionSource)),
    openChangedFile: vi.fn(async () => undefined),
    writeClipboardText: vi.fn(async () => undefined),
    getChangesHistory: vi.fn(async () => ({ segments: [] })),
    onChangesCount: vi.fn((listener: (count: ChangesCount) => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    })
  };
  const emit = (ownerId: string) => {
    for (const listener of listeners) {
      listener({ ownerId, workspaceId: 'ws-1', state: 'ready', changedFileCount: 2 });
    }
  };
  return { api: api as unknown as ChangesApi & typeof api, emit };
}

function renderPanel(api: ChangesApi, source: ChangesSource = sessionSource, onClose = vi.fn()) {
  const view = renderWithLocalization(<ChangesPanel api={api} onClose={onClose} source={source} />);
  return { ...view, onClose };
}

async function fileList() {
  return screen.findByRole('list', { name: 'Changed files' });
}

function rowFor(path: string): HTMLElement {
  const row = screen.getByText(path).closest('li');
  if (row === null) throw new Error(`no row for ${path}`);
  return row;
}

function selectButton(path: string): HTMLElement {
  const button = rowFor(path).querySelector<HTMLElement>('button[aria-pressed]');
  if (button === null) throw new Error(`no select button for ${path}`);
  return button;
}

function openFileMenu(path: string): HTMLElement {
  fireEvent.click(within(rowFor(path)).getByRole('button', { name: 'File actions' }));
  return screen.getByRole('menu', { name: 'File actions' });
}

function createLocalStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => {
      values.delete(key);
    },
    setItem: (key, value) => {
      values.set(key, value);
    }
  };
}

beforeEach(() => {
  Object.defineProperty(window, 'localStorage', { configurable: true, value: createLocalStorage() });
});

afterEach(() => {
  window.localStorage.clear();
});

describe('ChangesPanel', () => {
  it('lists changed files with notices and shows the diff of a selected file', async () => {
    const { api } = fakeApi();
    renderPanel(api);

    const list = await fileList();
    expect(within(list).getAllByRole('listitem')).toHaveLength(2);
    expect(screen.getByText(/Tracking started after the agent began/)).toBeInTheDocument();
    expect(screen.getByText('Committed (1 file)')).toBeInTheDocument();
    expect(screen.getByText('Select a file to see its changes.')).toBeInTheDocument();

    fireEvent.click(selectButton('src/login.ts'));

    expect(await screen.findByText('+new')).toBeInTheDocument();
    expect(api.getChangesFileDiff).toHaveBeenCalledWith(sessionSource, 'src/login.ts');
    expect(within(rowFor('src/login.ts')).getByRole('button', { pressed: true })).toBeInTheDocument();
  });

  it('marks one file or every listed file reviewed', async () => {
    const { api } = fakeApi();
    renderPanel(api);
    await fileList();

    const menu = openFileMenu('src/login.ts');
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Mark reviewed' }));
    await waitFor(() => expect(api.markChangesReviewed).toHaveBeenCalledWith('r1', ['src/login.ts']));

    api.getChangesSummary.mockResolvedValue(sessionSummary);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Refresh changes' }));
    });
    await fileList();
    fireEvent.click(screen.getByRole('button', { name: 'Mark all reviewed' }));
    await waitFor(() =>
      expect(api.markChangesReviewed).toHaveBeenLastCalledWith('r1', ['src/login.ts', 'src/new.ts'])
    );
  });

  it('shows a failed review as an error', async () => {
    const { api } = fakeApi();
    api.markChangesReviewed.mockRejectedValueOnce(new Error('broken'));
    renderPanel(api);
    await fileList();

    fireEvent.click(screen.getByRole('button', { name: 'Mark all reviewed' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Lumora could not read changes. Try again.');
  });

  it('switches to all uncommitted changes without review actions', async () => {
    const { api } = fakeApi((source) =>
      source.kind === 'session' && source.view === 'uncommitted'
        ? summaryFor(source, { state: 'unavailable', unavailableReason: 'not-a-repository' })
        : sessionSummary
    );
    renderPanel(api);
    await fileList();

    fireEvent.click(screen.getByRole('button', { name: 'All uncommitted' }));

    expect(await screen.findByText('All uncommitted is available only in a git repository.'))
      .toHaveAttribute('role', 'status');
    expect(api.getChangesSummary).toHaveBeenCalledWith({ kind: 'session', ownerId: 'r1', view: 'uncommitted' });
    expect(screen.getByRole('button', { name: 'All uncommitted' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByRole('button', { name: 'Mark all reviewed' })).not.toBeInTheDocument();
  });

  it('offers no per-file review in the uncommitted view', async () => {
    const uncommitted: ChangesSource = { kind: 'session', ownerId: 'r1', view: 'uncommitted' };
    const { api } = fakeApi(() => summaryFor(uncommitted, { files: [changed('src/login.ts')] }));
    renderPanel(api, uncommitted);
    await fileList();

    const menu = openFileMenu('src/login.ts');
    expect(within(menu).queryByRole('menuitem', { name: 'Mark reviewed' })).not.toBeInTheDocument();
    expect(within(menu).getByRole('menuitem', { name: 'Open' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Mark all reviewed' })).not.toBeInTheDocument();
  });

  it('reloads when the session count changes and ignores other sessions', async () => {
    const { api, emit } = fakeApi();
    renderPanel(api);
    await fileList();
    const calls = api.getChangesSummary.mock.calls.length;

    await act(async () => emit('other'));
    expect(api.getChangesSummary).toHaveBeenCalledTimes(calls);

    await act(async () => emit('r1'));
    await waitFor(() => expect(api.getChangesSummary).toHaveBeenCalledTimes(calls + 1));
  });

  it('resizes from the keyboard and toggles the maximized size', async () => {
    const { api } = fakeApi();
    renderPanel(api);
    await fileList();

    const separator = screen.getByRole('separator', { name: 'Resize changes' });
    const start = Number(separator.getAttribute('aria-valuenow'));
    fireEvent.keyDown(separator, { key: 'ArrowLeft' });
    expect(Number(separator.getAttribute('aria-valuenow'))).toBe(start + 24);
    expect(window.localStorage.getItem(CHANGES_PANEL_WIDTH_KEY)).toBe(String(start + 24));
    fireEvent.keyDown(separator, { key: 'ArrowRight' });
    expect(Number(separator.getAttribute('aria-valuenow'))).toBe(start);

    const panel = screen.getByRole('complementary', { name: 'Changes' });
    expect(panel).toHaveAttribute('data-maximized', 'false');
    fireEvent.click(screen.getByRole('button', { name: 'Maximize changes' }));
    expect(panel).toHaveAttribute('data-maximized', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Restore changes size' }));
    expect(panel).toHaveAttribute('data-maximized', 'false');
  });

  it('commits a pointer drag once on release', async () => {
    const { api } = fakeApi();
    renderPanel(api);
    await fileList();

    const separator = screen.getByRole('separator', { name: 'Resize changes' });
    const start = Number(separator.getAttribute('aria-valuenow'));
    fireEvent.pointerDown(separator, { clientX: 500, pointerId: 1, button: 0 });
    fireEvent.pointerMove(separator, { clientX: 460, pointerId: 1 });
    expect(window.localStorage.getItem(CHANGES_PANEL_WIDTH_KEY)).toBeNull();
    fireEvent.pointerUp(separator, { clientX: 460, pointerId: 1 });

    expect(Number(separator.getAttribute('aria-valuenow'))).toBe(start + 40);
    expect(window.localStorage.getItem(CHANGES_PANEL_WIDTH_KEY)).toBe(String(start + 40));
  });

  it('closes on Escape unless a file menu is open', async () => {
    const { api } = fakeApi();
    const { onClose } = renderPanel(api);
    await fileList();

    openFileMenu('src/login.ts');
    fireEvent.keyDown(within(rowFor('src/login.ts')).getByRole('button', { name: 'File actions' }), { key: 'Escape' });
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.keyDown(selectButton('src/login.ts'), { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('opens, reveals and copies a file and reports a failed open', async () => {
    const { api } = fakeApi();
    renderPanel(api);
    await fileList();

    fireEvent.click(within(openFileMenu('src/login.ts')).getByRole('menuitem', { name: 'Show in folder' }));
    expect(api.openChangedFile).toHaveBeenCalledWith(sessionSource, 'src/login.ts', 'reveal');

    fireEvent.click(within(openFileMenu('src/login.ts')).getByRole('menuitem', { name: 'Copy path' }));
    expect(api.writeClipboardText).toHaveBeenCalledWith('src/login.ts');

    api.openChangedFile.mockRejectedValueOnce(new Error('blocked'));
    fireEvent.click(within(openFileMenu('src/new.ts')).getByRole('menuitem', { name: 'Open' }));
    expect(api.openChangedFile).toHaveBeenCalledWith(sessionSource, 'src/new.ts', 'open');
    expect(await screen.findByRole('alert')).toHaveTextContent('Lumora could not read changes. Try again.');
  });

  it('moves the selection with the arrow keys', async () => {
    const { api } = fakeApi();
    renderPanel(api);
    await fileList();

    fireEvent.click(selectButton('src/login.ts'));
    fireEvent.keyDown(selectButton('src/login.ts'), { key: 'ArrowDown' });

    const next = within(rowFor('src/new.ts')).getByRole('button', { pressed: true });
    expect(next).toHaveFocus();
    await waitFor(() => expect(api.getChangesFileDiff).toHaveBeenCalledWith(sessionSource, 'src/new.ts'));

    fireEvent.keyDown(next, { key: 'ArrowUp' });
    expect(within(rowFor('src/login.ts')).getByRole('button', { pressed: true })).toHaveFocus();
  });

  it('renders no native tooltips or selects', async () => {
    const { api } = fakeApi();
    const { container } = renderPanel(api);
    await fileList();
    fireEvent.click(selectButton('src/login.ts'));
    await screen.findByText('+new');

    expect(container.querySelector('[title]')).toBeNull();
    expect(container.querySelector('select')).toBeNull();
  });

  it('shows a workspace source without a view switch or review actions', async () => {
    const source: ChangesSource = { kind: 'workspace', workspaceId: 'ws-1' };
    const { api } = fakeApi(() => summaryFor(source));
    renderPanel(api, source);

    expect(await screen.findByText('No uncommitted changes.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'This session' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Mark all reviewed' })).not.toBeInTheDocument();
    expect(api.onChangesCount).not.toHaveBeenCalled();
  });

  it('describes an empty review and an empty session', async () => {
    const review: ChangesSource = { kind: 'review', reviewId: 'rev-1' };
    const { api } = fakeApi((source) => summaryFor(source));
    const { unmount } = renderPanel(api, review);
    expect(await screen.findByText('No files in this review.')).toBeInTheDocument();
    unmount();

    renderPanel(api);
    expect(await screen.findByText('No changes since this session started.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Mark all reviewed' })).toBeDisabled();
  });
});
