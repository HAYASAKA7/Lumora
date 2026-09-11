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

  it('follows its content while it is open', () => {
    vi.useFakeTimers();
    const view = render(
      <TooltipProvider>
        <Tooltip content="Update Codex">
          <button type="button">update</button>
        </Tooltip>
      </TooltipProvider>
    );
    fireEvent.pointerEnter(screen.getByRole('button'));
    act(() => vi.advanceTimersByTime(450));
    expect(screen.getByRole('tooltip')).toHaveTextContent('Update Codex');

    // Pressing a button while hovering it is the usual way to start its work,
    // so the bubble that is already open has to take the new text.
    view.rerender(
      <TooltipProvider>
        <Tooltip content="Updating Codex">
          <button type="button">update</button>
        </Tooltip>
      </TooltipProvider>
    );
    expect(screen.getByRole('tooltip')).toHaveTextContent('Updating Codex');
    vi.useRealTimers();
  });

  it('measures a bubble with the viewport free before placing it', () => {
    vi.useFakeTimers();
    const originalRect = HTMLElement.prototype.getBoundingClientRect;
    const originalWidth = window.innerWidth;
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1536 });
    HTMLElement.prototype.getBoundingClientRect = function (this: HTMLElement) {
      if (this.getAttribute('role') === 'tooltip') {
        const natural = this.textContent === 'Refresh' ? 59 : 247;
        const left = Number.parseFloat(this.style.left || '0');
        // A fixed bubble near the right edge wraps into the room it has left,
        // which makes it measure narrower than it really is.
        const width = Math.min(natural, Math.max(0, 1536 - left));
        return { x: left, y: 0, left, top: 0, right: left + width, bottom: 30,
          width, height: 30, toJSON: () => ({}) } as DOMRect;
      }
      const x = Number(this.dataset.x ?? 0);
      return { x, y: 400, left: x, top: 400, right: x + 32, bottom: 432,
        width: 32, height: 32, toJSON: () => ({}) } as DOMRect;
    };
    try {
      render(
        <TooltipProvider>
          <Tooltip content="Refresh">
            <button data-x="1404" type="button">first</button>
          </Tooltip>
          <Tooltip content="Checking providers and their latest versions…">
            <button data-x="1404" type="button">second</button>
          </Tooltip>
        </TooltipProvider>
      );
      const [first, second] = screen.getAllByRole('button');
      fireEvent.pointerEnter(first!);
      act(() => vi.advanceTimersByTime(450));
      fireEvent.pointerLeave(first!);

      // The next bubble first appears where the last one stood, near the edge.
      fireEvent.pointerEnter(second!);
      act(() => vi.advanceTimersByTime(450));

      // Measured at full width it keeps to one line, held one margin inside
      // the window rather than squeezed against its edge.
      expect(screen.getByRole('tooltip').style.left).toBe(`${1536 - 247 - 8}px`);
    } finally {
      HTMLElement.prototype.getBoundingClientRect = originalRect;
      Object.defineProperty(window, 'innerWidth', { configurable: true, value: originalWidth });
      vi.useRealTimers();
    }
  });
});
