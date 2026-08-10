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
});
