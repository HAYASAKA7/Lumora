import type { ProviderId } from '../../../shared/contracts';

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
  event: TerminalNativeKeyEvent,
  provider: ProviderId
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

  // Codex's Windows input decoder can collapse both LF and modified Enter
  // sequences into plain Enter when hosted by an integrated ConPTY terminal.
  // Keep this bracketed-paste compatibility attempt isolated here. Codex
  // Shift+Enter remains a documented known issue because current releases do
  // not reliably insert the newline when hosted by Lumora.
  if (provider === 'codex' && modifiers === 1) {
    return '\u001b[200~\n\u001b[201~';
  }

  return `\u001b[13;${modifiers + 1}u`;
}
