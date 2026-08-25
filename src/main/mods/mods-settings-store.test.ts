import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { ModsSettingsStore } from './mods-settings-store';

const roots: string[] = [];

async function root(): Promise<string> {
  const value = await mkdtemp(join(tmpdir(), 'lumora-mods-'));
  roots.push(value);
  return value;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((value) =>
    rm(value, { recursive: true, force: true })
  ));
});

describe('ModsSettingsStore', () => {
  it('uses the managed default root and persists a custom absolute root', async () => {
    const userData = await root();
    const custom = join(await root(), 'my-mods');
    const store = new ModsSettingsStore({
      preferencesPath: join(userData, 'mods-settings.json'),
      defaultRoot: join(userData, 'mods')
    });

    await expect(store.getSettings()).resolves.toMatchObject({
      rootPath: join(userData, 'mods'),
      localesPath: join(userData, 'mods', 'locales'),
      fontsPath: join(userData, 'mods', 'fonts'),
      themesPath: join(userData, 'mods', 'themes'),
      usesDefault: true
    });
    await expect(store.selectRoot(custom)).resolves.toMatchObject({
      rootPath: custom,
      localesPath: join(custom, 'locales'),
      fontsPath: join(custom, 'fonts'),
      themesPath: join(custom, 'themes'),
      usesDefault: false
    });
    expect(isAbsolute(custom)).toBe(true);
    expect(JSON.parse(await readFile(join(userData, 'mods-settings.json'), 'utf8')))
      .toEqual({ version: 1, selectedRoot: custom });
  });

  it('recovers from invalid preferences and can restore the default root', async () => {
    const userData = await root();
    const preferencesPath = join(userData, 'mods-settings.json');
    const store = new ModsSettingsStore({
      preferencesPath,
      defaultRoot: join(userData, 'mods')
    });
    await store.selectRoot(join(await root(), 'custom'));
    await expect(store.resetRoot()).resolves.toMatchObject({
      rootPath: join(userData, 'mods'),
      usesDefault: true
    });
  });
});
