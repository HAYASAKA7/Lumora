/// <reference types="node" />

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const rendererRoot = join(process.cwd(), 'src', 'renderer', 'src');

/**
 * The terminal switcher is a dialog the switcher shortcut owns from end to
 * end: it opens on the chord, follows the modifier and answers Escape in the
 * same handler, so it is not a layer of its own.
 */
const NOT_A_LAYER = [join('terminal', 'RuntimeSwitcher.tsx')];

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    if (!entry.name.endsWith('.tsx') || entry.name.includes('.test.')) return [];
    return [path];
  });
}

function dialogSources(): ReadonlyArray<readonly [string, string]> {
  return sourceFiles(rendererRoot)
    .map((path) => [path.slice(rendererRoot.length + 1), readFileSync(path, 'utf8')] as const)
    .filter(([name, source]) => source.includes('role="dialog"') && !NOT_A_LAYER.includes(name));
}

describe('dialogs and Escape', () => {
  it('gives every dialog an escape layer', () => {
    const missing = dialogSources()
      .filter(([, source]) => !source.includes('useEscapeLayer'))
      .map(([name]) => name);

    expect(missing).toEqual([]);
  });

  it('leaves the key itself to the layer stack', () => {
    const ownHandler = dialogSources()
      .filter(([, source]) => source.includes("'Escape'"))
      .map(([name]) => name);

    expect(ownHandler).toEqual([]);
  });
});
