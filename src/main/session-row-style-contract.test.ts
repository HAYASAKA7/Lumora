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

describe('All Sessions column widths', () => {
  const desktop = stylesheet.slice(
    stylesheet.indexOf('@media (min-width: 721px)')
  );

  it('sizes the columns from the header so rows cannot move them', () => {
    expect(stylesheet).toContain('@media (min-width: 721px)');
    expect(desktop).toMatch(/\.session-table\s*\{[^}]*table-layout:\s*fixed;/);
    for (let column = 1; column <= 6; column += 1) {
      expect(desktop).toMatch(
        new RegExp(`\\.session-table th:nth-child\\(${column}\\)[^}]*width:\\s*\\d+%`)
      );
    }
  });

  it('truncates a long cell instead of rewrapping the row', () => {
    expect(desktop).toMatch(
      /\.session-table td\s*\{[^}]*text-overflow:\s*ellipsis;[^}]*white-space:\s*nowrap;/s
    );
  });
});
