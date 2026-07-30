import { resolve } from 'node:path';

interface RuntimePaths {
  preloadPath: string;
  rendererRoot: string;
  windowIconPath?: string;
  trayIconPath?: string;
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
  const developmentTrayIcon =
    environment?.platform === 'win32'
      ? 'windows/LumoraTransparent.ico'
      : environment?.platform === 'darwin'
        ? 'macos/menu-bar/LumoraTemplate.png'
        : environment?.platform === 'linux'
          ? 'linux/usr/share/icons/hicolor/22x22/apps/lumora.png'
          : undefined;
  const packagedTrayIcon =
    environment?.platform === 'win32'
      ? 'LumoraTransparent.ico'
      : environment?.platform === 'darwin'
        ? 'LumoraTemplate.png'
        : environment?.platform === 'linux'
          ? 'lumora-tray.png'
          : undefined;
  const trayIconPath =
    environment === undefined || developmentTrayIcon === undefined || packagedTrayIcon === undefined
      ? undefined
      : environment.packaged
        ? resolve(environment.resourcesPath, 'icons', packagedTrayIcon)
        : resolve(
            mainOutputDirectory,
            '../../resources/icons/lumora',
            developmentTrayIcon
          );

  return {
    preloadPath: resolve(mainOutputDirectory, '../preload/index.cjs'),
    rendererRoot: resolve(mainOutputDirectory, '../renderer'),
    ...(windowIconPath === undefined ? {} : { windowIconPath }),
    ...(trayIconPath === undefined ? {} : { trayIconPath })
  };
}
