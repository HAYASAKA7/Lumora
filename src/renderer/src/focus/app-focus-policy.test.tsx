import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import {
  installAppFocusPolicy,
  isLumoraEditableTarget,
  releaseLumoraCommandFocus
} from './app-focus-policy';

function dispatchKey(
  target: Element,
  init: KeyboardEventInit
): KeyboardEvent {
  const event = new KeyboardEvent('keydown', {
    bubbles: true,
    cancelable: true,
    ...init
  });
  target.dispatchEvent(event);
  return event;
}

describe('app focus policy', () => {
  it('releases stale command focus before ordinary typing', () => {
    render(
      <button data-lumora-command type="button">
        Home
      </button>
    );
    const button = screen.getByRole('button');
    button.focus();
    const dispose = installAppFocusPolicy(document);

    fireEvent.keyDown(document, { key: 'a', code: 'KeyA' });

    expect(button).not.toHaveFocus();
    dispose();
  });

  it('preserves focus in editable and managed terminal targets', () => {
    render(
      <>
        <input aria-label="Task" />
        <div className="managed-terminal">
          <button type="button">Terminal input</button>
        </div>
      </>
    );
    const dispose = installAppFocusPolicy(document);
    const input = screen.getByRole('textbox', { name: 'Task' });
    input.focus();
    fireEvent.keyDown(input, { key: 'a', code: 'KeyA' });
    expect(input).toHaveFocus();

    const terminal = screen.getByRole('button', { name: 'Terminal input' });
    terminal.focus();
    fireEvent.keyDown(terminal, { key: 'a', code: 'KeyA' });
    expect(terminal).toHaveFocus();
    expect(isLumoraEditableTarget(terminal)).toBe(true);
    dispose();
  });

  it('releases command focus after pointer activation and app shortcuts', () => {
    render(
      <button data-lumora-command type="button">
        Sessions
      </button>
    );
    const button = screen.getByRole('button');
    const dispose = installAppFocusPolicy(document);

    button.focus();
    fireEvent.pointerUp(button);
    expect(button).not.toHaveFocus();

    button.focus();
    fireEvent.keyDown(button, {
      key: '3',
      code: 'Digit3',
      ctrlKey: true
    });
    expect(button).not.toHaveFocus();
    dispose();
  });

  it('does not treat a modifier-only key as an app command', () => {
    render(
      <button data-lumora-command type="button">
        Workspaces
      </button>
    );
    const button = screen.getByRole('button');
    button.focus();
    const dispose = installAppFocusPolicy(document);

    fireEvent.keyDown(button, {
      key: 'Control',
      code: 'ControlLeft',
      ctrlKey: true
    });

    expect(button).toHaveFocus();
    dispose();
  });

  it('blocks Tab traversal and releases stale non-editable focus', () => {
    render(<button type="button">Action</button>);
    const button = screen.getByRole('button');
    button.focus();
    const dispose = installAppFocusPolicy(document);

    const event = dispatchKey(button, { key: 'Tab', code: 'Tab' });
    const buttonHasFocus = document.activeElement === button;
    dispose();

    expect(event.defaultPrevented).toBe(true);
    expect(buttonHasFocus).toBe(false);
  });

  it('blocks reverse Tab without moving an editable control', () => {
    render(<input aria-label="Search" />);
    const input = screen.getByRole('textbox', { name: 'Search' });
    input.focus();
    const dispose = installAppFocusPolicy(document);

    const event = dispatchKey(input, {
      key: 'Tab',
      code: 'Tab',
      shiftKey: true
    });
    const inputHasFocus = document.activeElement === input;
    dispose();

    expect(event.defaultPrevented).toBe(true);
    expect(inputHasFocus).toBe(true);
  });

  it('preserves terminal Tab and modified Tab shortcuts', () => {
    render(
      <>
        <div className="managed-terminal">
          <textarea aria-label="Terminal input" />
        </div>
        <button data-lumora-command type="button">Sessions</button>
      </>
    );
    const dispose = installAppFocusPolicy(document);
    const terminal = screen.getByRole('textbox', { name: 'Terminal input' });
    const terminalTab = dispatchKey(terminal, { key: 'Tab', code: 'Tab' });
    const terminalReverseTab = dispatchKey(terminal, {
      key: 'Tab',
      code: 'Tab',
      shiftKey: true
    });
    const command = screen.getByRole('button', { name: 'Sessions' });
    const shortcutTab = dispatchKey(command, {
      key: 'Tab',
      code: 'Tab',
      ctrlKey: true
    });
    dispose();

    expect(terminalTab.defaultPrevented).toBe(false);
    expect(terminalReverseTab.defaultPrevented).toBe(false);
    expect(shortcutTab.defaultPrevented).toBe(false);
  });

  it('lets the active shortcut recorder observe Tab without navigating', () => {
    const recorded = vi.fn();
    render(
      <button
        aria-pressed="true"
        className="shortcut-recorder"
        onKeyDown={recorded}
        type="button"
      >
        Record shortcut
      </button>
    );
    const recorder = screen.getByRole('button', { name: 'Record shortcut' });
    recorder.focus();
    const dispose = installAppFocusPolicy(document);

    const event = dispatchKey(recorder, { key: 'Tab', code: 'Tab' });
    const recorderHasFocus = document.activeElement === recorder;
    dispose();

    expect(event.defaultPrevented).toBe(true);
    expect(recorded).toHaveBeenCalledTimes(1);
    expect(recorderHasFocus).toBe(true);
  });

  it('removes installed behavior during cleanup', () => {
    render(
      <button data-lumora-command type="button">
        Settings
      </button>
    );
    const button = screen.getByRole('button');
    const dispose = installAppFocusPolicy(document);
    dispose();
    button.focus();

    fireEvent.keyDown(document, { key: 'z', code: 'KeyZ' });

    expect(button).toHaveFocus();
    releaseLumoraCommandFocus(document);
    expect(button).not.toHaveFocus();
  });
});
