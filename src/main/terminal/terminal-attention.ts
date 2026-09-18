/**
 * Enough of the start of an OSC string to tell what it is; the rest, which can
 * be a long message or a URL, is not kept.
 */
const OSC_PREFIX_CHARS = 32;

const ESC = '';
const BEL = '';
const C1_OSC = '';
const C1_ST = '';

type ScanState = 'text' | 'escape' | 'osc' | 'osc-escape' | 'string' | 'string-escape';

/**
 * A desktop notification an agent printed on purpose. `OSC 9` with a number
 * after it is ConEmu's family of codes rather than a message: Windows Terminal
 * uses `9;4` for taskbar progress and shells print `9;9` with the working
 * directory, both of them all the while a CLI works.
 */
function isNotification(osc: string): boolean {
  if (osc.startsWith('777;notify;')) return true;
  return osc.startsWith('9;') && !/^9;\d+(?:;|$)/.test(osc);
}

/**
 * Listens to a terminal's output for an agent asking for attention: the bell,
 * or a desktop notification in either common form. A BEL that ends an OSC
 * string is that string's ending and not a bell. The scanner keeps its place
 * between chunks, since a sequence can arrive split across two of them.
 */
export class TerminalAttentionScanner {
  private state: ScanState = 'text';
  private osc = '';

  /** Whether the chunk asked for attention at least once. */
  scan(chunk: string): boolean {
    let heard = false;
    for (let index = 0; index < chunk.length; index += 1) {
      if (this.read(chunk[index]!)) heard = true;
    }
    return heard;
  }

  private read(char: string): boolean {
    switch (this.state) {
      case 'text':
        if (char === BEL) return true;
        if (char === ESC) this.state = 'escape';
        else if (char === C1_OSC) this.startOsc();
        return false;
      case 'escape':
        return this.afterEscape(char);
      case 'osc':
        if (char === BEL || char === C1_ST) return this.endOsc();
        if (char === ESC) this.state = 'osc-escape';
        else if (this.osc.length < OSC_PREFIX_CHARS) this.osc += char;
        return false;
      case 'osc-escape':
        if (char === '\\') return this.endOsc();
        // Another sequence cut the string short: read the character as one after ESC.
        this.osc = '';
        return this.afterEscape(char);
      case 'string':
        if (char === ESC) this.state = 'string-escape';
        else if (char === C1_ST) this.state = 'text';
        return false;
      case 'string-escape':
        this.state = char === '\\' ? 'text' : char === ESC ? 'string-escape' : 'string';
        return false;
    }
  }

  private afterEscape(char: string): boolean {
    if (char === ']') this.startOsc();
    else if (char === 'P' || char === 'X' || char === '^' || char === '_') this.state = 'string';
    else if (char === ESC) this.state = 'escape';
    else this.state = 'text';
    return false;
  }

  private startOsc(): void {
    this.state = 'osc';
    this.osc = '';
  }

  private endOsc(): boolean {
    const osc = this.osc;
    this.osc = '';
    this.state = 'text';
    return isNotification(osc);
  }
}
