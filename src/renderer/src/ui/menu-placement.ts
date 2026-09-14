import type { CSSProperties } from 'react';

const GAP = 6;
const MARGIN = 8;
const MAX_HEIGHT = 220;
const MIN_HEIGHT = 72;
/** One option row plus the gap between rows. */
const ROW_HEIGHT = 42;
const LIST_PADDING = 8;

export interface MenuAnchor {
  top: number;
  bottom: number;
  left: number;
  right: number;
  width: number;
}

export interface MenuPlacementOptions {
  /** Which edge of the trigger the menu lines up with. */
  align: 'start' | 'end';
  itemCount: number;
  /** The menu is never narrower than this or than its trigger. */
  minWidth: number;
  /** The menu grows to fit its labels up to this width. */
  maxWidth: number;
}

/**
 * Places a menu against its trigger. A menu that opens above is held by its
 * bottom edge, so a short list sits on the trigger instead of floating where a
 * full-height list would have started.
 */
export function placeMenu(
  anchor: MenuAnchor,
  viewport: { width: number; height: number },
  options: MenuPlacementOptions
): CSSProperties {
  const availableBelow = viewport.height - anchor.bottom - GAP - MARGIN;
  const availableAbove = anchor.top - GAP - MARGIN;
  const listHeight = Math.min(MAX_HEIGHT, options.itemCount * ROW_HEIGHT + LIST_PADDING);
  const openAbove = availableBelow < listHeight && availableAbove > availableBelow;
  const maxHeight = Math.min(
    MAX_HEIGHT,
    Math.max(MIN_HEIGHT, openAbove ? availableAbove : availableBelow)
  );

  const widest = Math.max(0, viewport.width - MARGIN * 2);
  const minWidth = Math.min(Math.max(anchor.width, options.minWidth), widest);
  const edgeLimit = viewport.width - minWidth - MARGIN;
  const horizontal = options.align === 'start'
    ? { left: clamp(anchor.left, MARGIN, edgeLimit), right: 'auto' as const }
    : { left: 'auto' as const, right: clamp(viewport.width - anchor.right, MARGIN, edgeLimit) };
  const inset = typeof horizontal.left === 'number' ? horizontal.left : horizontal.right as number;

  return {
    position: 'fixed',
    ...(openAbove
      ? { top: 'auto', bottom: viewport.height - anchor.top + GAP }
      : { top: anchor.bottom + GAP, bottom: 'auto' }),
    ...horizontal,
    maxHeight,
    width: 'max-content',
    minWidth,
    maxWidth: Math.max(minWidth, Math.min(options.maxWidth, viewport.width - inset - MARGIN))
  };
}

function clamp(value: number, lowest: number, highest: number): number {
  return Math.max(lowest, Math.min(value, highest));
}
