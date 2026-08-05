const { createHash } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { mkdirSync, readFileSync, rmSync, statSync, writeFileSync } = require('node:fs');
const { join, relative, resolve, sep } = require('node:path');
const { verifyHelperBundle } = require('./verify-helper.cjs');

const root = resolve(__dirname, '..', '..');
const helperRoot = join(root, 'helper');
const outputRoot = join(root, 'resources', 'helper', 'generated');
const version = JSON.parse(readFileSync(join(helperRoot, 'version.json'), 'utf8'));
const targets = [
  { platform: 'darwin', architecture: 'arm64', goos: 'darwin', goarch: 'arm64', directory: 'macos-arm64', executable: 'lumora-helper' },
  { platform: 'darwin', architecture: 'x64', goos: 'darwin', goarch: 'amd64', directory: 'macos-x64', executable: 'lumora-helper' },
  { platform: 'linux', architecture: 'arm64', goos: 'linux', goarch: 'arm64', directory: 'linux-arm64', executable: 'lumora-helper' },
  { platform: 'linux', architecture: 'x64', goos: 'linux', goarch: 'amd64', directory: 'linux-x64', executable: 'lumora-helper' },
  { platform: 'win32', architecture: 'arm64', goos: 'windows', goarch: 'arm64', directory: 'windows-arm64', executable: 'lumora-helper.exe' },
  { platform: 'win32', architecture: 'x64', goos: 'windows', goarch: 'amd64', directory: 'windows-x64', executable: 'lumora-helper.exe' }
];

function assertWithinRoot(candidate) {
  const suffix = relative(outputRoot, candidate);
  if (suffix.startsWith(`..${sep}`) || suffix === '..' || resolve(candidate) === resolve(outputRoot)) {
    throw new Error(`Unsafe helper output path: ${candidate}`);
  }
}

function digest(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}

rmSync(outputRoot, { recursive: true, force: true });
mkdirSync(outputRoot, { recursive: true });

const artifacts = targets.map((target) => {
  const targetDirectory = join(outputRoot, 'artifacts', target.directory);
  assertWithinRoot(targetDirectory);
  mkdirSync(targetDirectory, { recursive: true });
  const output = join(targetDirectory, target.executable);
  execFileSync('go', [
    'build',
    '-buildvcs=false',
    '-trimpath',
    '-ldflags',
    `-s -w -buildid= -X main.helperVersion=${version.helperVersion}`,
    '-o', output,
    './cmd/lumora-helper'
  ], {
    cwd: helperRoot,
    env: {
      ...process.env,
      CGO_ENABLED: '0',
      GOOS: target.goos,
      GOARCH: target.goarch
    },
    stdio: 'inherit'
  });
  const stats = statSync(output);
  return {
    platform: target.platform,
    architecture: target.architecture,
    relativePath: `artifacts/${target.directory}/${target.executable}`,
    size: stats.size,
    sha256: digest(output),
    capabilities: ['system-info']
  };
});

const manifest = {
  formatVersion: 1,
  helperVersion: version.helperVersion,
  protocolVersion: version.protocolVersion,
  artifacts
};
writeFileSync(join(outputRoot, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
verifyHelperBundle(outputRoot);
console.log(`Built and verified ${artifacts.length} Lumora helper artifacts (${version.helperVersion}).`);
