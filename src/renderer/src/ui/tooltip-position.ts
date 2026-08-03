export interface TooltipRect {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export interface TooltipSize {
  width: number;
  height: number;
}

export interface TooltipViewport {
  width: number;
  height: number;
}

export interface TooltipPlacement {
  left: number;
  top: number;
  placement: 'top' | 'bottom';
}

const VIEWPORT_MARGIN = 8;
const TRIGGER_GAP = 8;

export function placeTooltip(input: {
  trigger: TooltipRect;
  tooltip: TooltipSize;
  viewport: TooltipViewport;
}): TooltipPlacement {
  const centeredLeft =
    (input.trigger.left + input.trigger.right - input.tooltip.width) / 2;
  const left = Math.min(
    Math.max(centeredLeft, VIEWPORT_MARGIN),
    Math.max(
      VIEWPORT_MARGIN,
      input.viewport.width - input.tooltip.width - VIEWPORT_MARGIN
    )
  );
  const above = input.trigger.top - input.tooltip.height - TRIGGER_GAP;
  if (above >= VIEWPORT_MARGIN) {
    return { left, top: above, placement: 'top' };
  }

  return {
    left,
    top: Math.min(
      input.trigger.bottom + TRIGGER_GAP,
      Math.max(
        VIEWPORT_MARGIN,
        input.viewport.height - input.tooltip.height - VIEWPORT_MARGIN
      )
    ),
    placement: 'bottom'
  };
}
