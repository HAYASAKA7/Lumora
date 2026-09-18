const { execFileSync } = require('node:child_process');
const { join, resolve } = require('node:path');

require('./generate-provider-probes.cjs');

// Test the helper as build-helper.cjs builds it: without cgo. With cgo on
// macOS, Go 1.22 resolves names in net through cgo, so a test binary takes the
// SDK version of the local Xcode, and a current SDK makes dyld refuse a
// binary that has no LC_UUID, which Go 1.22 never writes.
execFileSync('go', ['test', './...'], {
  cwd: join(resolve(__dirname, '..', '..'), 'helper'),
  env: { ...process.env, CGO_ENABLED: '0' },
  stdio: 'inherit'
});
