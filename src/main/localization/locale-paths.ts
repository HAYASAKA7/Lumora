import { join } from 'node:path';

export type LocalePathInput = {
  isPackaged: boolean;
  appPath: string;
  resourcesPath: string;
  userDataPath: string;
};

export function resolveLocalePaths(input: LocalePathInput): {
  bundledRoot: string;
  userRoot: string;
} {
  return {
    bundledRoot: input.isPackaged
      ? join(input.resourcesPath, 'locales')
      : join(input.appPath, 'resources', 'locales'),
    userRoot: join(input.userDataPath, 'locales')
  };
}
