import { fireEvent, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';

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
