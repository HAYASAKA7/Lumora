import type { ProviderId } from '../../../shared/contracts';

const BRACKETED_PASTE_START = '\x1b[200~';
const BRACKETED_PASTE_END = '\x1b[201~';
const MAX_TRACKED_LINE_CHARS = 128;
const CODEX_EXIT_COMMANDS = new Set(['/exit', '/quit']);

export interface TerminalExitIntentTracker {
  observe(data: string): boolean;
  reset(): void;
}

export function createTerminalExitIntentTracker(
  provider: ProviderId
): TerminalExitIntentTracker {
  let line = '';

  return {
    observe(data) {
      if (provider !== 'codex') return false;
      const input = data
        .replaceAll(BRACKETED_PASTE_START, '')
        .replaceAll(BRACKETED_PASTE_END, '');
      if (input.includes('\x1b')) {
        line = '';
        return false;
      }

      let exitSubmitted = false;
      for (const character of input) {
        if (character === '\r' || character === '\n') {
          exitSubmitted ||= CODEX_EXIT_COMMANDS.has(line.trim());
          line = '';
        } else if (character === '\b' || character === '\x7f') {
          line = [...line].slice(0, -1).join('');
        } else if (character >= ' ') {
          line += character;
          if (line.length > MAX_TRACKED_LINE_CHARS) line = '';
        }
      }
      return exitSubmitted;
    },
    reset() {
      line = '';
    }
  };
}
