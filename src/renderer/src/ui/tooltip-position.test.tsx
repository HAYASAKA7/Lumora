import { describe, expect, it } from 'vitest';

import { placeTooltip } from './tooltip-position';

describe('placeTooltip', () => {
  it('centers above the trigger when there is room', () => {
    expect(
      placeTooltip({
        trigger: { left: 100, right: 140, top: 80, bottom: 110 },
        tooltip: { width: 100, height: 30 },
        viewport: { width: 400, height: 300 }
      })
    ).toEqual({ left: 70, top: 42, placement: 'top' });
  });

  it('moves below and clamps to the viewport margin near the top-left', () => {
    expect(
      placeTooltip({
        trigger: { left: 2, right: 30, top: 3, bottom: 31 },
        tooltip: { width: 120, height: 40 },
        viewport: { width: 300, height: 200 }
      })
    ).toEqual({ left: 8, top: 39, placement: 'bottom' });
  });

  it('clamps an oversized right-edge placement within the viewport', () => {
    expect(
      placeTooltip({
        trigger: { left: 280, right: 298, top: 100, bottom: 124 },
        tooltip: { width: 110, height: 32 },
        viewport: { width: 300, height: 200 }
      })
    ).toEqual({ left: 182, top: 60, placement: 'top' });
  });
});
