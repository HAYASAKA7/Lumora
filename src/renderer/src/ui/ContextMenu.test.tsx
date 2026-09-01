import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ContextMenu } from './ContextMenu';
import { renderWithLocalization } from '../test/render-with-localization';

describe('ContextMenu', () => {
  it('renders Lumora menu actions and closes after selection', () => {
    const onClose = vi.fn();
    const onSelect = vi.fn();
    renderWithLocalization(
      <ContextMenu
        anchor={{ x: 40, y: 60 }}
        items={[
          { id: 'resume', label: 'Resume now', onSelect },
          { id: 'options', label: 'Resume options…', onSelect: vi.fn() }
        ]}
        label="Session actions"
        onClose={onClose}
      />
    );

    const menu = screen.getByRole('menu', { name: 'Session actions' });
    expect(menu).toHaveStyle({ position: 'fixed' });
    fireEvent.click(screen.getByRole('menuitem', { name: 'Resume now' }));
    expect(onSelect).toHaveBeenCalledOnce();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('dismisses on escape and preserves disabled actions', () => {
    const onClose = vi.fn();
    renderWithLocalization(
      <ContextMenu
        anchor={{ x: 40, y: 60 }}
        items={[
          {
            disabled: true,
            id: 'resume',
            label: 'Resume now',
            onSelect: vi.fn()
          }
        ]}
        label="Session actions"
        onClose={onClose}
      />
    );

    expect(screen.getByRole('menuitem', { name: 'Resume now' })).toBeDisabled();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledOnce();
  });
});
