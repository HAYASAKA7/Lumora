import { resolve } from 'node:path';

interface RuntimePaths {
  preloadPath: string;
  rendererRoot: string;
}

export function getRuntimePaths(mainOutputDirectory: string): RuntimePaths {
  return {
    preloadPath: resolve(mainOutputDirectory, '../preload/index.cjs'),
    rendererRoot: resolve(mainOutputDirectory, '../renderer')
  };
}
