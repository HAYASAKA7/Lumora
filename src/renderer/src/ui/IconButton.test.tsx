import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { IconButton } from './IconButton';
import { UpdateIcon } from './icons';

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
});
