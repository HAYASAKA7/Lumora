import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { IconButton } from './IconButton';
import { UpdateIcon } from './icons';
import { TooltipProvider } from './Tooltip';

describe('IconButton', () => {
  it('shows its own mark while idle', () => {
    render(
      <IconButton label="Update Codex" onClick={vi.fn()}>
        <UpdateIcon />
      </IconButton>
    );

    const button = screen.getByRole('button', { name: 'Update Codex' });
    expect(button.querySelector('.icon-loading')).toBeNull();
    expect(button.querySelectorAll('svg')).toHaveLength(1);
    expect(button).toHaveAttribute('aria-busy', 'false');
  });

  it('swaps its mark for the loading mark while it works', () => {
    render(
      <IconButton busy label="Update Codex" onClick={vi.fn()}>
        <UpdateIcon />
      </IconButton>
    );

    // A turning pair of chevrons or a turning download arrow reads as the
    // action repeating, not as work in progress; the loading mark is the one
    // thing that means "wait".
    const button = screen.getByRole('button', { name: 'Update Codex' });
    const marks = button.querySelectorAll('svg');
    expect(marks).toHaveLength(1);
    expect(marks[0]).toHaveClass('icon-loading');
    expect(button).toHaveAttribute('aria-busy', 'true');
  });

  it('says what it is doing while it works, and keeps its name', () => {
    vi.useFakeTimers();
    const button = (busy: boolean) => (
      <TooltipProvider>
        <IconButton
          busy={busy}
          busyLabel="Updating Codex"
          label="Update Codex with npm"
          onClick={vi.fn()}
        >
          <UpdateIcon />
        </IconButton>
      </TooltipProvider>
    );
    const view = render(button(false));
    fireEvent.pointerEnter(screen.getByRole('button'));
    act(() => vi.advanceTimersByTime(450));
    expect(screen.getByRole('tooltip')).toHaveTextContent('Update Codex with npm');

    view.rerender(button(true));

    expect(screen.getByRole('tooltip')).toHaveTextContent('Updating Codex');
    // The name identifies the control; aria-busy carries the state.
    expect(screen.getByRole('button', { name: 'Update Codex with npm' }))
      .toHaveAttribute('aria-busy', 'true');
    vi.useRealTimers();
  });
});
