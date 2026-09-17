/// <reference types="node" />

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const rendererRoot = join(process.cwd(), 'src', 'renderer', 'src');

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    if (!/\.tsx?$/.test(entry.name) || entry.name.includes('.test.')) return [];
    return [path];
  });
}

/**
 * Everything a portal renders belongs inside the app shell.
 *
 * The shell is the appearance root, and the appearance settings live there as
 * tokens: a background picture turns each surface token into a translucent
 * colour on that element. A portal that lands on the body sits outside it, so
 * it resolves the opaque defaults instead and ignores the appearance the rest
 * of the window follows. The body remains the fallback for a window that has
 * no shell.
 */
describe('portals and the appearance root', () => {
  it('reaches the body only behind the app shell', () => {
    const offenders = sourceFiles(rendererRoot).flatMap((path) => {
      const name = path.slice(rendererRoot.length + 1);
      return readFileSync(path, 'utf8')
        .split('\n')
        .flatMap((line, index) => (
          line.includes('document.body') && !line.includes('.app-shell')
            ? [`${name}:${index + 1}`]
            : []
        ));
    });

    expect(offenders).toEqual([]);
  });
});
