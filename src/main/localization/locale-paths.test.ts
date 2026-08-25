import { describe, expect, it } from 'vitest';
import { join } from 'node:path';

import { resolveLocalePaths } from './locale-paths';

describe('locale paths', () => {
  it('uses project resources in development and managed user data for overrides', () => {
    expect(resolveLocalePaths({
      isPackaged: false,
      appPath: join('D:', 'Projects', 'Lumora'),
      resourcesPath: join('D:', 'Projects', 'Lumora', 'dist', 'resources'),
      userDataPath: join('D:', 'Profiles', 'Lumora-dev')
    })).toEqual({
      bundledRoot: join('D:', 'Projects', 'Lumora', 'resources', 'locales'),
      legacyUserRoot: join('D:', 'Profiles', 'Lumora-dev', 'locales'),
      defaultModsRoot: join('D:', 'Profiles', 'Lumora-dev', 'mods'),
      modsPreferencesPath: join('D:', 'Profiles', 'Lumora-dev', 'mods-settings.json')
    });
  });

  it('uses packaged resources without depending on the working directory', () => {
    expect(resolveLocalePaths({
      isPackaged: true,
      appPath: '/opt/Lumora/resources/app.asar',
      resourcesPath: '/opt/Lumora/resources',
      userDataPath: '/home/user/.config/Lumora'
    })).toEqual({
      bundledRoot: join('/opt/Lumora/resources', 'locales'),
      legacyUserRoot: join('/home/user/.config/Lumora', 'locales'),
      defaultModsRoot: join('/home/user/.config/Lumora', 'mods'),
      modsPreferencesPath: join('/home/user/.config/Lumora', 'mods-settings.json')
    });
  });
});
