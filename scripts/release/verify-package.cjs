const { readFileSync, statSync } = require('node:fs');
const { join, resolve } = require('node:path');
const { verifyHelperBundle } = require('../helper/verify-helper.cjs');

const BUNDLED_LOCALES = ['en', 'zh-Hans', 'zh-Hant', 'ja', 'ko'];
const LOCALE_NAMESPACES = [
  'common', 'shell', 'catalog', 'terminal', 'settings',
  'providers', 'remote', 'transfer', 'errors'
];

const TARGETS = {
  'win-x64': {
    artifactExtension: 'exe',
    iconPath: ['resources', 'icons', 'lumora', 'windows', 'Lumora.ico'],
    unpackedDirectories: ['win-unpacked'],
    executablePath: ['Lumora.exe'],
    resourcesPath: ['resources'],
    nativePath: ['prebuilds', 'win32-x64', 'pty.node'],
    helperPath: ['prebuilds', 'win32-x64', 'winpty-agent.exe']
  },
  'linux-x64': {
    artifactExtension: 'AppImage',
    artifactArch: 'x86_64',
    iconPath: ['resources', 'icons', 'lumora', 'linux', 'lumora.png'],
    unpackedDirectories: ['linux-unpacked'],
    executablePath: ['lumora'],
    resourcesPath: ['resources'],
    nativePath: ['build', 'Release', 'pty.node']
  },
  'mac-x64': {
    artifactExtension: 'dmg',
    iconPath: ['resources', 'icons', 'lumora', 'macos', 'Lumora.icns'],
    unpackedDirectories: ['mac-x64', 'mac'],
    executablePath: ['Lumora.app', 'Contents', 'MacOS', 'Lumora'],
    resourcesPath: ['Lumora.app', 'Contents', 'Resources'],
    nativePath: ['prebuilds', 'darwin-x64', 'pty.node'],
    helperPath: ['prebuilds', 'darwin-x64', 'spawn-helper']
  },
  'mac-arm64': {
    artifactExtension: 'dmg',
    iconPath: ['resources', 'icons', 'lumora', 'macos', 'Lumora.icns'],
    unpackedDirectories: ['mac-arm64', 'mac'],
    executablePath: ['Lumora.app', 'Contents', 'MacOS', 'Lumora'],
    resourcesPath: ['Lumora.app', 'Contents', 'Resources'],
    nativePath: ['prebuilds', 'darwin-arm64', 'pty.node'],
    helperPath: ['prebuilds', 'darwin-arm64', 'spawn-helper']
  }
};

function missingOrEmpty(label, filePath) {
  return new Error(`${label} is missing or empty: ${filePath}`);
}

function getStats(label, filePath) {
  try {
    return statSync(filePath);
  } catch {
    throw missingOrEmpty(label, filePath);
  }
}

function requireNonEmptyFile(label, filePath) {
  const stats = getStats(label, filePath);
  if (!stats.isFile() || stats.size === 0) {
    throw missingOrEmpty(label, filePath);
  }
}

function requireDirectory(label, directoryPath) {
  if (!getStats(label, directoryPath).isDirectory()) {
    throw missingOrEmpty(label, directoryPath);
  }
}

function pathIsDirectory(filePath) {
  try {
    return statSync(filePath).isDirectory();
  } catch {
    return false;
  }
}

function verifyBundledLocales(resourcesPath) {
  const localeRoot = join(resourcesPath, 'locales');
  requireDirectory('bundled locale catalog', localeRoot);
  for (const locale of BUNDLED_LOCALES) {
    const localePath = join(localeRoot, locale);
    requireDirectory(`bundled locale ${locale}`, localePath);
    requireNonEmptyFile(
      `bundled locale ${locale} manifest`,
      join(localePath, 'manifest.json')
    );
    for (const namespace of LOCALE_NAMESPACES) {
      requireNonEmptyFile(
        `bundled locale ${locale} namespace ${namespace}`,
        join(localePath, `${namespace}.json`)
      );
    }
  }
}

function readPackageVersion(rootDir) {
  const packagePath = join(rootDir, 'package.json');
  requireNonEmptyFile('package.json', packagePath);

  let packageJson;
  try {
    packageJson = JSON.parse(readFileSync(packagePath, 'utf8'));
  } catch (error) {
    throw new Error(`package.json is invalid: ${packagePath}: ${error.message}`);
  }

  if (typeof packageJson.version !== 'string' || packageJson.version.length === 0) {
    throw missingOrEmpty('package version', packagePath);
  }

  return packageJson.version;
}

function selectUnpackedRoot(outputDir, unpackedDirectories) {
  for (const directory of unpackedDirectories) {
    const candidate = join(outputDir, directory);
    if (pathIsDirectory(candidate)) {
      return candidate;
    }
  }

  return join(outputDir, unpackedDirectories[0]);
}

function verifyPackage({
  rootDir = process.cwd(),
  outputDir = join(rootDir, 'dist'),
  platform,
  arch,
  requireArtifact = true
}) {
  const targetName = `${platform}-${arch}`;
  const target = TARGETS[targetName];
  if (!target) {
    throw new Error(`unsupported package target: ${targetName}`);
  }

  const version = readPackageVersion(rootDir);
  requireNonEmptyFile(`${platform} repository icon`, join(rootDir, ...target.iconPath));

  let artifactPath;
  if (requireArtifact) {
    const artifactArch = target.artifactArch || arch;
    artifactPath = join(
      outputDir,
      `Lumora-${version}-${platform}-${artifactArch}.${target.artifactExtension}`
    );
    requireNonEmptyFile('package artifact', artifactPath);
  }

  const unpackedRoot = selectUnpackedRoot(outputDir, target.unpackedDirectories);
  requireDirectory('unpacked package', unpackedRoot);

  const executablePath = join(unpackedRoot, ...target.executablePath);
  requireNonEmptyFile('application executable', executablePath);

  const resourcesPath = join(unpackedRoot, ...target.resourcesPath);
  requireDirectory('application resources', resourcesPath);
  requireNonEmptyFile('app.asar', join(resourcesPath, 'app.asar'));
  verifyBundledLocales(resourcesPath);

  const helperRoot = join(resourcesPath, 'helper');
  requireDirectory('Lumora helper bundle', helperRoot);
  verifyHelperBundle(helperRoot);

  const nodePtyRoot = join(
    resourcesPath,
    'app.asar.unpacked',
    'node_modules',
    'node-pty'
  );
  requireDirectory('unpacked node-pty module', nodePtyRoot);

  const nativeBinaryPath = join(nodePtyRoot, ...target.nativePath);
  requireNonEmptyFile('node-pty native binary', nativeBinaryPath);
  if (target.helperPath) {
    requireNonEmptyFile('node-pty helper', join(nodePtyRoot, ...target.helperPath));
  }

  return { artifactPath, executablePath, nodePtyPath: nodePtyRoot, helperPath: helperRoot };
}

function parseArguments(argumentsList) {
  const options = { requireArtifact: true };

  for (let index = 0; index < argumentsList.length; index += 1) {
    const argument = argumentsList[index];

    if (argument === '--no-artifact') {
      options.requireArtifact = false;
      continue;
    }

    if (argument !== '--platform' && argument !== '--arch' && argument !== '--output') {
      throw new Error(`unknown argument: ${argument}`);
    }

    const value = argumentsList[index + 1];
    if (value === undefined || value.startsWith('--')) {
      throw new Error(`missing value for ${argument}`);
    }
    index += 1;

    if (argument === '--platform') {
      options.platform = value;
    } else if (argument === '--arch') {
      options.arch = value;
    } else {
      options.outputDir = resolve(value);
    }
  }

  if (!options.platform || !options.arch) {
    throw new Error(
      'usage: node scripts/release/verify-package.cjs --platform <win|mac|linux> --arch <x64|arm64> [--output <path>] [--no-artifact]'
    );
  }

  return options;
}

function runCli() {
  try {
    const result = verifyPackage(parseArguments(process.argv.slice(2)));
    console.log(`Verified executable: ${result.executablePath}`);
    if (result.artifactPath) {
      console.log(`Verified artifact: ${result.artifactPath}`);
    }
  } catch (error) {
    console.error(`Package verification failed: ${error.message}`);
    process.exitCode = 1;
  }
}

if (require.main === module) {
  runCli();
}

module.exports = { verifyPackage };
