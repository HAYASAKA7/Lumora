import { useEffect, useRef, type PointerEvent } from 'react';

import { clampPanelWidth } from './changes-panel-preference';

const GUIDE_OFFSET_PROPERTY = '--changes-resize-guide-offset';

interface Drag {
  pointerId: number;
  target: HTMLElement;
  startX: number;
  startWidth: number;
  width: number;
  cancelOnEscape(event: globalThis.KeyboardEvent): void;
}

interface ResizeDragOptions {
  shownWidth: number;
  availableWidth: number;
  commitWidth(width: number): void;
}

export interface ResizeDrag {
  cancelDrag(): void;
  handlers: {
    onPointerDown(event: PointerEvent<HTMLDivElement>): void;
    onPointerMove(event: PointerEvent<HTMLDivElement>): void;
    onPointerUp(event: PointerEvent<HTMLDivElement>): void;
    onPointerCancel(event: PointerEvent<HTMLDivElement>): void;
    onLostPointerCapture(event: PointerEvent<HTMLDivElement>): void;
  };
}

function showGuide(target: HTMLElement, offset: number | null): void {
  if (offset === null) {
    delete target.dataset.dragging;
    target.style.removeProperty(GUIDE_OFFSET_PROPERTY);
    return;
  }
  target.dataset.dragging = 'true';
  target.style.setProperty(GUIDE_OFFSET_PROPERTY, `${offset}px`);
}

/**
 * Drags the panel's left edge. Only a guide follows the pointer so the content
 * beside the panel resizes once on release; Escape cancels the drag.
 */
export function useResizeDrag({ availableWidth, commitWidth, shownWidth }: ResizeDragOptions): ResizeDrag {
  const drag = useRef<Drag | null>(null);

  /** Ends a drag; returns it so the caller can commit or restore. */
  const endDrag = (): Drag | null => {
    const current = drag.current;
    if (current === null) return null;
    drag.current = null;
    window.removeEventListener('keydown', current.cancelOnEscape, true);
    showGuide(current.target, null);
    if (current.target.hasPointerCapture?.(current.pointerId)) {
      current.target.releasePointerCapture(current.pointerId);
    }
    return current;
  };

  const cancelDrag = () => {
    endDrag();
  };
  const cancelDragRef = useRef(cancelDrag);
  cancelDragRef.current = cancelDrag;

  useEffect(() => () => cancelDragRef.current(), []);

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || drag.current !== null) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    const cancelOnEscape = (keyEvent: globalThis.KeyboardEvent) => {
      if (keyEvent.key !== 'Escape') return;
      keyEvent.preventDefault();
      keyEvent.stopPropagation();
      cancelDragRef.current();
    };
    window.addEventListener('keydown', cancelOnEscape, true);
    drag.current = {
      pointerId: event.pointerId,
      target: event.currentTarget,
      startX: event.clientX,
      startWidth: shownWidth,
      width: shownWidth,
      cancelOnEscape
    };
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const current = drag.current;
    if (current === null || current.pointerId !== event.pointerId) return;
    current.width = clampPanelWidth(current.startWidth + current.startX - event.clientX, availableWidth);
    showGuide(current.target, current.startWidth - current.width);
  };

  const onPointerUp = (event: PointerEvent<HTMLDivElement>) => {
    if (drag.current?.pointerId !== event.pointerId) return;
    const current = endDrag();
    if (current !== null) commitWidth(current.width);
  };

  const abandonDrag = (event: PointerEvent<HTMLDivElement>) => {
    if (drag.current?.pointerId === event.pointerId) cancelDrag();
  };

  return {
    cancelDrag,
    handlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onPointerCancel: abandonDrag,
      onLostPointerCapture: abandonDrag
    }
  };
}
