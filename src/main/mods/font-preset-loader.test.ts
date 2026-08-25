import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { loadFontPresets } from './font-preset-loader';

const roots: string[] = [];

async function root(): Promise<string> {
  const value = await mkdtemp(join(tmpdir(), 'lumora-font-mods-'));
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

afterEach(async () => {
  await Promise.all(roots.splice(0).map((value) =>
    rm(value, { recursive: true, force: true })
  ));
});

describe('loadFontPresets', () => {
  it('normalizes interface-only, terminal-only, and combined presets', async () => {
    const directory = await root();
    await preset(directory, 'interface.json', {
      schemaVersion: 1,
      id: 'interface',
      displayName: 'Readable UI',
      interfaceFontFamily: 'Atkinson Hyperlegible'
    });
    await preset(directory, 'terminal.json', {
      schemaVersion: 1,
      id: 'terminal',
      displayName: 'Terminal only',
      terminalFontFamily: 'JetBrains Mono'
    });
    await preset(directory, 'both.json', {
      schemaVersion: 1,
      id: 'both',
      displayName: 'Both fonts',
      interfaceFontFamily: 'Inter',
      terminalFontFamily: 'Cascadia Mono'
    });

    await expect(loadFontPresets(directory)).resolves.toEqual({
      presets: [
        {
          id: 'both',
          displayName: 'Both fonts',
          interfaceFontFamily: 'Inter',
          terminalFontFamily: 'Cascadia Mono'
        },
        {
          id: 'interface',
          displayName: 'Readable UI',
          interfaceFontFamily: 'Atkinson Hyperlegible',
          terminalFontFamily: null
        },
        {
          id: 'terminal',
          displayName: 'Terminal only',
          interfaceFontFamily: null,
          terminalFontFamily: 'JetBrains Mono'
        }
      ],
      rejectedCount: 0
    });
  });

  it('rejects malformed, mismatched, oversized, and linked preset files', async () => {
    const directory = await root();
    await preset(directory, 'wrong-id.json', {
      schemaVersion: 1,
      id: 'different-id',
      displayName: 'Mismatch',
      interfaceFontFamily: 'Inter'
    });
    await preset(directory, 'Bad_Name.json', {
      schemaVersion: 1,
      id: 'bad-name',
      displayName: 'Bad filename',
      interfaceFontFamily: 'Inter'
    });
    await writeFile(join(directory, 'malformed.json'), '{no', 'utf8');
    await writeFile(join(directory, 'oversized.json'), 'x'.repeat(65_537), 'utf8');
    const linkedTarget = join(await root(), 'linked-target');
    await mkdir(linkedTarget);
    await symlink(linkedTarget, join(directory, 'linked.json'), 'junction');

    await expect(loadFontPresets(directory)).resolves.toEqual({
      presets: [],
      rejectedCount: 5
    });
  });

  it('sorts deterministically and reads no more than 64 candidate files', async () => {
    const directory = await root();
    await Promise.all(Array.from({ length: 70 }, async (_, index) => {
      const id = `preset-${String(index).padStart(2, '0')}`;
      await preset(directory, `${id}.json`, {
        schemaVersion: 1,
        id,
        displayName: id,
        terminalFontFamily: 'JetBrains Mono'
      });
    }));

    const result = await loadFontPresets(directory);
    expect(result.presets).toHaveLength(64);
    expect(result.presets[0]?.id).toBe('preset-00');
    expect(result.presets.at(-1)?.id).toBe('preset-63');
    expect(result.rejectedCount).toBe(6);
  });
});
