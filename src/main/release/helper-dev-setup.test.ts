import { createRequire } from 'node:module';

import { describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const { ensureHelperBundle } = require(
  '../../../scripts/helper/ensure-helper.cjs'
) as {
  ensureHelperBundle(input: {
    expectedVersion: string;
    verify(): { helperVersion: string };
    build(): void;
  }): 'ready' | 'built';
};

describe('development helper bundle setup', () => {
  it('builds and re-verifies a missing helper bundle', () => {
    const build = vi.fn();
    const verify = vi
      .fn<() => { helperVersion: string }>()
      .mockImplementationOnce(() => {
        throw new Error('missing bundle');
      })
      .mockReturnValue({ helperVersion: '0.4.0' });

    expect(ensureHelperBundle({
      expectedVersion: '0.4.0',
      verify,
      build
    })).toBe('built');
    expect(build).toHaveBeenCalledOnce();
    expect(verify).toHaveBeenCalledTimes(2);
  });

  it('reuses a verified bundle with the current helper version', () => {
    const build = vi.fn();
    const verify = vi.fn(() => ({ helperVersion: '0.4.0' }));

    expect(ensureHelperBundle({
      expectedVersion: '0.4.0',
      verify,
      build
    })).toBe('ready');
    expect(build).not.toHaveBeenCalled();
  });

  it('rebuilds a verified but stale helper bundle', () => {
    const build = vi.fn();
    const verify = vi
      .fn<() => { helperVersion: string }>()
      .mockReturnValueOnce({ helperVersion: '0.3.1' })
      .mockReturnValue({ helperVersion: '0.4.0' });

    expect(ensureHelperBundle({
      expectedVersion: '0.4.0',
      verify,
      build
    })).toBe('built');
    expect(build).toHaveBeenCalledOnce();
  });
});
