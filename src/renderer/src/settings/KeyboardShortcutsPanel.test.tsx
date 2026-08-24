import { fireEvent, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_KEYBOARD_SETTINGS } from '../../../shared/contracts';
import { KeyboardShortcutsPanel } from './KeyboardShortcutsPanel';
import { renderWithLocalization } from '../test/render-with-localization';

const render = renderWithLocalization;

describe('KeyboardShortcutsPanel', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'lumora', {
      configurable: true,
      value: {
        getKeyboardSettings: vi.fn().mockResolvedValue(DEFAULT_KEYBOARD_SETTINGS),
        saveKeyboardSettings: vi.fn(async (value) => value)
      }
    });
  });

  it('loads, records, and saves the terminal switcher shortcut', async () => {
    const onChange = vi.fn();
    render(<KeyboardShortcutsPanel onChange={onChange} platform="win32" />);

    const recorder = await screen.findByRole('button', {
      name: 'Record terminal switcher shortcut'
    });
    expect(recorder).toHaveTextContent('Ctrl + Tab');

    fireEvent.click(recorder);
    expect(recorder).toHaveTextContent('Press shortcut');
    fireEvent.keyDown(recorder, {
      code: 'KeyK',
      key: 'K',
      ctrlKey: true,
      shiftKey: true
    });
    expect(recorder).toHaveTextContent('Ctrl + Shift + K');

    fireEvent.click(screen.getByRole('button', { name: 'Save shortcut' }));
    await waitFor(() => {
      expect(window.lumora.saveKeyboardSettings).toHaveBeenCalledWith({
        ...DEFAULT_KEYBOARD_SETTINGS,
        terminalSwitcher: {
          code: 'KeyK',
          control: true,
          alt: false,
          shift: true,
          meta: false
        }
      });
    });
    expect(onChange).toHaveBeenLastCalledWith({
      ...DEFAULT_KEYBOARD_SETTINGS,
      terminalSwitcher: expect.objectContaining({ code: 'KeyK' })
    });
    expect(await screen.findByRole('status')).toHaveTextContent('Shortcuts saved');
  });

  it('shows every configurable application shortcut', async () => {
    render(<KeyboardShortcutsPanel platform="linux" />);

    expect(await screen.findByRole('button', {
      name: 'Record terminal switcher shortcut'
    })).toHaveTextContent('Ctrl + Tab');
    expect(screen.getByRole('button', {
      name: 'Record open terminals shortcut'
    })).toHaveTextContent('Ctrl + Shift + T');
    expect(screen.getByRole('button', {
      name: 'Record toggle sidebar shortcut'
    })).toHaveTextContent('Ctrl + Shift + L');
    expect(screen.getByText('Expand or collapse the sidebar.'))
      .toBeInTheDocument();
    expect(screen.getByRole('button', {
      name: 'Record go to Home shortcut'
    })).toHaveTextContent('Ctrl + 1');
    expect(screen.getByRole('button', {
      name: 'Record go to Remote computers shortcut'
    })).toHaveTextContent('Ctrl + 5');
    expect(screen.getByRole('button', {
      name: 'Record go to Settings shortcut'
    })).toHaveTextContent('Ctrl + ,');
    expect(screen.queryByRole('button', {
      name: 'Record go to Settings alternate shortcut'
    })).not.toBeInTheDocument();
  });

  it('rejects a shortcut already assigned to another action', async () => {
    render(<KeyboardShortcutsPanel platform="win32" />);
    const recorder = await screen.findByRole('button', {
      name: 'Record open terminals shortcut'
    });

    fireEvent.click(recorder);
    fireEvent.keyDown(recorder, {
      code: 'Digit1',
      key: '1',
      ctrlKey: true
    });

    expect(screen.getByRole('alert')).toHaveTextContent(
      /already used by Go to Home/i
    );
    expect(window.lumora.saveKeyboardSettings).not.toHaveBeenCalled();
  });

  it('does not persist duplicate shortcuts loaded from older settings', async () => {
    window.lumora.getKeyboardSettings = vi.fn().mockResolvedValue({
      ...DEFAULT_KEYBOARD_SETTINGS,
      terminalSwitcher: DEFAULT_KEYBOARD_SETTINGS.openHome
    });
    render(<KeyboardShortcutsPanel platform="win32" />);

    await screen.findByRole('button', {
      name: 'Record terminal switcher shortcut'
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save shortcut' }));

    expect(screen.getByRole('alert')).toHaveTextContent(
      /Switch active terminal and Go to Home/i
    );
    expect(window.lumora.saveKeyboardSettings).not.toHaveBeenCalled();
  });

  it('does not save Windows Alt+Tab', async () => {
    render(<KeyboardShortcutsPanel platform="win32" />);
    const recorder = await screen.findByRole('button', {
      name: 'Record terminal switcher shortcut'
    });

    fireEvent.click(recorder);
    fireEvent.keyDown(recorder, {
      code: 'Tab',
      key: 'Tab',
      altKey: true
    });

    expect(screen.getByRole('alert')).toHaveTextContent(/reserved by Windows/i);
    expect(window.lumora.saveKeyboardSettings).not.toHaveBeenCalled();
  });

  it('resets the shortcut to the default after persistence succeeds', async () => {
    const custom = {
      ...DEFAULT_KEYBOARD_SETTINGS,
      terminalSwitcher: {
        code: 'KeyK',
        control: true,
        alt: false,
        shift: true,
        meta: false
      }
    };
    const onChange = vi.fn();
    window.lumora.getKeyboardSettings = vi.fn().mockResolvedValue(custom);
    render(<KeyboardShortcutsPanel onChange={onChange} platform="win32" />);

    await screen.findByText('Ctrl + Shift + K');
    fireEvent.click(screen.getByRole('button', { name: 'Reset to default' }));

    await waitFor(() => {
      expect(window.lumora.saveKeyboardSettings).toHaveBeenCalledWith(
        DEFAULT_KEYBOARD_SETTINGS
      );
    });
    expect(onChange).toHaveBeenLastCalledWith(DEFAULT_KEYBOARD_SETTINGS);
    expect(screen.getByRole('status')).toHaveTextContent('Shortcuts reset');
  });

  it('keeps the effective shortcut when resetting cannot be persisted', async () => {
    const onChange = vi.fn();
    window.lumora.saveKeyboardSettings = vi.fn().mockRejectedValue(
      new Error('disk unavailable')
    );
    render(<KeyboardShortcutsPanel onChange={onChange} platform="win32" />);
    await screen.findByText('Ctrl + Tab');
    await waitFor(() => expect(onChange).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole('button', { name: 'Reset to default' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'could not be saved'
    );
    expect(onChange).toHaveBeenCalledTimes(1);
  });
});
