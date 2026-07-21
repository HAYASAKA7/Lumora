import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const stylesheet = readFileSync(
  resolve(process.cwd(), 'src/renderer/src/styles.css'),
  'utf8'
);

function declarationsFor(selector: string): string {
  const selectorStart = stylesheet.indexOf(`${selector} {`);
  if (selectorStart < 0) return '';
  const blockStart = stylesheet.indexOf('{', selectorStart) + 1;
  const blockEnd = stylesheet.indexOf('}', blockStart);
  return stylesheet.slice(blockStart, blockEnd);
}

describe('application scrollbar style contract', () => {
  it('rounds application scrollbars without restyling the xterm viewport', () => {
    const applicationScrollbarSelector =
      '.app-shell *:not(.xterm-viewport)::-webkit-scrollbar';
    const thumbSelector = `${applicationScrollbarSelector}-thumb`;
    const cornerSelector = `${applicationScrollbarSelector}-corner`;

    expect(declarationsFor(applicationScrollbarSelector)).toContain(
      'width: 12px'
    );
    expect(declarationsFor(thumbSelector)).toContain('border-radius: 999px');
    expect(declarationsFor(cornerSelector)).toContain(
      'background: transparent'
    );
    expect(stylesheet).not.toContain(
      '.xterm-viewport::-webkit-scrollbar-thumb'
    );
  });
});
