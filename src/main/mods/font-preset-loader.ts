import { lstat, mkdir, readFile, readdir } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { z } from 'zod';

import {
  FontFamilyNameSchema,
  FontPresetIdSchema,
  FontPresetListSchema,
  type FontPreset,
  type FontPresetList
} from '../../shared/contracts';

const MAX_PRESET_FILES = 64;
const MAX_PRESET_BYTES = 64 * 1024;

const FontPresetFileSchema = z.strictObject({
  schemaVersion: z.literal(1),
  id: FontPresetIdSchema,
  displayName: z.string().trim().min(1).max(80).refine(
    (value) => !/[\u0000-\u001f\u007f]/u.test(value)
  ),
  interfaceFontFamily: FontFamilyNameSchema.optional(),
  terminalFontFamily: FontFamilyNameSchema.optional()
}).refine(
  (value) => value.interfaceFontFamily !== undefined ||
    value.terminalFontFamily !== undefined
);

async function readPreset(
  directory: string,
  filename: string
): Promise<FontPreset | null> {
  const id = basename(filename, '.json');
  if (!FontPresetIdSchema.safeParse(id).success) return null;
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
  const parsed = FontPresetFileSchema.safeParse(value);
  if (!parsed.success || parsed.data.id !== id) return null;
  return {
    id: parsed.data.id,
    displayName: parsed.data.displayName,
    interfaceFontFamily: parsed.data.interfaceFontFamily ?? null,
    terminalFontFamily: parsed.data.terminalFontFamily ?? null
  };
}

export async function loadFontPresets(directory: string): Promise<FontPresetList> {
  await mkdir(directory, { recursive: true });
  const candidates = (await readdir(directory))
    .filter((filename) => filename.endsWith('.json'))
    .sort((left, right) => left.localeCompare(right, 'en'));
  const selected = candidates.slice(0, MAX_PRESET_FILES);
  let rejectedCount = candidates.length - selected.length;
  const presets: FontPreset[] = [];

  for (const filename of selected) {
    try {
      const preset = await readPreset(directory, filename);
      if (preset === null) rejectedCount += 1;
      else presets.push(preset);
    } catch {
      rejectedCount += 1;
    }
  }

  return FontPresetListSchema.parse({ presets, rejectedCount });
}
