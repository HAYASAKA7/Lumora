import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const stylesheet = readFileSync(
  resolve(process.cwd(), 'src/renderer/src/styles.css'),
  'utf8'
);

describe('All Sessions row density', () => {
  it('uses readable desktop rows without enlarging responsive cards', () => {
    expect(stylesheet).toMatch(
      /\.session-table td\s*\{[^}]*padding:\s*16px 14px;/s
    );
    expect(stylesheet).toMatch(
      /@media \(max-width: 720px\)[\s\S]*\.session-table td\s*\{[^}]*padding:\s*7px 0;/
    );
  });
});
