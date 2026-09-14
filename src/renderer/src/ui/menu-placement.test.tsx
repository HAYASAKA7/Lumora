import { describe, expect, it } from 'vitest';

import { placeMenu } from './menu-placement';

const viewport = { width: 1200, height: 800 };

function anchor(left: number, top: number, width: number, height = 34) {
  return { left, top, bottom: top + height, right: left + width, width };
}

describe('placeMenu', () => {
  it('opens below the trigger when the list fits there', () => {
    expect(placeMenu(anchor(100, 100, 150), viewport, {
      align: 'start',
      itemCount: 3,
      minWidth: 0,
      maxWidth: 360
    })).toMatchObject({
      position: 'fixed',
      top: 140,
      bottom: 'auto',
      left: 100,
      right: 'auto',
      maxHeight: 220
    });
  });

  it('holds a menu that opens above by its bottom edge, so a short list sits on the trigger', () => {
    const placement = placeMenu(anchor(40, 740, 150), viewport, {
      align: 'start',
      itemCount: 2,
      minWidth: 0,
      maxWidth: 360
    });

    // The trigger's top is 740; the list ends 6px above it whatever its height.
    expect(placement).toMatchObject({ top: 'auto', bottom: 66, maxHeight: 220 });
  });

  it('opens above when a longer list would be cut short below and there is more room above', () => {
    expect(placeMenu(anchor(40, 560, 150), viewport, {
      align: 'start',
      itemCount: 8,
      minWidth: 0,
      maxWidth: 360
    })).toMatchObject({ top: 'auto', bottom: 246 });
    expect(placeMenu(anchor(40, 560, 150), viewport, {
      align: 'start',
      itemCount: 3,
      minWidth: 0,
      maxWidth: 360
    })).toMatchObject({ top: 600, bottom: 'auto' });
  });

  it('is at least as wide as its trigger and grows to fit its labels up to a limit', () => {
    expect(placeMenu(anchor(100, 100, 96), viewport, {
      align: 'start',
      itemCount: 3,
      minWidth: 0,
      maxWidth: 360
    })).toMatchObject({ width: 'max-content', minWidth: 96, maxWidth: 360 });
    expect(placeMenu(anchor(100, 100, 420), viewport, {
      align: 'start',
      itemCount: 3,
      minWidth: 0,
      maxWidth: 360
    })).toMatchObject({ minWidth: 420, maxWidth: 420 });
  });

  it('hangs a right-aligned menu from the trigger’s right edge and keeps it in the window', () => {
    expect(placeMenu(anchor(900, 700, 220), viewport, {
      align: 'end',
      itemCount: 4,
      minWidth: 0,
      maxWidth: 360
    })).toMatchObject({ left: 'auto', right: 80, minWidth: 220, maxWidth: 360 });
    // A trigger at the window's edge still leaves the margin, and the menu
    // cannot grow past the window's other side.
    expect(placeMenu(anchor(1150, 700, 60), { width: 1200, height: 800 }, {
      align: 'start',
      itemCount: 4,
      minWidth: 164,
      maxWidth: 360
    })).toMatchObject({ left: 1028, minWidth: 164, maxWidth: 164 });
  });
});
