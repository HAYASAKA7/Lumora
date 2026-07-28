import { describe, expect, it } from 'vitest';

import { moveRuntimeTab } from './runtime-tab-order';

describe('moveRuntimeTab', () => {
  it('moves a runtime forward without mutating the original order', () => {
    const order = ['one', 'two', 'three'];

    const result = moveRuntimeTab(order, 'one', 2);

    expect(result).toEqual(['two', 'three', 'one']);
    expect(order).toEqual(['one', 'two', 'three']);
  });

  it('moves a runtime backward', () => {
    expect(moveRuntimeTab(['one', 'two', 'three'], 'three', 0)).toEqual([
      'three',
      'one',
      'two'
    ]);
  });

  it('clamps a destination to the available tab range', () => {
    expect(moveRuntimeTab(['one', 'two', 'three'], 'one', 99)).toEqual([
      'two',
      'three',
      'one'
    ]);
    expect(moveRuntimeTab(['one', 'two', 'three'], 'three', -10)).toEqual([
      'three',
      'one',
      'two'
    ]);
  });

  it('returns the original order for an unknown runtime or unchanged position', () => {
    const order = ['one', 'two', 'three'];

    expect(moveRuntimeTab(order, 'missing', 1)).toBe(order);
    expect(moveRuntimeTab(order, 'two', 1)).toBe(order);
  });
});
