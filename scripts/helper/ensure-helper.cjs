const { execFileSync } = require('node:child_process');
const { readFileSync } = require('node:fs');
const { join, resolve } = require('node:path');

const { verifyHelperBundle } = require('./verify-helper.cjs');

function ensureHelperBundle({ expectedVersion, verify, build }) {
  let current = null;
  try {
    current = verify();
  } catch {
    // A missing or invalid generated bundle is rebuilt below.
  }
  if (current?.helperVersion === expectedVersion) return 'ready';

  build();
  const rebuilt = verify();
  if (rebuilt.helperVersion !== expectedVersion) {
    throw new Error(
      `Invalid Lumora helper bundle: expected version ${expectedVersion}`
    );
  }
  return 'built';
}

function run() {
  const root = resolve(__dirname, '..', '..');
  const bundleRoot = join(root, 'resources', 'helper', 'generated');
  const version = JSON.parse(
    readFileSync(join(root, 'helper', 'version.json'), 'utf8')
  );
  const result = ensureHelperBundle({
    expectedVersion: version.helperVersion,
    verify: () => verifyHelperBundle(bundleRoot),
    build: () => execFileSync(
      process.execPath,
      [join(__dirname, 'build-helper.cjs')],
      { stdio: 'inherit' }
    )
  });
  if (result === 'ready') {
    console.log(
      `Reusing verified Lumora helper bundle (${version.helperVersion}).`
    );
  }
}

if (require.main === module) {
  try {
    run();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}

module.exports = { ensureHelperBundle };
