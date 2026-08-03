import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import {
  installAppFocusPolicy,
  isLumoraEditableTarget,
  releaseLumoraCommandFocus
} from './app-focus-policy';

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
