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

  it('resolves the source taskbar icon for Windows development', () => {
    const repositoryRoot = resolve('repository');
    const mainOutputDirectory = resolve(repositoryRoot, 'out/main');

    expect(
      getRuntimePaths(mainOutputDirectory, {
        platform: 'win32',
        packaged: false,
        resourcesPath: resolve('packaged-resources')
      })
    ).toEqual({
      preloadPath: resolve(repositoryRoot, 'out/preload/index.cjs'),
      rendererRoot: resolve(repositoryRoot, 'out/renderer'),
      windowIconPath: resolve(
        repositoryRoot,
        'resources/icons/lumora/windows/LumoraTransparent.ico'
      )
    });
  });

  it('resolves the copied taskbar icon for packaged Windows', () => {
    const resourcesPath = resolve('packaged-resources');

    expect(
      getRuntimePaths(resolve('app/out/main'), {
        platform: 'win32',
        packaged: true,
        resourcesPath
      }).windowIconPath
    ).toBe(resolve(resourcesPath, 'icons/LumoraTransparent.ico'));
  });

  it('does not set a window icon on macOS or Linux', () => {
    const mainOutputDirectory = resolve('out/main');
    const resourcesPath = resolve('packaged-resources');

    expect(
      getRuntimePaths(mainOutputDirectory, {
        platform: 'darwin',
        packaged: true,
        resourcesPath
      }).windowIconPath
    ).toBeUndefined();
    expect(
      getRuntimePaths(mainOutputDirectory, {
        platform: 'linux',
        packaged: false,
        resourcesPath
      }).windowIconPath
    ).toBeUndefined();
  });
});
