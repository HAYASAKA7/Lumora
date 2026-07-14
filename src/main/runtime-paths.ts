import { resolve } from 'node:path';

interface RuntimePaths {
  preloadPath: string;
  rendererRoot: string;
  windowIconPath?: string;
}

interface RuntimePathEnvironment {
  platform: NodeJS.Platform;
  packaged: boolean;
  resourcesPath: string;
}

export function getRuntimePaths(
  mainOutputDirectory: string,
  environment?: RuntimePathEnvironment
): RuntimePaths {
  const windowIconPath =
    environment?.platform === 'win32'
      ? environment.packaged
        ? resolve(environment.resourcesPath, 'icons/LumoraTransparent.ico')
        : resolve(
            mainOutputDirectory,
            '../../resources/icons/lumora/windows/LumoraTransparent.ico'
          )
      : undefined;

  return {
    preloadPath: resolve(mainOutputDirectory, '../preload/index.cjs'),
    rendererRoot: resolve(mainOutputDirectory, '../renderer'),
    ...(windowIconPath === undefined ? {} : { windowIconPath })
  };
}
