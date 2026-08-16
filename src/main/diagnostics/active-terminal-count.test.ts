import { describe, expect, it } from 'vitest';

import { countActiveTerminalRuntimes } from './active-terminal-count';

describe('countActiveTerminalRuntimes', () => {
  it('counts only launching and running local runtimes', () => {
    expect(countActiveTerminalRuntimes([
      { state: 'launching' },
      { state: 'running' },
      { state: 'completed' },
      { state: 'failed' },
      { state: 'runtime_lost' },
      { state: 'launch_failed' }
    ])).toBe(2);
  });
});
