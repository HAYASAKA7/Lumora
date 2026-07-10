import { describe, expect, it } from 'vitest';

import { IPC_CHANNELS } from '../shared/contracts';
import { createLumoraApi } from './api';

describe('createLumoraApi', () => {
  it('invokes only the system-info channel and validates the response', async () => {
    const invokedChannels: string[] = [];
    const api = createLumoraApi(async (channel) => {
      invokedChannels.push(channel);
      return { platform: 'linux', arch: 'arm64', appVersion: '0.1.0' };
    });

    await expect(api.getSystemInfo()).resolves.toEqual({
      platform: 'linux',
      arch: 'arm64',
      appVersion: '0.1.0'
    });
    expect(invokedChannels).toEqual([IPC_CHANNELS.systemInfo]);
    expect(Object.isFrozen(api)).toBe(true);
  });

  it('rejects an invalid value returned across IPC', async () => {
    const api = createLumoraApi(async () => ({
      platform: 'freebsd',
      arch: 'x64',
      appVersion: '0.1.0'
    }));

    await expect(api.getSystemInfo()).rejects.toBeDefined();
  });
});
