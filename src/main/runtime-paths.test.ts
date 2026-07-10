import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { getRuntimePaths } from './runtime-paths';

describe('getRuntimePaths', () => {
  it('matches sandbox-compatible preload and renderer output locations', () => {
    const mainOutputDirectory = resolve('out/main');

    expect(getRuntimePaths(mainOutputDirectory)).toEqual({
      preloadPath: resolve('out/preload/index.cjs'),
      rendererRoot: resolve('out/renderer')
    });
  });
});
