import { describe, expect, it } from 'vitest';

import { resolveTestMaxWorkers } from '../../vitest.config';

describe('local test worker configuration', () => {
  it('caps local test runs at six workers', () => {
    expect(resolveTestMaxWorkers(undefined)).toBe(6);
    expect(resolveTestMaxWorkers('')).toBe(6);
  });

  it('leaves CI worker selection to Vitest', () => {
    expect(resolveTestMaxWorkers('true')).toBeUndefined();
    expect(resolveTestMaxWorkers('1')).toBeUndefined();
  });
});
