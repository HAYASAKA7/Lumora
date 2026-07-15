import { describe, expect, it } from 'vitest';

import {
  MIN_WINDOW_HEIGHT,
  MIN_WINDOW_WIDTH,
  parseWindowState,
  resolveWindowRestore,
  type PersistedWindowState,
  type WindowBounds
} from './window-state';

const primaryWorkArea: WindowBounds = {
  x: 0,
  y: 0,
  width: 1920,
  height: 1040
};

const validState: PersistedWindowState = {
  version: 1,
  normalBounds: {
    x: 100,
    y: 80,
    width: 1280,
    height: 800
  },
  maximized: false
};

describe('parseWindowState', () => {
  it('accepts only the strict versioned window-state shape', () => {
    expect(parseWindowState(JSON.stringify(validState))).toEqual(validState);
    expect(
      parseWindowState(JSON.stringify({ ...validState, version: 2 }))
    ).toBeNull();
    expect(
      parseWindowState(JSON.stringify({ ...validState, extra: true }))
    ).toBeNull();
    expect(parseWindowState('{broken')).toBeNull();
  });

  it('rejects non-integer, non-finite, and undersized bounds', () => {
    const invalidBounds = [
      { ...validState.normalBounds, x: 1.5 },
      { ...validState.normalBounds, y: Number.POSITIVE_INFINITY },
      { ...validState.normalBounds, width: MIN_WINDOW_WIDTH - 1 },
      { ...validState.normalBounds, height: MIN_WINDOW_HEIGHT - 1 }
    ];

    for (const normalBounds of invalidBounds) {
      expect(
        parseWindowState(JSON.stringify({ ...validState, normalBounds }))
      ).toBeNull();
    }
  });
});

describe('resolveWindowRestore', () => {
  it('maximizes first launches and invalid-state fallbacks', () => {
    expect(resolveWindowRestore(null, [primaryWorkArea])).toEqual({
      normalBounds: null,
      maximized: true,
      source: 'fallback'
    });
    expect(resolveWindowRestore(validState, [])).toEqual({
      normalBounds: null,
      maximized: true,
      source: 'fallback'
    });
  });

  it('restores visible bounds and their maximized state', () => {
    expect(
      resolveWindowRestore(
        { ...validState, maximized: true },
        [primaryWorkArea]
      )
    ).toEqual({
      normalBounds: validState.normalBounds,
      maximized: true,
      source: 'saved'
    });
  });

  it('clamps partially visible bounds fully inside the display work area', () => {
    const state = {
      ...validState,
      normalBounds: {
        x: -200,
        y: -100,
        width: 2200,
        height: 1200
      }
    };

    expect(resolveWindowRestore(state, [primaryWorkArea])).toEqual({
      normalBounds: primaryWorkArea,
      maximized: false,
      source: 'saved'
    });
  });

  it('uses the qualifying display with the largest intersection', () => {
    const leftDisplay = { x: -1280, y: 0, width: 1280, height: 1024 };
    const rightDisplay = { x: 0, y: 0, width: 1920, height: 1040 };
    const state = {
      ...validState,
      normalBounds: {
        x: -400,
        y: 100,
        width: 1400,
        height: 800
      }
    };

    expect(resolveWindowRestore(state, [leftDisplay, rightDisplay])).toEqual({
      normalBounds: {
        x: 0,
        y: 100,
        width: 1400,
        height: 800
      },
      maximized: false,
      source: 'saved'
    });
  });

  it('falls back for off-screen bounds and undersized display work areas', () => {
    const offScreenState = {
      ...validState,
      normalBounds: { ...validState.normalBounds, x: 5000, y: 5000 }
    };
    const undersizedDisplay = {
      x: 0,
      y: 0,
      width: MIN_WINDOW_WIDTH - 1,
      height: MIN_WINDOW_HEIGHT
    };

    expect(resolveWindowRestore(offScreenState, [primaryWorkArea]).source).toBe(
      'fallback'
    );
    expect(resolveWindowRestore(validState, [undersizedDisplay]).source).toBe(
      'fallback'
    );
  });

  it('requires a 64 by 32 pixel visible intersection', () => {
    const only63Wide = {
      ...validState,
      normalBounds: {
        ...validState.normalBounds,
        x: primaryWorkArea.width - 63
      }
    };
    const exactlyVisible = {
      ...validState,
      normalBounds: {
        ...validState.normalBounds,
        x: primaryWorkArea.width - 64,
        y: primaryWorkArea.height - 32
      }
    };

    expect(resolveWindowRestore(only63Wide, [primaryWorkArea]).source).toBe(
      'fallback'
    );
    expect(resolveWindowRestore(exactlyVisible, [primaryWorkArea]).source).toBe(
      'saved'
    );
  });
});
