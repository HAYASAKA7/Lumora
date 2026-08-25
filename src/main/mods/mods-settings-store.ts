import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { z } from 'zod';

import { ModsSettingsSchema, type ModsSettings } from '../../shared/contracts';

const StoredModsSettingsSchema = z.strictObject({
  version: z.literal(1),
  selectedRoot: z.string().min(1).max(32_768).nullable()
});

type StoredModsSettings = z.infer<typeof StoredModsSettingsSchema>;

export type ModsSettingsStoreOptions = {
  preferencesPath: string;
  defaultRoot: string;
};

const DEFAULT_SETTINGS: StoredModsSettings = Object.freeze({
  version: 1,
  selectedRoot: null
});

function missing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === 'ENOENT';
}

export class ModsSettingsStore {
  private stored: StoredModsSettings | null = null;

  constructor(private readonly options: ModsSettingsStoreOptions) {}

  async getSettings(): Promise<ModsSettings> {
    const stored = await this.load();
    const rootPath = stored.selectedRoot ?? this.options.defaultRoot;
    return ModsSettingsSchema.parse({
      rootPath,
      localesPath: join(rootPath, 'locales'),
      usesDefault: stored.selectedRoot === null
    });
  }

  async selectRoot(rootPath: string): Promise<ModsSettings> {
    await this.assertWritableDirectory(rootPath);
    await mkdir(join(rootPath, 'locales'), { recursive: true });
    const selectedRoot = this.samePath(rootPath, this.options.defaultRoot)
      ? null
      : rootPath;
    await this.save({ version: 1, selectedRoot });
    return this.getSettings();
  }

  async resetRoot(): Promise<ModsSettings> {
    await this.assertWritableDirectory(this.options.defaultRoot);
    await mkdir(join(this.options.defaultRoot, 'locales'), { recursive: true });
    await this.save({ ...DEFAULT_SETTINGS });
    return this.getSettings();
  }

  async ensureRoot(): Promise<ModsSettings> {
    const settings = await this.getSettings();
    await mkdir(settings.localesPath, { recursive: true });
    return settings;
  }

  private async load(): Promise<StoredModsSettings> {
    if (this.stored !== null) return this.stored;
    try {
      const result = StoredModsSettingsSchema.safeParse(
        JSON.parse(await readFile(this.options.preferencesPath, 'utf8'))
      );
      this.stored = result.success ? result.data : { ...DEFAULT_SETTINGS };
    } catch (error) {
      if (!missing(error) && !(error instanceof SyntaxError)) throw error;
      this.stored = { ...DEFAULT_SETTINGS };
    }
    return this.stored;
  }

  private async save(settings: StoredModsSettings): Promise<void> {
    const parsed = StoredModsSettingsSchema.parse(settings);
    const parent = dirname(this.options.preferencesPath);
    const temporary = `${this.options.preferencesPath}.${randomUUID()}.tmp`;
    const backup = `${this.options.preferencesPath}.backup`;
    await mkdir(parent, { recursive: true });
    await writeFile(temporary, `${JSON.stringify(parsed, null, 2)}\n`, {
      encoding: 'utf8',
      flag: 'wx',
      mode: 0o600
    });
    let previousMoved = false;
    try {
      try {
        await rm(backup, { force: true });
        await rename(this.options.preferencesPath, backup);
        previousMoved = true;
      } catch (error) {
        if (!missing(error)) throw error;
      }
      await rename(temporary, this.options.preferencesPath);
      await rm(backup, { force: true });
    } catch (error) {
      if (previousMoved) await rename(backup, this.options.preferencesPath);
      throw error;
    } finally {
      await rm(temporary, { force: true });
    }
    this.stored = parsed;
  }

  private async assertWritableDirectory(rootPath: string): Promise<void> {
    if (!isAbsolute(rootPath) || rootPath.length > 32_768) {
      throw new Error('The selected Mods folder is not writable.');
    }
    const probe = join(rootPath, `.lumora-write-${randomUUID()}.tmp`);
    try {
      await mkdir(rootPath, { recursive: true });
      if (!(await stat(rootPath)).isDirectory()) throw new Error('not-directory');
      await writeFile(probe, '', { encoding: 'utf8', flag: 'wx', mode: 0o600 });
    } catch {
      throw new Error('The selected Mods folder is not writable.');
    } finally {
      await rm(probe, { force: true }).catch(() => undefined);
    }
  }

  private samePath(left: string, right: string): boolean {
    const normalizedLeft = resolve(left);
    const normalizedRight = resolve(right);
    return process.platform === 'win32'
      ? normalizedLeft.toLocaleLowerCase('en-US') ===
          normalizedRight.toLocaleLowerCase('en-US')
      : normalizedLeft === normalizedRight;
  }
}
