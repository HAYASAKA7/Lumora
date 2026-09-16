import { fireEvent, render, screen } from '@testing-library/react';
import { useState, type ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { openEscapeLayerCount, useEscapeLayer } from './escape-layers';

function Layer({ busy = false, name, onEscape }: {
  busy?: boolean;
  name: string;
  onEscape(): void;
}): ReactNode {
  useEscapeLayer(busy ? null : onEscape);
  return <p>{name}</p>;
}

function escape(): void {
  fireEvent.keyDown(window, { key: 'Escape' });
}

describe('useEscapeLayer', () => {
  it('gives Escape to the layer on top and to nothing below it', () => {
    const dialog = vi.fn();
    const menu = vi.fn();
    const view = render(
      <>
        <Layer name="dialog" onEscape={dialog} />
        <Layer name="menu" onEscape={menu} />
      </>
    );

    escape();
    expect(menu).toHaveBeenCalledTimes(1);
    expect(dialog).not.toHaveBeenCalled();

    view.rerender(<Layer name="dialog" onEscape={dialog} />);
    escape();
    expect(dialog).toHaveBeenCalledTimes(1);
    expect(menu).toHaveBeenCalledTimes(1);
  });

  it('keeps Escape inside a busy layer without closing anything', () => {
    const dialog = vi.fn();
    const busy = vi.fn();
    render(
      <>
        <Layer name="dialog" onEscape={dialog} />
        <Layer busy name="busy" onEscape={busy} />
      </>
    );

    escape();
    expect(busy).not.toHaveBeenCalled();
    expect(dialog).not.toHaveBeenCalled();
  });

  it('answers with the newest handler a layer was given', () => {
    function Changing(): ReactNode {
      const [count, setCount] = useState(0);
      useEscapeLayer(() => setCount(count + 1));
      return <p>{`count ${count}`}</p>;
    }
    render(<Changing />);

    escape();
    expect(screen.getByText('count 1')).toBeInTheDocument();
    escape();
    expect(screen.getByText('count 2')).toBeInTheDocument();
  });

  it('leaves other keys alone and forgets a layer once it unmounts', () => {
    const dialog = vi.fn();
    const view = render(<Layer name="dialog" onEscape={dialog} />);
    expect(openEscapeLayerCount()).toBe(1);

    fireEvent.keyDown(window, { key: 'Enter' });
    expect(dialog).not.toHaveBeenCalled();

    view.unmount();
    expect(openEscapeLayerCount()).toBe(0);
    escape();
    expect(dialog).not.toHaveBeenCalled();
  });

  it('ignores an Escape another handler already took', () => {
    const dialog = vi.fn();
    render(<Layer name="dialog" onEscape={dialog} />);

    const event = new KeyboardEvent('keydown', { key: 'Escape', cancelable: true });
    event.preventDefault();
    window.dispatchEvent(event);

    expect(dialog).not.toHaveBeenCalled();
  });
});
