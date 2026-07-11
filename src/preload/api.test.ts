import { describe, expect, it } from 'vitest';

import { IPC_CHANNELS } from '../shared/contracts';
import { createLumoraApi } from './api';

describe('createLumoraApi', () => {
  it('invokes only the system-info channel for system details', async () => {
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

  it('invokes only the provider-scan channel and validates the response', async () => {
    const invokedChannels: string[] = [];
    const scan = {
      scannedAt: '2026-07-11T01:02:03.000Z',
      providers: [
        {
          provider: 'codex',
          displayName: 'Codex',
          state: 'ready',
          executablePath: '/tools/codex',
          version: 'codex-cli 1.2.3',
          issue: null
        },
        {
          provider: 'claude',
          displayName: 'Claude Code',
          state: 'not_found',
          executablePath: null,
          version: null,
          issue: {
            code: 'PROVIDER_NOT_FOUND',
            message: 'Claude Code was not found on PATH.',
            recovery: 'Install Claude Code or add it to PATH, then refresh.',
            retryable: true
          }
        }
      ]
    } as const;
    const api = createLumoraApi(async (channel) => {
      invokedChannels.push(channel);
      return scan;
    });

    await expect(api.scanProviders()).resolves.toEqual(scan);
    expect(invokedChannels).toEqual([IPC_CHANNELS.providerScan]);
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

  it('rejects malformed provider data returned across IPC', async () => {
    const api = createLumoraApi(async () => ({
      scannedAt: 'not-a-date',
      providers: [{ provider: 'gemini', environment: process.env }]
    }));

    await expect(api.scanProviders()).rejects.toBeDefined();
  });
});
