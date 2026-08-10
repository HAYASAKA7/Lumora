import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const rendererRoot = join(process.cwd(), 'src', 'renderer', 'src');

function rendererComponents(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return rendererComponents(path);
    return entry.isFile() && entry.name.endsWith('.tsx') &&
      !entry.name.endsWith('.test.tsx')
      ? [path]
      : [];
  });
}

describe('renderer native popup contract', () => {
  it('uses Lumora-owned dropdowns, confirmations, and tooltips', () => {
    const violations = rendererComponents(rendererRoot).flatMap((path) => {
      const source = readFileSync(path, 'utf8');
      return [
        ['native select', /<select\b/u],
        ['native confirm', /window\.(?:confirm|alert|prompt)\s*\(/u],
        ['native title tooltip', /<[A-Za-z][^>]*\btitle\s*=/u]
      ].flatMap(([label, pattern]) =>
        (pattern as RegExp).test(source)
          ? [`${path.slice(rendererRoot.length)}: ${label}`]
          : []
      );
    });

    expect(violations).toEqual([]);
  });
});
