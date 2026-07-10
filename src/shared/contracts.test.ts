import { describe, expect, it } from 'vitest';

import { IPC_CHANNELS, SystemInfoSchema } from './contracts';

describe('SystemInfoSchema', () => {
  it('accepts and preserves a complete supported system payload', () => {
    const payload = {
      platform: 'win32',
      arch: 'x64',
      appVersion: '0.1.0'
    } as const;

    expect(SystemInfoSchema.parse(payload)).toEqual(payload);
  });

  it('rejects an unsupported operating system', () => {
    expect(
      SystemInfoSchema.safeParse({
        platform: 'freebsd',
        arch: 'x64',
        appVersion: '0.1.0'
      }).success
    ).toBe(false);
  });

  it('rejects unexpected fields instead of silently stripping them', () => {
    expect(
      SystemInfoSchema.safeParse({
        platform: 'linux',
        arch: 'arm64',
        appVersion: '0.1.0',
        secret: 'must-not-cross-ipc'
      }).success
    ).toBe(false);
  });
});

describe('IPC_CHANNELS', () => {
  it('names every channel inside the Lumora namespace', () => {
    expect(Object.values(IPC_CHANNELS)).not.toHaveLength(0);

    for (const channel of Object.values(IPC_CHANNELS)) {
      expect(channel).toMatch(/^lumora:/);
    }
  });
});
