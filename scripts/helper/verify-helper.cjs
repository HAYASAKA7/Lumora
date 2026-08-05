const { createHash } = require('node:crypto');
const { readFileSync, statSync } = require('node:fs');
const { join, resolve, sep } = require('node:path');

const EXPECTED_TARGETS = new Set([
  'darwin-arm64',
  'darwin-x64',
  'linux-arm64',
  'linux-x64',
  'win32-arm64',
  'win32-x64'
]);

function fail(message) {
  throw new Error(`Invalid Lumora helper bundle: ${message}`);
}

function safeArtifactPath(bundleRoot, relativePath) {
  if (
    typeof relativePath !== 'string' ||
    relativePath.length === 0 ||
    relativePath.length > 240 ||
    relativePath.includes('..') ||
    relativePath.includes('\\') ||
    relativePath.startsWith('/') ||
    !/^[A-Za-z0-9._/-]+$/u.test(relativePath)
  ) {
    fail('artifact path is unsafe');
  }
  const root = resolve(bundleRoot);
  const artifact = resolve(root, ...relativePath.split('/'));
  if (!artifact.startsWith(`${root}${sep}`)) fail('artifact escapes its bundle');
  return artifact;
}

function assertExecutableMagic(platform, contents) {
  if (platform === 'win32' && !(contents[0] === 0x4d && contents[1] === 0x5a)) {
    fail('Windows artifact does not contain a PE header');
  }
  if (platform === 'linux' && !contents.subarray(0, 4).equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46]))) {
    fail('Linux artifact does not contain an ELF header');
  }
  const macMagic = contents.subarray(0, 4).toString('hex');
  if (platform === 'darwin' && !['cffaedfe', 'feedfacf', 'cafebabe', 'bebafeca'].includes(macMagic)) {
    fail('macOS artifact does not contain a Mach-O header');
  }
}

function verifyHelperBundle(bundleRoot) {
  const manifestPath = join(bundleRoot, 'manifest.json');
  const manifestBytes = readFileSync(manifestPath);
  if (manifestBytes.length === 0 || manifestBytes.length > 64 * 1024) {
    fail('manifest size is invalid');
  }
  let manifest;
  try {
    manifest = JSON.parse(manifestBytes.toString('utf8'));
  } catch {
    fail('manifest is not valid JSON');
  }
  if (
    manifest.formatVersion !== 1 ||
    manifest.protocolVersion !== 1 ||
    typeof manifest.helperVersion !== 'string' ||
    manifest.helperVersion.length === 0 ||
    manifest.helperVersion.length > 40 ||
    !Array.isArray(manifest.artifacts) ||
    manifest.artifacts.length !== EXPECTED_TARGETS.size
  ) {
    fail('manifest header is invalid');
  }

  const seen = new Set();
  for (const artifact of manifest.artifacts) {
    const target = `${artifact.platform}-${artifact.architecture}`;
    if (!EXPECTED_TARGETS.has(target) || seen.has(target)) fail(`unexpected target ${target}`);
    seen.add(target);
    if (!Number.isSafeInteger(artifact.size) || artifact.size <= 0 || artifact.size > 128 * 1024 * 1024) {
      fail(`${target} size is invalid`);
    }
    if (typeof artifact.sha256 !== 'string' || !/^[a-f0-9]{64}$/u.test(artifact.sha256)) {
      fail(`${target} digest is invalid`);
    }
    if (!Array.isArray(artifact.capabilities) || !artifact.capabilities.includes('system-info')) {
      fail(`${target} capabilities are invalid`);
    }
    const artifactPath = safeArtifactPath(bundleRoot, artifact.relativePath);
    const stats = statSync(artifactPath);
    if (!stats.isFile() || stats.size !== artifact.size) fail(`${target} file size does not match`);
    const contents = readFileSync(artifactPath);
    assertExecutableMagic(artifact.platform, contents);
    const digest = createHash('sha256').update(contents).digest('hex');
    if (digest !== artifact.sha256) fail(`${target} digest does not match`);
  }
  if (seen.size !== EXPECTED_TARGETS.size) fail('one or more targets are missing');
  return manifest;
}

if (require.main === module) {
  const bundleRoot = process.argv[2];
  if (!bundleRoot) {
    console.error('usage: node scripts/helper/verify-helper.cjs <bundle-directory>');
    process.exitCode = 1;
  } else {
    try {
      const manifest = verifyHelperBundle(resolve(bundleRoot));
      console.log(`Verified ${manifest.artifacts.length} Lumora helper artifacts (${manifest.helperVersion}).`);
    } catch (error) {
      console.error(error.message);
      process.exitCode = 1;
    }
  }
}

module.exports = { verifyHelperBundle };
