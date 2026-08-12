import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ActionMenu } from './ActionMenu';

describe('ActionMenu', () => {
  it('portals commands outside its layout parent and invokes the selected action', () => {
    const onSelect = vi.fn();
    const { container } = render(
      <div data-testid="layout-parent">
        <ActionMenu
          items={[{ id: 'hide', label: 'Hide workspace' }]}
          label="Workspace actions"
          onSelect={onSelect}
        >
          <span aria-hidden="true">•••</span>
        </ActionMenu>
      </div>
    );

    fireEvent.click(screen.getByRole('button', { name: 'Workspace actions' }));
    const menu = screen.getByRole('menu', { name: 'Workspace actions' });
    expect(container.contains(menu)).toBe(false);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Hide workspace' }));

    expect(onSelect).toHaveBeenCalledWith('hide');
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('supports keyboard navigation and closes on Escape', () => {
    render(
      <ActionMenu
        items={[
          { id: 'first', label: 'First action' },
          { id: 'second', label: 'Second action' }
        ]}
        label="Actions"
        onSelect={vi.fn()}
      >
        <span aria-hidden="true">•••</span>
      </ActionMenu>
    );
    const trigger = screen.getByRole('button', { name: 'Actions' });
    fireEvent.keyDown(trigger, { key: 'ArrowDown' });
    expect(screen.getByRole('menu')).toBeVisible();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
  });
});
