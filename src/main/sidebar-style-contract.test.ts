import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const stylesheet = readFileSync(
  resolve(process.cwd(), 'src/renderer/src/styles.css'),
  'utf8'
);

describe('sidebar style contract', () => {
  it('uses the centered 79 px collapsed icon rail', () => {
    const collapsedRule = stylesheet.match(
      /\.app-shell\.sidebar-collapsed\s*\{([^}]*)\}/
    )?.[1];

    expect(collapsedRule).toContain(
      'grid-template-columns: 79px minmax(0, 1fr)'
    );
  });

  it('keeps selected navigation treatment without the desktop left stripe', () => {
    const selectedRulePattern =
      /\.nav-item\[aria-current="page"\]\s*\{([^}]*)\}/;
    const desktopSelectedRule = stylesheet.match(selectedRulePattern)?.[1];
    const compactMediaStart = stylesheet.indexOf('@media (max-width: 900px)');
    const compactMediaEnd = stylesheet.indexOf(
      '@media (max-width: 680px)',
      compactMediaStart
    );
    const compactMedia = stylesheet.slice(compactMediaStart, compactMediaEnd);
    const compactSelectedRule = compactMedia.match(selectedRulePattern)?.[1];

    expect(compactMediaStart).toBeGreaterThanOrEqual(0);
    expect(compactMediaEnd).toBeGreaterThan(compactMediaStart);
    expect(desktopSelectedRule).toContain('background: #182a42');
    expect(desktopSelectedRule).toContain(
      'border-color: rgba(122, 164, 221, 0.16)'
    );
    expect(desktopSelectedRule).not.toContain('box-shadow');
    expect(compactSelectedRule).toContain(
      'box-shadow: inset 0 -2px 0 var(--blue)'
    );
  });
});
