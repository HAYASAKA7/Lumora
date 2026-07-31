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
  it('encodes Shift+Enter with standard CSI-u modifiers', () => {
    expect(encodeTerminalNativeKey(key('keydown', {
      shiftKey: true
    }))).toBe('\u001b[13;2u');
  });

  it('combines Control, Shift, and Meta modifiers', () => {
    expect(encodeTerminalNativeKey(key('keydown', {
      ctrlKey: true,
      metaKey: true,
      shiftKey: true
    }))).toBe('\u001b[13;14u');
  });

  it('encodes Alt+Enter without provider-specific remapping', () => {
    expect(encodeTerminalNativeKey(key('keydown', {
      altKey: true
    }))).toBe('\u001b[13;3u');
  });

  it('leaves plain Enter on the xterm path', () => {
    expect(encodeTerminalNativeKey(key('keydown', {}))).toBeNull();
  });

  it('leaves non-Enter keys on the xterm path', () => {
    expect(encodeTerminalNativeKey(new KeyboardEvent('keydown', {
      code: 'KeyT',
      ctrlKey: true,
      key: 't'
    }))).toBeNull();
  });

  it('does not send keyup events', () => {
    expect(encodeTerminalNativeKey(key('keyup', {
      shiftKey: true
    }))).toBeNull();
  });

  it('does not intercept an IME composition confirmation', () => {
    expect(encodeTerminalNativeKey(key('keydown', {
      isComposing: true,
      shiftKey: true
    }))).toBeNull();
  });
});
