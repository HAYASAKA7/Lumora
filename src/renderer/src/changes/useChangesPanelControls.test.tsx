import { act, fireEvent, render, screen } from '@testing-library/react';
import { useState, type ReactNode } from 'react';
import { describe, expect, it } from 'vitest';

import { useChangesPanelControls, type PanelFocusPlan } from './useChangesPanelControls';

const PLAN: PanelFocusPlan = {
  target: '[data-role="target"]',
  fallback: '[data-role="fallback"]',
  settled: '[data-role="settled"]'
};

interface HarnessProps {
  ownerKey?: string | undefined;
  showTarget?: boolean;
  showSettled?: boolean;
}

function Harness({ ownerKey = 'owner-1', showTarget = false, showSettled = false }: HarnessProps): ReactNode {
  const [open, setOpen] = useState(false);
  const controls = useChangesPanelControls({ isOpen: open, ownerKey });
  return (
    <section className={`host${controls.className}`} data-testid="host">
      <button type="button" {...controls.buttonProps(() => {
        setOpen(!open);
        if (!open) controls.focusPanel(PLAN);
      })}>Changes</button>
      <button onClick={() => controls.setMaximized(!controls.maximized)} type="button">Maximize</button>
      <button
        onClick={() => {
          setOpen(false);
          controls.focusButton();
        }}
        type="button"
      >
        Close
      </button>
      {!open ? null : (
        <div data-testid="panel" id={controls.panelId}>
          <button data-role="fallback" type="button">Fallback</button>
          {showTarget ? <button data-role="target" type="button">Target</button> : null}
          {showSettled ? <p data-role="settled">Settled</p> : null}
        </div>
      )}
    </section>
  );
}

function changesButton(): HTMLElement {
  return screen.getByRole('button', { name: 'Changes' });
}

describe('useChangesPanelControls', () => {
  it('names the panel from the button and tracks the open class', () => {
    render(<Harness />);
    expect(changesButton()).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByTestId('host')).not.toHaveClass('has-changes-panel');

    fireEvent.click(changesButton());
    expect(changesButton()).toHaveAttribute('aria-expanded', 'true');
    expect(changesButton()).toHaveAttribute('aria-controls', screen.getByTestId('panel').id);
    expect(screen.getByTestId('host')).toHaveClass('has-changes-panel');
  });

  it('focuses the target at once when it is already shown', () => {
    render(<Harness showTarget />);
    fireEvent.click(changesButton());
    expect(screen.getByRole('button', { name: 'Target' })).toHaveFocus();
  });

  it('focuses the fallback and moves on once the target appears', async () => {
    const view = render(<Harness />);
    fireEvent.click(changesButton());
    expect(screen.getByRole('button', { name: 'Fallback' })).toHaveFocus();

    view.rerender(<Harness showTarget />);
    await act(async () => undefined);
    expect(screen.getByRole('button', { name: 'Target' })).toHaveFocus();
  });

  it('leaves focus where the user moved it before the target appears', async () => {
    const view = render(<Harness />);
    fireEvent.click(changesButton());
    const maximize = screen.getByRole('button', { name: 'Maximize' });
    maximize.focus();

    view.rerender(<Harness showTarget />);
    await act(async () => undefined);
    expect(maximize).toHaveFocus();
  });

  it('stops waiting for a target once the panel settles without one', async () => {
    const view = render(<Harness />);
    fireEvent.click(changesButton());
    expect(screen.getByRole('button', { name: 'Fallback' })).toHaveFocus();

    view.rerender(<Harness showSettled />);
    await act(async () => undefined);
    view.rerender(<Harness showSettled showTarget />);
    await act(async () => undefined);
    expect(screen.getByRole('button', { name: 'Fallback' })).toHaveFocus();
  });

  it('returns focus to the button when the panel closes itself', () => {
    render(<Harness showTarget />);
    fireEvent.click(changesButton());
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByTestId('panel')).not.toBeInTheDocument();
    expect(changesButton()).toHaveFocus();
  });

  it('keeps the maximized state per owner and drops it when the owner changes', () => {
    const view = render(<Harness />);
    fireEvent.click(changesButton());
    fireEvent.click(screen.getByRole('button', { name: 'Maximize' }));
    expect(screen.getByTestId('host')).toHaveClass('changes-maximized');

    view.rerender(<Harness ownerKey="owner-2" />);
    expect(screen.getByTestId('host')).not.toHaveClass('changes-maximized');
  });

  it('reports no maximized panel while none is open', () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Maximize' }));
    expect(screen.getByTestId('host')).not.toHaveClass('changes-maximized');
  });
});
