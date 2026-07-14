import { describe, expect, it } from 'vitest';

import type { KeyboardShortcutChord } from '../../../shared/contracts';
import {
  chordFromKeyboardEvent,
  formatShortcutChord,
  isRequiredModifierKey,
  keyboardEventMatchesChord,
  shortcutConflictMessage
} from './shortcut';

const chord: KeyboardShortcutChord = {
  code: 'Tab',
  control: true,
  alt: false,
  shift: false,
  meta: false
};

function keyboardEvent(
  code: string,
  modifiers: Partial<Pick<KeyboardEvent, 'ctrlKey' | 'altKey' | 'shiftKey' | 'metaKey'>> = {}
): KeyboardEvent {
  return new KeyboardEvent('keydown', { code, ...modifiers });
}

describe('keyboard shortcut utilities', () => {
  it('matches the key code and every modifier exactly', () => {
    expect(keyboardEventMatchesChord(
      keyboardEvent('Tab', { ctrlKey: true }),
      chord
    )).toBe(true);
    expect(keyboardEventMatchesChord(
      keyboardEvent('Tab', { ctrlKey: true, shiftKey: true }),
      chord
    )).toBe(false);
    expect(keyboardEventMatchesChord(
      keyboardEvent('KeyK', { ctrlKey: true }),
      chord
    )).toBe(false);
  });

  it('records only valid modified non-modifier keys', () => {
    expect(chordFromKeyboardEvent(
      keyboardEvent('KeyK', { ctrlKey: true, shiftKey: true })
    )).toEqual({
      code: 'KeyK',
      control: true,
      alt: false,
      shift: true,
      meta: false
    });
    expect(chordFromKeyboardEvent(
      keyboardEvent('ShiftLeft', { shiftKey: true })
    )).toBeNull();
    expect(chordFromKeyboardEvent(keyboardEvent('KeyK'))).toBeNull();
  });

  it('formats platform-native modifier labels', () => {
    expect(formatShortcutChord(chord, 'win32')).toBe('Ctrl + Tab');
    expect(formatShortcutChord(chord, 'linux')).toBe('Ctrl + Tab');
    expect(formatShortcutChord({ ...chord, control: false, meta: true }, 'darwin'))
      .toBe('⌘ + Tab');
    expect(formatShortcutChord({ ...chord, shift: true }, 'darwin'))
      .toBe('⌃ + ⇧ + Tab');
  });

  it('rejects Windows Alt+Tab while allowing the chord elsewhere', () => {
    const altTab = { ...chord, control: false, alt: true };
    expect(shortcutConflictMessage(altTab, 'win32')).toMatch(/reserved/i);
    expect(shortcutConflictMessage(altTab, 'linux')).toBeNull();
    expect(shortcutConflictMessage(chord, 'win32')).toBeNull();
  });

  it('identifies only modifier keys required by the configured chord', () => {
    expect(isRequiredModifierKey('ControlLeft', chord)).toBe(true);
    expect(isRequiredModifierKey('ControlRight', chord)).toBe(true);
    expect(isRequiredModifierKey('ShiftLeft', chord)).toBe(false);
    expect(isRequiredModifierKey('Tab', chord)).toBe(false);
    expect(isRequiredModifierKey('MetaLeft', { ...chord, meta: true })).toBe(true);
  });
});
