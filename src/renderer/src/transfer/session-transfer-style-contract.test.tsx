/// <reference types="node" />

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const styles = readFileSync(
  join(process.cwd(), 'src', 'renderer', 'src', 'styles.css'),
  'utf8'
).replace(/\r\n/g, '\n');

function rule(selector: string): string {
  const start = styles.indexOf(`${selector} {`);
  expect(start, `Missing CSS rule for ${selector}`).toBeGreaterThanOrEqual(0);
  const bodyStart = styles.indexOf('{', start) + 1;
  const bodyEnd = styles.indexOf('}', bodyStart);
  return styles.slice(bodyStart, bodyEnd);
}

describe('Session Transfer style contract', () => {
  it('keeps a fixed workflow shell and an independently scrolling body', () => {
    const dialog = rule('.session-transfer-dialog');
    expect(dialog).toContain('width: min(760px, calc(100vw - 48px))');
    expect(dialog).toContain('height: min(680px, calc(100vh - 48px))');
    expect(dialog).toContain('overflow: hidden');

    const body = rule('.session-transfer-dialog .dialog-body');
    expect(body).toContain('min-height: 0');
    expect(body).toContain('overflow-y: auto');
    expect(body).toContain('scrollbar-gutter: stable both-edges');
  });
  it('keeps the export workflow stable while its review content changes', () => {
    const dialog = rule('.session-export-dialog');
    expect(dialog).toContain('width: min(680px, calc(100vw - 48px))');
    expect(dialog).toContain('height: min(610px, calc(100vh - 48px))');
    expect(dialog).toContain('overflow: hidden');

    const body = rule('.session-export-dialog .dialog-body');
    expect(body).toContain('min-height: 0');
    expect(body).toContain('overflow-y: auto');
    expect(body).toContain('scrollbar-gutter: stable both-edges');
  });
});
