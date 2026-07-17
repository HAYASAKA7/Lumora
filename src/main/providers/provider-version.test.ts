import { describe, expect, it } from 'vitest';

import {
  compareSemanticVersions,
  extractSemanticVersion
} from './provider-version';

function version(value: string) {
  const parsed = extractSemanticVersion(value);
  if (parsed === null) throw new Error(`Could not parse ${value}`);
  return parsed;
}

describe('extractSemanticVersion', () => {
  it.each([
    ['codex-cli 1.2.3', '1.2.3'],
    ['2.3.4 (Claude Code)', '2.3.4'],
    ['claude v3.4.5', '3.4.5'],
    ['tool 1.2.3-beta.2+build.7', '1.2.3-beta.2']
  ])('extracts %s as %s', (output, expected) => {
    expect(extractSemanticVersion(output)?.raw).toBe(expected);
  });

  it.each([
    '',
    'Claude Code latest',
    '1.2',
    '1.2.3.4',
    'version 9007199254740992.1.1',
    'version 1.2.3-01'
  ])('rejects malformed or unsafe output %j', (output) => {
    expect(extractSemanticVersion(output)).toBeNull();
  });
});

describe('compareSemanticVersions', () => {
  it.each([
    ['1.2.3', '1.2.3', 0],
    ['1.2.4', '1.2.3', 1],
    ['2.0.0', '10.0.0', -1],
    ['1.0.0', '1.0.0-rc.1', 1],
    ['1.0.0-beta.2', '1.0.0-beta.11', -1],
    ['1.0.0-alpha', '1.0.0-beta', -1],
    ['1.0.0-alpha.1', '1.0.0-alpha', 1],
    ['1.0.0+local', '1.0.0+remote', 0]
  ])('orders %s against %s', (left, right, expected) => {
    expect(compareSemanticVersions(version(left), version(right))).toBe(expected);
  });
});
