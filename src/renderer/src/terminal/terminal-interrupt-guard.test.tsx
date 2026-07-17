import { describe, expect, it } from 'vitest';

import {
  decideTerminalInterrupt,
  TERMINAL_INTERRUPT_CONFIRMATION_MS
} from './terminal-interrupt-guard';

describe('decideTerminalInterrupt', () => {
  it('arms the first physical press', () => {
    expect(decideTerminalInterrupt(null, 1_000, false)).toEqual({
      action: 'arm',
      armedUntil: 2_500
    });
  });

  it('forwards a second physical press through the deadline boundary', () => {
    expect(decideTerminalInterrupt(2_500, 2_000, false)).toEqual({
      action: 'forward',
      armedUntil: null
    });
    expect(decideTerminalInterrupt(2_500, 2_500, false).action).toBe('forward');
  });

  it('starts a fresh window after the deadline expires', () => {
    expect(decideTerminalInterrupt(2_500, 2_501, false)).toEqual({
      action: 'arm',
      armedUntil: 2_501 + TERMINAL_INTERRUPT_CONFIRMATION_MS
    });
  });

  it('blocks held-key repeats without arming or confirming', () => {
    expect(decideTerminalInterrupt(2_500, 2_000, true)).toEqual({
      action: 'block',
      armedUntil: 2_500
    });
    expect(decideTerminalInterrupt(null, 1_000, true)).toEqual({
      action: 'block',
      armedUntil: null
    });
  });
});
