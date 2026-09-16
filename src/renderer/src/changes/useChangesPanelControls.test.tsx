import { act, fireEvent, render, screen } from '@testing-library/react';
import { useState, type ReactNode } from 'react';
import { describe, expect, it } from 'vitest';

import { useChangesPanelControls } from './useChangesPanelControls';

interface HarnessProps {
  ownerKey?: string | undefined;
  showTarget?: boolean;
}

function Harness({ ownerKey = 'owner-1', showTarget = false }: HarnessProps): ReactNode {
  const [open, setOpen] = useState(false);
  const controls = useChangesPanelControls({ isOpen: open, ownerKey });
  return (
    <section className={`host${controls.className}`} data-testid="host">
      <button type="button" {...controls.buttonProps(() => setOpen(!open))}>Changes</button>
      <button onClick={() => controls.setMaximized(!controls.maximized)} type="button">Maximize</button>
      <button onClick={() => setOpen(false)} type="button">Close</button>
      {!open ? null : (
        <div data-testid="panel" id={controls.panelId}>
          {showTarget ? <button data-role="target" type="button">Target</button> : null}
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

  it('moves no focus when the panel opens or closes', async () => {
    const view = render(<Harness />);
    const typing = document.createElement('textarea');
    document.body.append(typing);
    typing.focus();

    fireEvent.click(changesButton());
    expect(typing).toHaveFocus();

    // A target that arrives later is still not worth taking the keyboard for.
    view.rerender(<Harness showTarget />);
    await act(async () => undefined);
    expect(typing).toHaveFocus();

    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByTestId('panel')).not.toBeInTheDocument();
    expect(typing).toHaveFocus();
    typing.remove();
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
