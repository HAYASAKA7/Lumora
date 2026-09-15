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

function cssWidth(): string {
  return screen.getByRole('complementary', { name: 'Changes' }).style.getPropertyValue('--changes-panel-width');
}

beforeEach(() => {
  Object.defineProperty(window, 'localStorage', { configurable: true, value: createLocalStorage() });
});

afterEach(() => {
  window.localStorage.clear();
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
    fireEvent.keyDown(separator(), { key: 'ArrowLeft' });
    expect(panelWidth()).toBe(start + 24);
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
    expect(cssWidth()).toBe(`${start + 40}px`);
    expect(window.localStorage.getItem(CHANGES_PANEL_WIDTH_KEY)).toBeNull();
    fireEvent.pointerUp(separator(), { clientX: 460, pointerId: 1 });

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
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
    expect(cssWidth()).toBe(`${start}px`);
    fireEvent.pointerUp(separator(), { clientX: 400, pointerId: 1 });
    expect(panelWidth()).toBe(start);

    fireEvent.pointerDown(separator(), { clientX: 500, pointerId: 2, button: 0 });
    fireEvent.pointerMove(separator(), { clientX: 420, pointerId: 2 });
    fireEvent.pointerCancel(separator(), { pointerId: 2 });
    expect(cssWidth()).toBe(`${start}px`);
    expect(window.localStorage.getItem(CHANGES_PANEL_WIDTH_KEY)).toBeNull();
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

  it('renders no native tooltips or selects', async () => {
    const { api } = fakeChangesApi();
    const { container } = renderPanel(api);
    await findFileList();
    expect(container.querySelector('[title]')).toBeNull();
    expect(container.querySelector('select')).toBeNull();
  });
});
