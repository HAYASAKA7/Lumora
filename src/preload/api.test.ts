import { describe, expect, it } from 'vitest';

import { IPC_CHANNELS } from '../shared/contracts';
import { createLumoraApi } from './api';

const emptyCatalog = {
  refreshedAt: '2026-07-11T03:01:00.000Z',
  workspaces: [],
  sessions: [],
  providerStatus: [
    {
      provider: 'codex',
      state: 'ready',
      discoveredCount: 0,
      unchangedCount: 0,
      invalidCount: 0
    },
    {
      provider: 'claude',
      state: 'ready',
      discoveredCount: 0,
      unchangedCount: 0,
      invalidCount: 0
    }
  ],
  diagnostics: []
} as const;

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

  it('invokes narrowed catalog channels with validated queries', async () => {
    const invocations: { channel: string; args: readonly unknown[] }[] = [];
    const api = createLumoraApi(async (channel, ...args) => {
      invocations.push({ channel, args });
      return emptyCatalog;
    });

    await expect(
      api.getCatalog({ text: '  catalog  ', provider: 'codex' })
    ).resolves.toEqual(emptyCatalog);
    await expect(
      api.refreshCatalog({ text: '', provider: null })
    ).resolves.toEqual(emptyCatalog);

    expect(invocations).toEqual([
      {
        channel: IPC_CHANNELS.catalogGet,
        args: [{ text: 'catalog', provider: 'codex' }]
      },
      {
        channel: IPC_CHANNELS.catalogRefresh,
        args: [{ text: '', provider: null }]
      }
    ]);
  });

  it('validates workspace selection results and preserves cancellation', async () => {
    const cancelled = createLumoraApi(async () => null);
    await expect(cancelled.chooseWorkspace()).resolves.toBeNull();

    const selected = createLumoraApi(async (channel) => {
      expect(channel).toBe(IPC_CHANNELS.workspaceChoose);
      return emptyCatalog;
    });
    await expect(selected.chooseWorkspace()).resolves.toEqual(emptyCatalog);
  });

  it('rejects malformed catalog queries and responses before returning them', async () => {
    const api = createLumoraApi(async () => ({
      ...emptyCatalog,
      sessions: [{ transcript: ['must not cross IPC'] }]
    }));

    await expect(
      api.getCatalog({ text: 'x'.repeat(121), provider: null })
    ).rejects.toBeDefined();
    await expect(api.refreshCatalog()).rejects.toBeDefined();
  });
});
