import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';

import { SelectMenu } from './SelectMenu';

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

describe('SelectMenu', () => {
  it('supports keyboard selection without opening a native browser menu', () => {
    render(<Harness />);
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
});
