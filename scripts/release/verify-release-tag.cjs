const { readFileSync } = require('node:fs');
const { join } = require('node:path');

function assertReleaseTag(tag, version) {
  const expectedTag = `v${version}`;

  if (!tag || !version || tag !== expectedTag) {
    throw new Error(
      `release tag ${JSON.stringify(tag)} does not match expected ${JSON.stringify(
        expectedTag
      )}`
    );
  }
}

function verifyReleaseTag({
  rootDir = process.cwd(),
  tag = process.env.GITHUB_REF_NAME || ''
} = {}) {
  const packagePath = join(rootDir, 'package.json');
  const packageJson = JSON.parse(readFileSync(packagePath, 'utf8'));
  const version = typeof packageJson.version === 'string' ? packageJson.version : '';

  assertReleaseTag(tag, version);
  return { tag, version };
}

function runCli() {
  try {
    const result = verifyReleaseTag();
    console.log(`Verified Lumora release tag ${result.tag} for version ${result.version}.`);
  } catch (error) {
    console.error(`Release tag verification failed: ${error.message}`);
    process.exitCode = 1;
  }
}

if (require.main === module) {
  runCli();
}

module.exports = { assertReleaseTag, verifyReleaseTag };
