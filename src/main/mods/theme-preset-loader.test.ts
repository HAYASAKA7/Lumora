import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { loadThemePresets } from './theme-preset-loader';

const roots: string[] = [];

async function root(): Promise<string> {
  const value = await mkdtemp(join(tmpdir(), 'lumora-theme-mods-'));
  roots.push(value);
  return value;
}

async function preset(
  directory: string,
  filename: string,
  value: unknown
): Promise<void> {
  await writeFile(join(directory, filename), JSON.stringify(value), 'utf8');
}

function validTheme(id: string) {
  return {
    schemaVersion: 1,
    id,
    displayName: 'Midnight cyan',
    baseTheme: 'dark',
    palette: {
      accent: '#22D3EE',
      onAccent: '#06202A',
      background: '#07111F',
      sidebar: '#081525',
      sidebarText: '#E6F7FF',
      surface: '#102033',
      surfaceRaised: '#172A40',
      control: '#1C334D',
      text: '#F3FAFF',
      textMuted: '#9CB2C8',
      border: '#39536D',
      success: '#41D6A3',
      warning: '#F2BE5C',
      danger: '#F4778A'
    }
  };
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((value) =>
    rm(value, { recursive: true, force: true })
  ));
});

describe('loadThemePresets', () => {
  it('loads valid theme packs in deterministic order', async () => {
    const directory = await root();
    await preset(directory, 'zeta.json', validTheme('zeta'));
    await preset(directory, 'alpha.json', validTheme('alpha'));

    const result = await loadThemePresets(directory);
    expect(result.rejectedCount).toBe(0);
    expect(result.presets.map((theme) => theme.id)).toEqual(['alpha', 'zeta']);
    expect(result.presets[0]?.palette.accent).toBe('#22D3EE');
  });

  it('rejects malformed, unsafe, mismatched, unreadable, and linked packs', async () => {
    const directory = await root();
    await preset(directory, 'wrong-id.json', validTheme('different-id'));
    await preset(directory, 'unsafe.json', {
      ...validTheme('unsafe'),
      palette: { ...validTheme('unsafe').palette, accent: 'var(--blue)' }
    });
    await preset(directory, 'low-contrast.json', {
      ...validTheme('low-contrast'),
      palette: { ...validTheme('low-contrast').palette, text: '#102033' }
    });
    await writeFile(join(directory, 'malformed.json'), '{no', 'utf8');
    await writeFile(join(directory, 'oversized.json'), 'x'.repeat(65_537), 'utf8');
    const target = join(await root(), 'target');
    await mkdir(target);
    await symlink(target, join(directory, 'linked.json'), 'junction');

    await expect(loadThemePresets(directory)).resolves.toEqual({
      presets: [],
      rejectedCount: 6
    });
  });

  it('reads no more than 64 candidate files', async () => {
    const directory = await root();
    await Promise.all(Array.from({ length: 70 }, async (_, index) => {
      const id = `theme-${String(index).padStart(2, '0')}`;
      await preset(directory, `${id}.json`, validTheme(id));
    }));

    const result = await loadThemePresets(directory);
    expect(result.presets).toHaveLength(64);
    expect(result.rejectedCount).toBe(6);
  });
});
