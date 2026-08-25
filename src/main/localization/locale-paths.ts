import { join } from 'node:path';

export type LocalePathInput = {
  isPackaged: boolean;
  appPath: string;
  resourcesPath: string;
  userDataPath: string;
};

export function resolveLocalePaths(input: LocalePathInput): {
  bundledRoot: string;
  legacyUserRoot: string;
  defaultModsRoot: string;
  modsPreferencesPath: string;
} {
  return {
    bundledRoot: input.isPackaged
      ? join(input.resourcesPath, 'locales')
      : join(input.appPath, 'resources', 'locales'),
    legacyUserRoot: join(input.userDataPath, 'locales'),
    defaultModsRoot: join(input.userDataPath, 'mods'),
    modsPreferencesPath: join(input.userDataPath, 'mods-settings.json')
  };
}
