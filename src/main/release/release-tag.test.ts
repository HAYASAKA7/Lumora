import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

interface ReleaseTagVerifier {
  assertReleaseTag(tag: string, version: string): void;
  verifyReleaseTag(options: { rootDir: string; tag: string }): {
    tag: string;
    version: string;
  };
}

const require = createRequire(import.meta.url);
const rootDir = fileURLToPath(new URL('../../../', import.meta.url));

function loadVerifier(): ReleaseTagVerifier {
  return require('../../../scripts/release/verify-release-tag.cjs') as ReleaseTagVerifier;
}

describe('release tag validation', () => {
  it('accepts only the exact v-prefixed package version', () => {
    expect(() => loadVerifier()).not.toThrow();
    const { assertReleaseTag, verifyReleaseTag } = loadVerifier();

    expect(() => assertReleaseTag('v0.1.0', '0.1.0')).not.toThrow();
    expect(verifyReleaseTag({ rootDir, tag: 'v0.1.1' })).toEqual({
      tag: 'v0.1.1',
      version: '0.1.1'
    });
  });

  it.each([
    ['', '0.1.0'],
    ['0.1.0', '0.1.0'],
    ['v0.1.1', '0.1.0'],
    ['v0.1.0', '']
  ])('rejects tag %j for version %j', (tag, version) => {
    expect(() => loadVerifier()).not.toThrow();
    const { assertReleaseTag } = loadVerifier();

    expect(() => assertReleaseTag(tag, version)).toThrow(
      `release tag ${JSON.stringify(tag)} does not match expected ${JSON.stringify(
        `v${version}`
      )}`
    );
  });
});
