import { describe, expect, it } from 'vitest';

import { TerminalAttentionScanner } from './terminal-attention';

const ESC = '\u001b';
const BEL = '\u0007';
const ST = `${ESC}\\`;

function scan(...chunks: string[]): boolean[] {
  const scanner = new TerminalAttentionScanner();
  return chunks.map((chunk) => scanner.scan(chunk));
}

describe('TerminalAttentionScanner', () => {
  it('hears the terminal bell', () => {
    expect(scan(`done${BEL}`)).toEqual([true]);
    expect(scan('plain output, nothing to hear')).toEqual([false]);
  });

  it('reads a desktop notification in either form and with either ending', () => {
    expect(scan(`${ESC}]9;Codex finished${BEL}`)).toEqual([true]);
    expect(scan(`${ESC}]9;Codex finished${ST}`)).toEqual([true]);
    expect(scan(`${ESC}]777;notify;Claude Code;Waiting for you${BEL}`)).toEqual([true]);
    expect(scan(`${ESC}]9;3 tests passed${BEL}`)).toEqual([true]);
  });

  it('takes a BEL that ends another sequence for the ending it is', () => {
    expect(scan(`${ESC}]0;window title${BEL}`)).toEqual([false]);
    expect(scan(`${ESC}]8;;https://example.com${BEL}link${ESC}]8;;${BEL}`)).toEqual([false]);
  });

  it('ignores the numbered OSC 9 codes terminals use for progress and the working directory', () => {
    expect(scan(`${ESC}]9;4;1;50${BEL}`)).toEqual([false]);
    expect(scan(`${ESC}]9;4;0${ST}`)).toEqual([false]);
    expect(scan(`${ESC}]9;9;C:\\Users\\me${BEL}`)).toEqual([false]);
  });

  it('keeps its place when a sequence is split across chunks', () => {
    expect(scan(`${ESC}]9`, ';all done', BEL)).toEqual([false, false, true]);
    expect(scan(`${ESC}]0;tit`, `le${BEL}after`)).toEqual([false, false]);
    expect(scan(ESC, `]9;done${BEL}`)).toEqual([false, true]);
  });

  it('passes colour codes and device strings without hearing anything', () => {
    expect(scan(`${ESC}[31mred${ESC}[0m`)).toEqual([false]);
    expect(scan(`${ESC}Pq#0;2;0;0;0${BEL}${ST}text`)).toEqual([false]);
  });

  it('recovers when a notification is cut short by another escape', () => {
    expect(scan(`${ESC}]9;cut${ESC}[0m${BEL}`)).toEqual([true]);
  });
});
