import { describe, expect, it } from 'vitest';

import { encodeTerminalNativeKey } from './terminal-native-key';

function key(
  type: 'keydown' | 'keyup',
  init: KeyboardEventInit
): KeyboardEvent {
  return new KeyboardEvent(type, {
    code: 'Enter',
    key: 'Enter',
    ...init
  });
}

describe('encodeTerminalNativeKey', () => {
  it('encodes the Codex Shift+Enter compatibility attempt as bracketed paste', () => {
    expect(
      encodeTerminalNativeKey(
        key('keydown', {
          shiftKey: true
        }),
        'codex'
      )
    ).toBe('\u001b[200~\n\u001b[201~');
  });

  it('preserves CSI-u encoding for other Codex modifier combinations', () => {
    expect(
      encodeTerminalNativeKey(
        key('keydown', {
          ctrlKey: true,
          metaKey: true,
          shiftKey: true
        }),
        'codex'
      )
    ).toBe('\u001b[13;14u');
  });

  it('preserves CSI-u Shift+Enter for other providers', () => {
    expect(
      encodeTerminalNativeKey(
        key('keydown', {
          shiftKey: true
        }),
        'claude'
      )
    ).toBe('\u001b[13;2u');
  });

  it('leaves plain Enter on the xterm path', () => {
    expect(
      encodeTerminalNativeKey(key('keydown', {}), 'codex')
    ).toBeNull();
  });

  it('leaves non-Enter keys on the xterm path', () => {
    expect(
      encodeTerminalNativeKey(
        new KeyboardEvent('keydown', {
          code: 'KeyT',
          ctrlKey: true,
          key: 't'
        }),
        'codex'
      )
    ).toBeNull();
  });

  it('does not send keyup events', () => {
    expect(
      encodeTerminalNativeKey(key('keyup', { shiftKey: true }), 'codex')
    ).toBeNull();
  });

  it('does not intercept an IME composition confirmation', () => {
    expect(
      encodeTerminalNativeKey(
        key('keydown', {
          isComposing: true,
          shiftKey: true
        }),
        'codex'
      )
    ).toBeNull();
  });
});
