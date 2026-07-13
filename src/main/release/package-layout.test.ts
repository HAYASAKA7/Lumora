import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { mkdtemp, mkdir, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { verifyPackage } = require('../../../scripts/release/verify-package.cjs') as {
  verifyPackage(options: {
    rootDir: string;
    outputDir?: string;
    platform: PackagePlatform;
    arch: PackageArch;
    requireArtifact?: boolean;
  }): PackageVerification;
};

type PackagePlatform = 'win' | 'linux' | 'mac';
type PackageArch = 'x64' | 'arm64';

interface PackageVerification {
  artifactPath?: string;
  executablePath: string;
  nodePtyPath: string;
}

interface PackageFixture extends PackageVerification {
  rootDir: string;
  nativeBinaryPath: string;
}

const temporaryDirectories: string[] = [];

async function writeFixtureFile(filePath: string, contents = 'fixture'): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, contents);
}

async function createCompleteFixture(
  platform: PackagePlatform,
  arch: PackageArch
): Promise<PackageFixture> {
  const rootDir = await mkdtemp(join(tmpdir(), 'lumora-package-layout-'));
  temporaryDirectories.push(rootDir);

  await writeFixtureFile(join(rootDir, 'package.json'), JSON.stringify({ version: '0.1.0' }));
  await writeFixtureFile(join(rootDir, 'resources', 'icons', 'lumora', 'windows', 'Lumora.ico'));
  await writeFixtureFile(join(rootDir, 'resources', 'icons', 'lumora', 'macos', 'Lumora.icns'));
  await writeFixtureFile(join(rootDir, 'resources', 'icons', 'lumora', 'linux', 'lumora.png'));

  const extension = platform === 'win' ? 'exe' : platform === 'mac' ? 'dmg' : 'AppImage';
  const artifactPath = join(
    rootDir,
    'dist',
    `Lumora-0.1.0-${platform}-${arch}.${extension}`
  );
  await writeFixtureFile(artifactPath);

  const unpackedRoot =
    platform === 'win'
      ? join(rootDir, 'dist', 'win-unpacked')
      : platform === 'linux'
        ? join(rootDir, 'dist', 'linux-unpacked')
        : arch === 'x64'
          ? join(rootDir, 'dist', 'mac')
          : join(rootDir, 'dist', 'mac-arm64');
  if (platform === 'mac' && arch === 'x64') {
    await writeFixtureFile(join(rootDir, 'dist', 'mac-x64'));
  }
  const executablePath =
    platform === 'win'
      ? join(unpackedRoot, 'Lumora.exe')
      : platform === 'linux'
        ? join(unpackedRoot, 'lumora')
        : join(unpackedRoot, 'Lumora.app', 'Contents', 'MacOS', 'Lumora');
  const resourcesPath =
    platform === 'mac'
      ? join(unpackedRoot, 'Lumora.app', 'Contents', 'Resources')
      : join(unpackedRoot, 'resources');
  const nodePtyRoot = join(
    resourcesPath,
    'app.asar.unpacked',
    'node_modules',
    'node-pty'
  );
  const nativeBinaryPath =
    platform === 'win'
      ? join(nodePtyRoot, 'prebuilds', `win32-${arch}`, 'pty.node')
      : platform === 'mac'
        ? join(nodePtyRoot, 'prebuilds', `darwin-${arch}`, 'pty.node')
        : join(nodePtyRoot, 'build', 'Release', 'pty.node');
  const helperPath =
    platform === 'win'
      ? join(nodePtyRoot, 'prebuilds', `win32-${arch}`, 'winpty-agent.exe')
      : platform === 'mac'
        ? join(nodePtyRoot, 'prebuilds', `darwin-${arch}`, 'spawn-helper')
        : join(nodePtyRoot, 'build', 'Release', 'spawn-helper');

  await writeFixtureFile(executablePath);
  await writeFixtureFile(join(resourcesPath, 'app.asar'));
  await writeFixtureFile(nativeBinaryPath);
  await writeFixtureFile(helperPath);

  return {
    rootDir,
    artifactPath,
    executablePath,
    nodePtyPath: nodePtyRoot,
    nativeBinaryPath
  };
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))
  );
});

describe('verifyPackage', () => {
  it('accepts a complete Windows x64 layout', async () => {
    const fixture = await createCompleteFixture('win', 'x64');

    expect(verifyPackage({ rootDir: fixture.rootDir, platform: 'win', arch: 'x64' })).toEqual({
      artifactPath: fixture.artifactPath,
      executablePath: fixture.executablePath,
      nodePtyPath: fixture.nodePtyPath
    });
  });

  it('accepts a complete Linux x64 layout', async () => {
    const fixture = await createCompleteFixture('linux', 'x64');

    expect(
      verifyPackage({ rootDir: fixture.rootDir, platform: 'linux', arch: 'x64' })
    ).toEqual({
      artifactPath: fixture.artifactPath,
      executablePath: fixture.executablePath,
      nodePtyPath: fixture.nodePtyPath
    });
  });

  it('accepts a complete macOS x64 layout', async () => {
    const fixture = await createCompleteFixture('mac', 'x64');

    expect(verifyPackage({ rootDir: fixture.rootDir, platform: 'mac', arch: 'x64' })).toEqual({
      artifactPath: fixture.artifactPath,
      executablePath: fixture.executablePath,
      nodePtyPath: fixture.nodePtyPath
    });
  });

  it('accepts a complete macOS arm64 layout', async () => {
    const fixture = await createCompleteFixture('mac', 'arm64');

    expect(verifyPackage({ rootDir: fixture.rootDir, platform: 'mac', arch: 'arm64' })).toEqual({
      artifactPath: fixture.artifactPath,
      executablePath: fixture.executablePath,
      nodePtyPath: fixture.nodePtyPath
    });
  });

  it('rejects a package without its architecture-native pty.node', async () => {
    const fixture = await createCompleteFixture('mac', 'arm64');
    await unlink(fixture.nativeBinaryPath);

    expect(() =>
      verifyPackage({ rootDir: fixture.rootDir, platform: 'mac', arch: 'arm64' })
    ).toThrow(/node-pty native binary is missing or empty/);
  });

  it('accepts an unpacked package without a final artifact when it is optional', async () => {
    const fixture = await createCompleteFixture('linux', 'x64');
    await unlink(fixture.artifactPath!);

    expect(
      verifyPackage({
        rootDir: fixture.rootDir,
        platform: 'linux',
        arch: 'x64',
        requireArtifact: false
      })
    ).toEqual({
      artifactPath: undefined,
      executablePath: fixture.executablePath,
      nodePtyPath: fixture.nodePtyPath
    });
  });
});
