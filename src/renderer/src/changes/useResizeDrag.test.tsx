import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { useResizeDrag } from './useResizeDrag';

function Harness({ commitWidth }: { commitWidth: (width: number) => void }) {
  const drag = useResizeDrag({ availableWidth: 1000, commitWidth, shownWidth: 400 });
  return (
    <div
      aria-label="Resize changes"
      aria-orientation="vertical"
      className="changes-panel-resize"
      role="separator"
      tabIndex={0}
      {...drag.handlers}
    />
  );
}

function separator(): HTMLElement {
  return screen.getByRole('separator', { name: 'Resize changes' });
}

describe('useResizeDrag', () => {
  it('focuses the separator on pointerdown so its arrow keys stay reachable', () => {
    render(<Harness commitWidth={vi.fn()} />);

    // preventDefault stops the browser's own focus, so the handler moves it.
    fireEvent.pointerDown(separator(), { clientX: 500, pointerId: 1, button: 0 });
    expect(separator()).toHaveFocus();
    fireEvent.pointerUp(separator(), { clientX: 500, pointerId: 1 });
    expect(separator()).toHaveFocus();
  });

  it('commits a drag once on release and leaves focus alone for other buttons', () => {
    const commitWidth = vi.fn();
    render(<Harness commitWidth={commitWidth} />);

    fireEvent.pointerDown(separator(), { clientX: 500, pointerId: 2, button: 2 });
    expect(separator()).not.toHaveFocus();
    expect(commitWidth).not.toHaveBeenCalled();

    fireEvent.pointerDown(separator(), { clientX: 500, pointerId: 3, button: 0 });
    fireEvent.pointerMove(separator(), { clientX: 460, pointerId: 3 });
    fireEvent.pointerUp(separator(), { clientX: 460, pointerId: 3 });
    expect(commitWidth).toHaveBeenCalledExactlyOnceWith(440);
  });
});
