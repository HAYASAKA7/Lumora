import { lstat, mkdir, readFile, readdir } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { z } from 'zod';

import {
  AppearanceThemeSchema,
  ThemePaletteSchema,
  ThemePresetIdSchema,
  ThemePresetListSchema,
  ThemePresetSchema,
  type ThemePreset,
  type ThemePresetList
} from '../../shared/contracts';

const MAX_PRESET_FILES = 64;
const MAX_PRESET_BYTES = 64 * 1024;

const ThemePresetFileSchema = z.strictObject({
  schemaVersion: z.literal(1),
  id: ThemePresetIdSchema,
  displayName: z.string().trim().min(1).max(80).refine(
    (value) => !/[\u0000-\u001f\u007f]/u.test(value)
  ),
  baseTheme: AppearanceThemeSchema,
  palette: ThemePaletteSchema
});

async function readPreset(
  directory: string,
  filename: string
): Promise<ThemePreset | null> {
  const id = basename(filename, '.json');
  if (!ThemePresetIdSchema.safeParse(id).success) return null;
  const path = join(directory, filename);
  const metadata = await lstat(path);
  if (metadata.isSymbolicLink() || !metadata.isFile()) return null;
  if (metadata.size > MAX_PRESET_BYTES) return null;

  let value: unknown;
  try {
    value = JSON.parse(await readFile(path, 'utf8')) as unknown;
  } catch {
    return null;
  }
  const file = ThemePresetFileSchema.safeParse(value);
  if (!file.success || file.data.id !== id) return null;
  const normalized = ThemePresetSchema.safeParse({
    id: file.data.id,
    displayName: file.data.displayName,
    baseTheme: file.data.baseTheme,
    palette: file.data.palette
  });
  return normalized.success ? normalized.data : null;
}

export async function loadThemePresets(directory: string): Promise<ThemePresetList> {
  await mkdir(directory, { recursive: true });
  const candidates = (await readdir(directory))
    .filter((filename) => filename.endsWith('.json'))
    .sort((left, right) => left.localeCompare(right, 'en'));
  const selected = candidates.slice(0, MAX_PRESET_FILES);
  let rejectedCount = candidates.length - selected.length;
  const presets: ThemePreset[] = [];

  for (const filename of selected) {
    try {
      const preset = await readPreset(directory, filename);
      if (preset === null) rejectedCount += 1;
      else presets.push(preset);
    } catch {
      rejectedCount += 1;
    }
  }

  return ThemePresetListSchema.parse({ presets, rejectedCount });
}
