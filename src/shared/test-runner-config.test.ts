import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { resolveTestMaxWorkers } from '../../vitest.config';
import {
  resolveAsyncUtilTimeout,
  resolveTestTimeouts
} from './test-runner-config';

const testSetup = readFileSync(
  new URL('../renderer/src/test-setup.ts', import.meta.url),
  'utf8'
);

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

  /**
   * The Windows runner takes three to four times as long as Linux for the same
   * suite, so a machine that is merely having a slow day pushes a query that
   * would normally resolve in milliseconds past the one second Testing Library
   * allows. The headroom only changes how long a failing wait persists; a query
   * that resolves still returns immediately.
   */
  it('gives waiting queries room on a slow continuous integration machine', () => {
    expect(resolveAsyncUtilTimeout(undefined)).toBe(1_000);
    expect(resolveAsyncUtilTimeout('')).toBe(1_000);
    expect(resolveAsyncUtilTimeout('true')).toBe(5_000);
    expect(resolveAsyncUtilTimeout('1')).toBe(5_000);
  });

  it('keeps a test alive longer than the query it is waiting on', () => {
    expect(resolveTestTimeouts(undefined)).toEqual({});
    expect(resolveTestTimeouts('true')).toEqual({
      testTimeout: 30_000,
      hookTimeout: 30_000
    });
    expect(resolveTestTimeouts('true').testTimeout!)
      .toBeGreaterThan(resolveAsyncUtilTimeout('true'));
  });

  it('applies the query headroom to every renderer test', () => {
    expect(testSetup).toContain('resolveAsyncUtilTimeout');
    expect(testSetup).toContain('asyncUtilTimeout');
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
