import { act, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { OverflowTooltip, Tooltip, TooltipProvider } from './Tooltip';

function Example({ onClick }: { onClick?: () => void }): React.JSX.Element {
  return (
    <TooltipProvider>
      <Tooltip content="Home" shortcut="Ctrl + 1">
        <button onClick={onClick} type="button">
          Home button
        </button>
      </Tooltip>
    </TooltipProvider>
  );
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('Tooltip', () => {
  it('opens after the compact hover delay and renders the shortcut', () => {
    vi.useFakeTimers();
    render(<Example />);
    const button = screen.getByRole('button', { name: 'Home button' });

    fireEvent.pointerEnter(button);
    act(() => vi.advanceTimersByTime(449));
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();

    act(() => vi.advanceTimersByTime(1));
    expect(screen.getByRole('tooltip')).toHaveTextContent('HomeCtrl + 1');
    expect(button).toHaveAttribute(
      'aria-describedby',
      screen.getByRole('tooltip').id
    );
  });

  it('closes on pointer leave and Escape', () => {
    vi.useFakeTimers();
    render(<Example />);
    const button = screen.getByRole('button', { name: 'Home button' });

    fireEvent.pointerEnter(button);
    act(() => vi.advanceTimersByTime(450));
    fireEvent.pointerLeave(button);
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();

    fireEvent.pointerEnter(button);
    act(() => vi.advanceTimersByTime(80));
    expect(screen.getByRole('tooltip')).toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'Escape', code: 'Escape' });
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });

  it('opens for deliberate keyboard focus but not pointer focus', () => {
    vi.useFakeTimers();
    const { rerender } = render(<Example />);
    const button = screen.getByRole('button', { name: 'Home button' });

    fireEvent.pointerDown(button);
    fireEvent.focus(button);
    act(() => vi.runOnlyPendingTimers());
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();

    fireEvent.blur(button);
    fireEvent.keyDown(window, { key: 'Tab', code: 'Tab' });
    fireEvent.focus(button);
    act(() => vi.runOnlyPendingTimers());
    expect(screen.getByRole('tooltip')).toHaveTextContent('Home');

    rerender(<Example />);
  });

  it('preserves the trigger action and closes after click', () => {
    vi.useFakeTimers();
    const onClick = vi.fn();
    render(<Example onClick={onClick} />);
    const button = screen.getByRole('button', { name: 'Home button' });

    fireEvent.pointerEnter(button);
    act(() => vi.advanceTimersByTime(450));
    fireEvent.click(button);

    expect(onClick).toHaveBeenCalledOnce();
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });

  it('closes when its trigger unmounts', () => {
    vi.useFakeTimers();

    function Conditional(): React.JSX.Element {
      const [visible, setVisible] = useState(true);
      return (
        <TooltipProvider>
          {visible ? (
            <Tooltip content="Temporary">
              <button type="button">Temporary button</button>
            </Tooltip>
          ) : null}
          <button onClick={() => setVisible(false)} type="button">
            Remove trigger
          </button>
        </TooltipProvider>
      );
    }

    render(<Conditional />);
    fireEvent.pointerEnter(
      screen.getByRole('button', { name: 'Temporary button' })
    );
    act(() => vi.advanceTimersByTime(450));
    expect(screen.getByRole('tooltip')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Remove trigger' }));
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });
  it('shows overflow text only when the rendered content is clipped', () => {
    vi.useFakeTimers();
    const scrollWidth = vi
      .spyOn(HTMLElement.prototype, 'scrollWidth', 'get')
      .mockReturnValue(100);
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(100);
    const { rerender } = render(
      <TooltipProvider>
        <OverflowTooltip content="A long workspace path">
          <span>A long workspace path</span>
        </OverflowTooltip>
      </TooltipProvider>
    );

    fireEvent.pointerEnter(screen.getByText('A long workspace path'));
    act(() => vi.advanceTimersByTime(450));
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();

    scrollWidth.mockReturnValue(180);
    rerender(
      <TooltipProvider>
        <OverflowTooltip content="A longer workspace path">
          <span>A longer workspace path</span>
        </OverflowTooltip>
      </TooltipProvider>
    );
    fireEvent.pointerEnter(screen.getByText('A longer workspace path'));
    act(() => vi.advanceTimersByTime(450));
    expect(screen.getByRole('tooltip')).toHaveTextContent(
      'A longer workspace path'
    );
  });
  it('portals into the app shell so appearance tokens are inherited', () => {
    vi.useFakeTimers();
    render(
      <div className="app-shell" data-testid="shell">
        <TooltipProvider>
          <Tooltip content="Shell hint">
            <button type="button">Shell button</button>
          </Tooltip>
        </TooltipProvider>
      </div>
    );

    fireEvent.pointerEnter(screen.getByRole('button', { name: 'Shell button' }));
    act(() => vi.advanceTimersByTime(450));
    expect(screen.getByRole('tooltip').parentElement).toBe(
      screen.getByTestId('shell')
    );
  });
});
