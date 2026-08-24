import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { resolveTestMaxWorkers } from '../../vitest.config';

const packageJson = JSON.parse(
  readFileSync(new URL('../../package.json', import.meta.url), 'utf8')
) as { scripts: Record<string, string> };

describe('local test worker configuration', () => {
  it('adapts local workers without exceeding three', () => {
    expect(resolveTestMaxWorkers(undefined, 1)).toBe(1);
    expect(resolveTestMaxWorkers('', 2)).toBe(1);
    expect(resolveTestMaxWorkers(undefined, 4)).toBe(2);
    expect(resolveTestMaxWorkers(undefined, 8)).toBe(3);
    expect(resolveTestMaxWorkers(undefined, 22)).toBe(3);
  });

  it('leaves CI worker selection to Vitest', () => {
    expect(resolveTestMaxWorkers('true', 22)).toBeUndefined();
    expect(resolveTestMaxWorkers('1', 2)).toBeUndefined();
  });

  it('runs each complete verification gate once', () => {
    expect(packageJson.scripts.verify).toBe(
      'npm test && npm run locales:validate && npm run locales:check-strings && npm run helper:test && npm run build'
    );
    expect(packageJson.scripts.build).toBe(
      'npm run typecheck && electron-vite build'
    );
  });
});
