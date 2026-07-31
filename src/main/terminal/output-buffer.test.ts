import { describe, expect, it } from 'vitest';

import { TerminalOutputBuffer } from './output-buffer';

describe('TerminalOutputBuffer', () => {
  it('retains only the newest snapshot characters across fragments', () => {
    const buffer = new TerminalOutputBuffer(10, 4);

    buffer.append('12345');
    buffer.append('67890');
    buffer.append('abc');

    expect(buffer.snapshot()).toBe('4567890abc');
    expect(buffer.drainEvents()).toEqual(['1234', '5678', '90ab', 'c']);
    expect(buffer.drainEvents()).toEqual([]);
  });

  it('replaces an older snapshot when one fragment exceeds the limit', () => {
    const buffer = new TerminalOutputBuffer(10, 64);

    buffer.append('older');
    buffer.drainEvents();
    buffer.append('abcdefghijkl');

    expect(buffer.snapshot()).toBe('cdefghijkl');
    expect(buffer.drainEvents()).toEqual(['abcdefghijkl']);
  });

  it('rejects non-positive limits', () => {
    expect(() => new TerminalOutputBuffer(0, 64)).toThrow(RangeError);
    expect(() => new TerminalOutputBuffer(64, 0)).toThrow(RangeError);
  });
});
