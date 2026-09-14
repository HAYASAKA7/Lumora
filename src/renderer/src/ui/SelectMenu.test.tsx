import { fireEvent, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SelectMenu } from './SelectMenu';
import { renderWithLocalization } from '../test/render-with-localization';

const options = [
  { value: 'direct', label: 'Direct SSH' },
  { value: 'ssh-config', label: 'OpenSSH config alias' }
] as const;

function Harness() {
  const [value, setValue] = useState<(typeof options)[number]['value']>(
    'direct'
  );
  return (
    <SelectMenu<(typeof options)[number]['value']>
      label="Connection route"
      onChange={setValue}
      options={options}
      value={value}
    />
  );
}

function AccessibleHarness() {
  const [value, setValue] = useState<(typeof options)[number]['value']>(
    'direct'
  );
  return (
    <>
      <p id="route-help">Choose how Lumora connects.</p>
      <SelectMenu<(typeof options)[number]['value']>
        ariaDescribedBy="route-help"
        className="route-menu"
        disabled
        label="Connection route"
        onChange={setValue}
        options={options}
        value={value}
      />
    </>
  );
}

describe('SelectMenu', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('opens a list at the bottom of the window upward, resting on its trigger', () => {
    renderWithLocalization(
      <SelectMenu
        align="end"
        label="Model"
        onChange={() => undefined}
        options={options}
        value="direct"
      />
    );
    const trigger = screen.getByRole('button', { name: 'Model' });
    const top = window.innerHeight - 44;
    vi.spyOn(trigger, 'getBoundingClientRect').mockReturnValue({
      top,
      bottom: top + 34,
      left: window.innerWidth - 240,
      right: window.innerWidth - 20,
      width: 220,
      height: 34,
      x: window.innerWidth - 240,
      y: top,
      toJSON: () => ({})
    });

    fireEvent.click(trigger);

    expect(screen.getByRole('listbox')).toHaveStyle({
      top: 'auto',
      bottom: '50px',
      left: 'auto',
      right: '20px',
      minWidth: '220px'
    });
  });

  it('supports keyboard selection without opening a native browser menu', () => {
    renderWithLocalization(<Harness />);
    const trigger = screen.getByRole('button', { name: 'Connection route' });

    fireEvent.keyDown(trigger, { key: 'ArrowDown' });
    expect(screen.getByRole('listbox', {
      name: 'Connection route options'
    })).toBeInTheDocument();
    fireEvent.keyDown(trigger, { key: 'Enter' });

    expect(trigger).toHaveTextContent('OpenSSH config alias');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();

    fireEvent.click(trigger);
    const listbox = screen.getByRole('listbox');
    expect(trigger.closest('.select-menu')).not.toContainElement(listbox);
    expect(listbox).toHaveClass('select-menu-options-overlay');
    expect(listbox).toHaveStyle({ position: 'fixed' });

    expect(listbox).toBeInTheDocument();
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('forwards field accessibility and layout hooks to its trigger', () => {
    renderWithLocalization(<AccessibleHarness />);

    const trigger = screen.getByRole('button', { name: 'Connection route' });
    expect(trigger).toBeDisabled();
    expect(trigger).toHaveAttribute('aria-describedby', 'route-help');
    expect(trigger.closest('.select-menu')).toHaveClass('route-menu');
  });

  it('supports Home, End, and Escape without moving focus from the trigger', () => {
    renderWithLocalization(<Harness />);
    const trigger = screen.getByRole('button', { name: 'Connection route' });
    trigger.focus();

    fireEvent.keyDown(trigger, { key: 'End' });
    expect(screen.getByRole('option', {
      name: 'OpenSSH config alias'
    })).toHaveClass('is-active');
    fireEvent.keyDown(trigger, { key: 'Escape' });

    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });
});
