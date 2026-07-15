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
    const selectedRules = [
      ...stylesheet.matchAll(
        /\.nav-item\[aria-current="page"\]\s*\{([^}]*)\}/g
      )
    ].map((match) => match[1]);

    expect(selectedRules).toHaveLength(2);
    expect(selectedRules[0]).toContain('background: #182a42');
    expect(selectedRules[0]).toContain(
      'border-color: rgba(122, 164, 221, 0.16)'
    );
    expect(selectedRules[0]).not.toContain('box-shadow');
    expect(selectedRules[1]).toContain('box-shadow: inset 0 -2px 0 var(--blue)');
  });
});
