import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

import { WINDOWS_APP_ID } from '../windows-taskbar';

const repoRoot = new URL('../../../', import.meta.url);

function readRepoFile(relativePath: string): Promise<string> {
  return readFile(new URL(relativePath, repoRoot), 'utf8');
}

function topLevelSection(config: string, name: string): string {
  const lines = config.split(/\r?\n/);
  const start = lines.indexOf(`${name}:`);

  if (start === -1) {
    return '';
  }

  const end = lines.findIndex(
    (line, index) => index > start && line.length > 0 && !/^\s/.test(line)
  );

  return lines.slice(start, end === -1 ? undefined : end).join('\n');
}

function sectionValue(section: string, name: string): string | undefined {
  return section
    .split(/\r?\n/)
    .find((line) => line.startsWith(`  ${name}: `))
    ?.slice(`  ${name}: `.length);
}

describe('release packaging configuration', () => {
  it('connects the packaged Windows taskbar identity to the installer app ID', async () => {
    const [config, mainProcess] = await Promise.all([
      readRepoFile('electron-builder.yml'),
      readRepoFile('src/main/index.ts')
    ]);
    const configuredAppId = config.match(/^appId: (.+)$/m)?.[1];

    expect(WINDOWS_APP_ID).toBe(configuredAppId);
    expect(mainProcess).toContain(
      'configurePackagedWindowsApplicationIdentity(app, {'
    );
    expect(mainProcess).toContain(
      'configurePackagedWindowsTaskbarWindow(window, {'
    );
  });

  it('declares the package scripts and pinned electron-builder version', async () => {
    const packageJson = JSON.parse(await readRepoFile('package.json')) as {
      name: string;
      author: string;
      scripts: Record<string, string>;
      devDependencies: Record<string, string>;
    };

    expect(packageJson.name).toBe('lumora');
    expect(packageJson.author).toBe('HAYASAKA7');
    expect(packageJson.scripts.predev).toBe(
      'npm run helper:ensure && install-electron --no'
    );
    expect(packageJson.scripts['helper:ensure']).toBe(
      'node scripts/helper/ensure-helper.cjs'
    );
    expect(packageJson.scripts['package:dir']).toBe(
      'npm run helper:build && npm run build && electron-builder --dir'
    );
    expect(packageJson.scripts.package).toBe(
      'npm run helper:build && npm run build && electron-builder'
    );
    expect(packageJson.scripts['helper:test']).toBe(
      'node scripts/helper/generate-provider-probes.cjs && go -C helper test ./...'
    );
    expect(packageJson.scripts['helper:build']).toBe(
      'node scripts/helper/build-helper.cjs'
    );
    expect(packageJson.devDependencies['electron-builder']).toBe('26.15.3');
  });

  it('defines the unsigned cross-platform packaging contract', async () => {
    const config = await readRepoFile('electron-builder.yml');
    const directories = topLevelSection(config, 'directories');
    const files = topLevelSection(config, 'files');
    const asarUnpack = topLevelSection(config, 'asarUnpack');
    const extraResources = topLevelSection(config, 'extraResources');
    const extraMetadata = topLevelSection(config, 'extraMetadata');
    const win = topLevelSection(config, 'win');
    const nsis = topLevelSection(config, 'nsis');
    const mac = topLevelSection(config, 'mac');
    const linux = topLevelSection(config, 'linux');

    expect(config).toMatch(/^appId: app\.lumora\.desktop$/m);
    expect(config).toMatch(/^productName: Lumora$/m);
    expect(config).toMatch(/^artifactName: Lumora-\$\{version}-\$\{os}-\$\{arch}\.\$\{ext\}$/m);
    expect(directories).toContain('  output: dist');
    expect(directories).toContain('  buildResources: resources/icons/lumora');
    expect(files).toContain('  - out/**/*');
    expect(config).toMatch(/^asar: true$/m);
    expect(asarUnpack).toContain('  - node_modules/node-pty/**/*');
    expect(extraResources).toContain(
      '  - from: resources/icons/lumora/windows/LumoraTransparent.ico'
    );
    expect(extraResources).toContain('    to: icons/LumoraTransparent.ico');
    expect(extraResources).toContain('  - from: resources/helper/generated');
    expect(extraResources).toContain('    to: helper');
    expect(config).toMatch(/^npmRebuild: false$/m);
    expect(config).toMatch(/^forceCodeSigning: false$/m);
    expect(extraMetadata).toContain('  desktopName: app.lumora.desktop');

    expect(win).toContain('  executableName: Lumora');
    expect(win).toContain('  icon: windows/LumoraTransparent.ico');
    expect(win).toMatch(/  target:\n    - target: nsis\n      arch:\n        - x64/);
    expect(nsis).toContain('  oneClick: false');
    expect(nsis).toContain('  perMachine: false');
    expect(nsis).toContain('  allowToChangeInstallationDirectory: true');
    expect(nsis).toContain('  installerIcon: windows/LumoraTransparent.ico');
    expect(nsis).toContain('  uninstallerIcon: windows/LumoraTransparent.ico');
    expect(nsis).toContain('  installerHeaderIcon: windows/LumoraTransparent.ico');

    expect(mac).toContain('  executableName: Lumora');
    expect(mac).toContain('  icon: macos/Lumora.icns');
    expect(mac).toContain('  category: public.app-category.developer-tools');
    expect(mac).toContain('  identity: null');
    expect(mac).toContain('  hardenedRuntime: false');
    expect(mac).toMatch(
      /  target:\n    - target: dmg\n      arch:\n        - x64\n        - arm64/
    );

    expect(linux).toContain('  executableName: lumora');
    expect(linux).toContain('  syncDesktopName: true');
    expect(linux).not.toContain('  desktopName:');
    expect(linux).toContain('  icon: linux/lumora.png');
    expect(linux).toContain('  category: Development');
    expect(linux).toMatch(/  target:\n    - target: AppImage\n      arch:\n        - x64/);

    const buildResources = sectionValue(directories, 'buildResources');
    expect(
      [sectionValue(win, 'icon'), sectionValue(mac, 'icon'), sectionValue(linux, 'icon')].map(
        (icon) => `${buildResources}/${icon}`
      )
    ).toEqual([
      'resources/icons/lumora/windows/LumoraTransparent.ico',
      'resources/icons/lumora/macos/Lumora.icns',
      'resources/icons/lumora/linux/lumora.png'
    ]);

    expect(config.split(/\r?\n/)).not.toContainEqual(expect.stringMatching(/^publish:/));
  });
});
