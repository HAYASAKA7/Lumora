import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const iconRoot = fileURLToPath(
  new URL('../../../resources/icons/lumora/', import.meta.url)
);

const requiredAssets = [
  'windows/Lumora.ico',
  'macos/Lumora.icns',
  'linux/lumora.png',
  'linux/usr/share/icons/hicolor/scalable/apps/lumora.svg',
  'source/lumora-symbol-gradient.svg'
] as const;

describe('Lumora icon assets', () => {
  it('provides the canonical platform assets declared by the manifest', async () => {
    const manifest = JSON.parse(
      await readFile(join(iconRoot, 'icon-manifest.json'), 'utf8')
    ) as {
      name?: string;
      recommended?: Record<string, string>;
    };

    expect(manifest).toMatchObject({
      name: 'Lumora',
      recommended: {
        windowsExecutable: 'windows/Lumora.ico',
        macOSDock: 'macos/Lumora.icns',
        linuxDesktop:
          'linux/usr/share/icons/hicolor/scalable/apps/lumora.svg'
      }
    });

    for (const relativePath of requiredAssets) {
      expect((await stat(join(iconRoot, relativePath))).size).toBeGreaterThan(0);
    }
  });

  it('does not advertise the intentionally removed action icons', async () => {
    const readme = await readFile(join(iconRoot, 'README.md'), 'utf8');

    expect(readme).not.toContain('common/action-icons/');
    expect(readme).not.toContain('SVG action icons');
    await expect(
      stat(join(iconRoot, 'common', 'action-icons'))
    ).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
