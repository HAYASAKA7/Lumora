import { describe, expect, it } from 'vitest';

import {
  compareStableApplicationVersions,
  normalizeStableApplicationVersion
} from './application-version';

describe('stable application versions', () => {
  it.each([
    ['v0.3.5', '0.3.5'],
    ['0.03.005', '0.3.5'],
    ['18446744073709551616.0.0', '18446744073709551616.0.0']
  ])('normalizes %s', (input, expected) => {
    expect(normalizeStableApplicationVersion(input)).toBe(expected);
  });

  it.each(['0.3', '0.3.5-beta.1', '0.3.5+build', 'latest', '']) (
    'rejects %s',
    (input) => expect(normalizeStableApplicationVersion(input)).toBeNull()
  );

  it('compares each numeric component without number overflow', () => {
    expect(compareStableApplicationVersions('1.0.0', '0.99.99')).toBe(1);
    expect(compareStableApplicationVersions('1.2.0', '1.1.99')).toBe(1);
    expect(compareStableApplicationVersions('1.2.4', '1.2.5')).toBe(-1);
    expect(compareStableApplicationVersions('v1.2.3', '1.2.3')).toBe(0);
    expect(compareStableApplicationVersions(
      '18446744073709551616.0.0',
      '18446744073709551615.999.999'
    )).toBe(1);
    expect(compareStableApplicationVersions('1.0.0-beta', '1.0.0')).toBeNull();
  });
});
