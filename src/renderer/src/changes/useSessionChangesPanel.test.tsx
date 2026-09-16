import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';

import type { ChangesSummary } from '../../../shared/contracts';
import { fakeChangesApi, selectButton, sessionSummary } from '../test/changes-test-support';
import { renderWithLocalization } from '../test/render-with-localization';
import { ChangesPanel } from './ChangesPanel';
import { useSessionChangesPanel } from './useSessionChangesPanel';
import type { ChangesApi } from './useWorkspaceChanges';

function Harness({ api, enabled = true, ownerId }: { api: ChangesApi; enabled?: boolean; ownerId: string }): ReactNode {
  const changes = useSessionChangesPanel({ enabled, ownerId });
  return (
    <section className={`workspace${changes.workspaceClassName}`} data-testid="workspace">
      <button type="button" {...changes.buttonProps}>Changes</button>
      {changes.panelProps === null ? null : <ChangesPanel api={api} key={ownerId} {...changes.panelProps} />}
    </section>
  );
}

function changesButton(): HTMLElement {
  return screen.getByRole('button', { name: 'Changes' });
}

function panel(): HTMLElement | null {
  return screen.queryByRole('complementary', { name: 'Changes' });
}

describe('useSessionChangesPanel', () => {
  it('opens the panel for the session, moves focus into it and closes it again', async () => {
    const { api } = fakeChangesApi();
    renderWithLocalization(<Harness api={api} ownerId="r1" />);

    expect(changesButton()).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(changesButton());

    const aside = panel();
    expect(aside).not.toBeNull();
    expect(changesButton()).toHaveAttribute('aria-expanded', 'true');
    expect(changesButton()).toHaveAttribute('aria-controls', aside?.id);
    expect(screen.getByTestId('workspace')).toHaveClass('has-changes-panel');
    expect(aside?.contains(document.activeElement)).toBe(true);
    await waitFor(() => expect(api.getChangesSummary).toHaveBeenCalledWith({ kind: 'session', ownerId: 'r1', view: 'session' }));

    fireEvent.click(changesButton());
    expect(panel()).toBeNull();
    expect(screen.getByTestId('workspace')).not.toHaveClass('has-changes-panel');
  });

  it('moves focus from the close button to the file list once it first loads', async () => {
    const { api } = fakeChangesApi();
    let finish!: (summary: ChangesSummary) => void;
    api.getChangesSummary.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    renderWithLocalization(<Harness api={api} ownerId="r1" />);

    fireEvent.click(changesButton());
    expect(screen.getByRole('button', { name: 'Close changes' })).toHaveFocus();

    await act(async () => finish(sessionSummary));
    expect(selectButton('src/login.ts')).toHaveFocus();
  });

  it('leaves focus where the user moved it before the file list loads', async () => {
    const { api } = fakeChangesApi();
    let finish!: (summary: ChangesSummary) => void;
    api.getChangesSummary.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    renderWithLocalization(<Harness api={api} ownerId="r1" />);

    fireEvent.click(changesButton());
    const maximize = screen.getByRole('button', { name: 'Maximize changes' });
    maximize.focus();

    await act(async () => finish(sessionSummary));
    expect(maximize).toHaveFocus();
  });

  it('returns focus to the button when the panel closes itself', async () => {
    const { api } = fakeChangesApi();
    renderWithLocalization(<Harness api={api} ownerId="r1" />);
    fireEvent.click(changesButton());
    await act(async () => undefined);

    fireEvent.click(screen.getByRole('button', { name: 'Close changes' }));
    expect(panel()).toBeNull();
    expect(changesButton()).toHaveFocus();

    fireEvent.click(changesButton());
    await act(async () => undefined);
    fireEvent.keyDown(panel() as HTMLElement, { key: 'Escape' });
    expect(panel()).toBeNull();
    expect(changesButton()).toHaveFocus();
  });

  it('keeps each session its own open state and starts a switched panel restored', async () => {
    const { api } = fakeChangesApi();
    const view = renderWithLocalization(<Harness api={api} ownerId="r1" />);
    fireEvent.click(changesButton());
    await act(async () => undefined);
    fireEvent.click(screen.getByRole('button', { name: 'Maximize changes' }));
    expect(screen.getByTestId('workspace')).toHaveClass('changes-maximized');

    view.rerender(<Harness api={api} ownerId="r2" />);
    expect(panel()).toBeNull();
    expect(screen.getByTestId('workspace')).not.toHaveClass('has-changes-panel');
    expect(screen.getByTestId('workspace')).not.toHaveClass('changes-maximized');

    view.rerender(<Harness api={api} ownerId="r1" />);
    expect(panel()).not.toBeNull();
    expect(screen.getByTestId('workspace')).toHaveClass('has-changes-panel');
    expect(screen.getByTestId('workspace')).not.toHaveClass('changes-maximized');
    await act(async () => undefined);
  });

  it('lets the session own whether its panel is maximized', async () => {
    const { api } = fakeChangesApi();
    const view = renderWithLocalization(<Harness api={api} ownerId="r1" />);
    fireEvent.click(changesButton());
    await act(async () => undefined);
    fireEvent.click(screen.getByRole('button', { name: 'Maximize changes' }));
    expect(panel()).toHaveAttribute('data-maximized', 'true');

    view.rerender(<Harness api={api} ownerId="r2" />);
    view.rerender(<Harness api={api} ownerId="r1" />);
    expect(panel()).toHaveAttribute('data-maximized', 'false');
    expect(screen.getByTestId('workspace')).not.toHaveClass('changes-maximized');
    await act(async () => undefined);
  });

  it('clears the maximized state when the panel restores or closes', async () => {
    const { api } = fakeChangesApi();
    renderWithLocalization(<Harness api={api} ownerId="r1" />);
    fireEvent.click(changesButton());
    await act(async () => undefined);

    fireEvent.click(screen.getByRole('button', { name: 'Maximize changes' }));
    expect(screen.getByTestId('workspace')).toHaveClass('changes-maximized');
    fireEvent.click(screen.getByRole('button', { name: 'Restore changes size' }));
    expect(screen.getByTestId('workspace')).not.toHaveClass('changes-maximized');

    fireEvent.click(screen.getByRole('button', { name: 'Maximize changes' }));
    fireEvent.click(changesButton());
    fireEvent.click(changesButton());
    expect(screen.getByTestId('workspace')).toHaveClass('has-changes-panel');
    expect(screen.getByTestId('workspace')).not.toHaveClass('changes-maximized');
    await act(async () => undefined);
  });

  it('offers nothing while disabled', () => {
    const { api } = fakeChangesApi();
    renderWithLocalization(<Harness api={api} enabled={false} ownerId="r1" />);
    fireEvent.click(changesButton());
    expect(panel()).toBeNull();
    expect(changesButton()).toHaveAttribute('aria-expanded', 'false');
  });
});
