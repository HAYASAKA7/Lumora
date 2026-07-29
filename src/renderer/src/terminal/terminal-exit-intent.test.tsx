import { describe, expect, it } from 'vitest';

import { createTerminalExitIntentTracker } from './terminal-exit-intent';

describe('terminal exit intent', () => {
  it.each(['/exit', '/quit', '  /exit  '])(
    'recognizes the submitted Codex command %j',
    (command) => {
      const tracker = createTerminalExitIntentTracker('codex');
      expect(tracker.observe(`${command}\r`)).toBe(true);
    }
  );

  it('tracks ordinary typing and backspace before submission', () => {
    const tracker = createTerminalExitIntentTracker('codex');
    expect(tracker.observe('/exot')).toBe(false);
    expect(tracker.observe('\x7f\x7fit\r')).toBe(true);
  });

  it('accepts a bracketed-paste command followed by Enter', () => {
    const tracker = createTerminalExitIntentTracker('codex');
    expect(tracker.observe('\x1b[200~/exit\x1b[201~')).toBe(false);
    expect(tracker.observe('\r')).toBe(true);
  });

  it.each(['/exit now\r', 'echo /exit\r', '/exi\r', '\r'])(
    'does not recognize non-exit input %j',
    (input) => {
      const tracker = createTerminalExitIntentTracker('codex');
      expect(tracker.observe(input)).toBe(false);
    }
  );

  it('does not inspect commands for other providers', () => {
    const tracker = createTerminalExitIntentTracker('claude');
    expect(tracker.observe('/exit\r')).toBe(false);
  });

  it('fails safe when cursor-control input makes the line ambiguous', () => {
    const tracker = createTerminalExitIntentTracker('codex');
    expect(tracker.observe('/ex\x1b[Dxit\r')).toBe(false);
  });

  it('can be reset between terminal lifecycles', () => {
    const tracker = createTerminalExitIntentTracker('codex');
    tracker.observe('/ex');
    tracker.reset();
    expect(tracker.observe('it\r')).toBe(false);
  });
});
