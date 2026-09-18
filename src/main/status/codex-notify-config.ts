export type CodexNotifyConfig =
  | { state: 'absent' }
  | { state: 'present'; command: readonly string[] }
  | { state: 'unreadable' };

const BASIC_ESCAPES: Readonly<Record<string, string>> = {
  b: '\b',
  t: '\t',
  n: '\n',
  f: '\f',
  r: '\r',
  '"': '"',
  '\\': '\\'
};

/**
 * Reads the `notify` program at the top level of Codex's `config.toml`.
 *
 * Only what Codex itself reads there counts: a key under a table heading such
 * as a profile does not. Anything this cannot read for certain is reported as
 * unreadable rather than guessed at, so Lumora never overrides a program it
 * could not also run. The value is a list of strings, basic or literal, which
 * may run over several lines with comments between them.
 */
export function readCodexNotify(text: string): CodexNotifyConfig {
  const lines = text.split(/\r?\n/);
  let offset = 0;
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('[')) return { state: 'absent' };
    const match = /^\s*notify\s*=\s*/.exec(line);
    if (match !== null) {
      const command = readStringList(text, offset + match[0].length);
      return command === null || command.length === 0
        ? { state: 'unreadable' }
        : { state: 'present', command };
    }
    offset += line.length + (text[offset + line.length] === '\r' ? 2 : 1);
  }
  return { state: 'absent' };
}

function readStringList(text: string, start: number): string[] | null {
  if (text[start] !== '[') return null;
  const values: string[] = [];
  let index = start + 1;
  let expectValue = true;
  while (index < text.length) {
    const char = text[index]!;
    if (char === ' ' || char === '\t' || char === '\r' || char === '\n') {
      index += 1;
    } else if (char === '#') {
      while (index < text.length && text[index] !== '\n') index += 1;
    } else if (char === ']') {
      return values;
    } else if (char === ',') {
      if (expectValue) return null;
      expectValue = true;
      index += 1;
    } else if ((char === '"' || char === "'") && expectValue) {
      if (text.startsWith(char.repeat(3), index)) return null;
      const read = char === '"' ? readBasic(text, index) : readLiteral(text, index);
      if (read === null) return null;
      values.push(read.value);
      index = read.end;
      expectValue = false;
    } else {
      return null;
    }
  }
  return null;
}

function readLiteral(text: string, start: number): { value: string; end: number } | null {
  const close = text.indexOf("'", start + 1);
  if (close === -1) return null;
  const value = text.slice(start + 1, close);
  return value.includes('\n') ? null : { value, end: close + 1 };
}

function readBasic(text: string, start: number): { value: string; end: number } | null {
  let value = '';
  let index = start + 1;
  while (index < text.length) {
    const char = text[index]!;
    if (char === '"') return { value, end: index + 1 };
    if (char === '\n') return null;
    if (char !== '\\') {
      value += char;
      index += 1;
      continue;
    }
    const escape = text[index + 1];
    if (escape === undefined) return null;
    if (escape === 'u' || escape === 'U') {
      const length = escape === 'u' ? 4 : 8;
      const hex = text.slice(index + 2, index + 2 + length);
      if (!new RegExp(`^[0-9a-fA-F]{${length}}$`).test(hex)) return null;
      const codePoint = Number.parseInt(hex, 16);
      if (codePoint > 0x10ffff) return null;
      value += String.fromCodePoint(codePoint);
      index += 2 + length;
      continue;
    }
    const replacement = BASIC_ESCAPES[escape];
    if (replacement === undefined) return null;
    value += replacement;
    index += 2;
  }
  return null;
}
