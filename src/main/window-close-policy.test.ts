import { describe, expect, it } from 'vitest';

import { resolveWindowCloseAction } from './window-close-policy';

describe('resolveWindowCloseAction', () => {
  it('allows the window to close once orderly application shutdown started', () => {
    expect(resolveWindowCloseAction({
      shutdownStarted: true,
      behavior: 'hide_to_tray'
    })).toBe('allow');
  });

  it('keeps the existing window alive when close-to-tray is selected', () => {
    expect(resolveWindowCloseAction({
      shutdownStarted: false,
      behavior: 'hide_to_tray'
    })).toBe('hide');
  });

  it('requests orderly application shutdown for quit behavior', () => {
    expect(resolveWindowCloseAction({
      shutdownStarted: false,
      behavior: 'quit'
    })).toBe('quit');
  });
});
