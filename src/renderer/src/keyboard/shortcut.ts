import {
  KeyboardShortcutChordSchema,
  type KeyboardShortcutChord,
  type SystemInfo
} from '../../../shared/contracts';

type Platform = SystemInfo['platform'];

export function keyboardEventMatchesChord(
  event: KeyboardEvent,
  chord: KeyboardShortcutChord
): boolean {
  return event.code === chord.code &&
    event.ctrlKey === chord.control &&
    event.altKey === chord.alt &&
    event.shiftKey === chord.shift &&
    event.metaKey === chord.meta;
}

export function isRequiredModifierKey(
  code: string,
  chord: KeyboardShortcutChord
): boolean {
  if (code === 'ControlLeft' || code === 'ControlRight') return chord.control;
  if (code === 'AltLeft' || code === 'AltRight') return chord.alt;
  if (code === 'ShiftLeft' || code === 'ShiftRight') return chord.shift;
  if (code === 'MetaLeft' || code === 'MetaRight') return chord.meta;
  return false;
}

export function chordFromKeyboardEvent(
  event: KeyboardEvent
): KeyboardShortcutChord | null {
  const result = KeyboardShortcutChordSchema.safeParse({
    code: event.code,
    control: event.ctrlKey,
    alt: event.altKey,
    shift: event.shiftKey,
    meta: event.metaKey
  });
  return result.success ? result.data : null;
}

function keyLabel(code: string): string {
  if (code.startsWith('Key') && code.length === 4) return code.slice(3);
  if (code.startsWith('Digit') && code.length === 6) return code.slice(5);
  if (code === 'Space') return 'Space';
  return code;
}

export function formatShortcutChord(
  chord: KeyboardShortcutChord,
  platform: Platform
): string {
  const labels: string[] = [];
  if (chord.control) labels.push(platform === 'darwin' ? '⌃' : 'Ctrl');
  if (chord.alt) labels.push(platform === 'darwin' ? '⌥' : 'Alt');
  if (chord.shift) labels.push(platform === 'darwin' ? '⇧' : 'Shift');
  if (chord.meta) labels.push(platform === 'darwin' ? '⌘' : 'Meta');
  labels.push(keyLabel(chord.code));
  return labels.join(' + ');
}

export function shortcutConflictMessage(
  chord: KeyboardShortcutChord,
  platform: Platform
): string | null {
  if (
    platform === 'win32' &&
    chord.code === 'Tab' &&
    chord.alt &&
    !chord.control &&
    !chord.meta
  ) {
    return 'Alt + Tab is reserved by Windows.';
  }
  return null;
}
