import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ConfirmDialog } from './ConfirmDialog';

describe('ConfirmDialog', () => {
  it('uses Lumora modal controls for confirm and cancel', () => {
    const onCancel = vi.fn();
    const onConfirm = vi.fn();
    render(
      <ConfirmDialog
        confirmLabel="Open link"
        description="https://example.com/docs"
        heading="Open external link?"
        onCancel={onCancel}
        onConfirm={onConfirm}
      />
    );

    expect(screen.getByRole('dialog', { name: 'Open external link?' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Open link' }));
    expect(onConfirm).toHaveBeenCalledOnce();

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it('optionally exposes an accessible suppression checkbox', () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <ConfirmDialog
        confirmLabel="Exit Lumora"
        description="Active agents will stop."
        heading="Exit Lumora?"
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
      />
    );

    expect(screen.queryByRole('checkbox', {
      name: "Don't show this warning again"
    })).not.toBeInTheDocument();

    rerender(
      <ConfirmDialog
        confirmLabel="Exit Lumora"
        description="Active agents will stop."
        heading="Exit Lumora?"
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
        suppression={{
          checked: false,
          label: "Don't show this warning again",
          onChange
        }}
      />
    );
    const checkbox = screen.getByRole('checkbox', {
      name: "Don't show this warning again"
    });
    fireEvent.click(screen.getByText("Don't show this warning again"));
    expect(onChange).not.toHaveBeenCalled();

    fireEvent.click(checkbox);
    expect(onChange).toHaveBeenCalledWith(true);
  });
});
