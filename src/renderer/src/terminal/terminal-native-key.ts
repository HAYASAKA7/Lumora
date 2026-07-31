type TerminalNativeKeyEvent = Pick<
  KeyboardEvent,
  | 'altKey'
  | 'ctrlKey'
  | 'isComposing'
  | 'key'
  | 'metaKey'
  | 'shiftKey'
  | 'type'
>;

export function encodeTerminalNativeKey(
  event: TerminalNativeKeyEvent
): string | null {
  if (event.type !== 'keydown' || event.isComposing || event.key !== 'Enter') {
    return null;
  }

  const modifiers =
    (event.shiftKey ? 1 : 0) |
    (event.altKey ? 2 : 0) |
    (event.ctrlKey ? 4 : 0) |
    (event.metaKey ? 8 : 0);
  if (modifiers === 0) return null;

  return `\u001b[13;${modifiers + 1}u`;
}
