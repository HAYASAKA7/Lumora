import { describe, expect, it, vi } from 'vitest';

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

  it('validates terminal requests and subscribes through the event-only bridge', async () => {
    const runtimeId = '0198f8b6-18f3-7ca0-9f0f-123456789abc';
    const profile = {
      id: 'a'.repeat(64),
      kind: 'detected',
      name: 'Bash',
      shellFamily: 'bash',
      executablePath: '/bin/bash',
      args: [],
      available: true,
      recommended: true
    } as const;
    const invocations: { channel: string; args: readonly unknown[] }[] = [];
    let eventReceiver: ((value: unknown) => void) | null = null;
    const unsubscribe = vi.fn();
    const api = createLumoraApi(
      async (channel, ...args) => {
        invocations.push({ channel, args });
        if (channel === IPC_CHANNELS.terminalProfilesGet) return [profile];
        if (channel === IPC_CHANNELS.runtimeWrite) return { accepted: true };
        throw new Error(`Unexpected channel ${channel}`);
      },
      (channel, receiver) => {
        expect(channel).toBe(IPC_CHANNELS.runtimeEvent);
        eventReceiver = receiver;
        return unsubscribe;
      }
    );

    await expect(api.getTerminalProfiles()).resolves.toEqual([profile]);
    await expect(api.writeRuntime({ runtimeId, data: 'hello' })).resolves.toBeUndefined();
    expect(invocations).toEqual([
      { channel: IPC_CHANNELS.terminalProfilesGet, args: [] },
      {
        channel: IPC_CHANNELS.runtimeWrite,
        args: [{ runtimeId, data: 'hello' }]
      }
    ]);

    const listener = vi.fn();
    const remove = api.onRuntimeEvent(listener);
    eventReceiver!({ type: 'output', runtimeId, data: 'ready' });
    expect(listener).toHaveBeenCalledWith({
      type: 'output', runtimeId, data: 'ready'
    });
    remove();
    expect(unsubscribe).toHaveBeenCalledOnce();
  });

  it('uses narrow channels for provider launch configuration', async () => {
    const invocations: { channel: string; args: readonly unknown[] }[] = [];
    const channels = IPC_CHANNELS as typeof IPC_CHANNELS & {
      providerLaunchConfigsGet: string;
      providerLaunchConfigSave: string;
    };
    const configs = [
      { provider: 'codex' as const, command: 'codexp' },
      { provider: 'claude' as const, command: null }
    ];
    const api = createLumoraApi(async (channel, ...args) => {
      invocations.push({ channel, args });
      return configs;
    }) as ReturnType<typeof createLumoraApi> & {
      getProviderLaunchConfigs(): Promise<typeof configs>;
      saveProviderLaunchConfig(input: {
        provider: 'codex' | 'claude';
        command: string | null;
      }): Promise<typeof configs>;
    };

    await expect(api.getProviderLaunchConfigs()).resolves.toEqual(configs);
    await expect(
      api.saveProviderLaunchConfig({ provider: 'codex', command: 'codexp' })
    ).resolves.toEqual(configs);
    expect(invocations).toEqual([
      { channel: channels.providerLaunchConfigsGet, args: [] },
      {
        channel: channels.providerLaunchConfigSave,
        args: [{ provider: 'codex', command: 'codexp' }]
      }
    ]);
  });

  it('uses validated narrow channels for layered launch settings', async () => {
    const invocations: { channel: string; args: readonly unknown[] }[] = [];
    const layer = {
      scope: 'workspace' as const,
      targetId: 'a'.repeat(64),
      settings: { terminalProfileId: null },
      updatedAt: '2026-07-13T00:00:00.000Z'
    };
    const input = {
      scope: 'workspace' as const,
      targetId: layer.targetId,
      settings: { terminalProfileId: null }
    };
    const api = createLumoraApi(async (channel, ...args) => {
      invocations.push({ channel, args });
      return [layer];
    });

    await expect(api.getLaunchSettingsLayers()).resolves.toEqual([layer]);
    await expect(api.saveLaunchSettingsLayer(input)).resolves.toEqual([layer]);
    expect(invocations).toEqual([
      { channel: IPC_CHANNELS.launchSettingsLayersGet, args: [] },
      { channel: IPC_CHANNELS.launchSettingsLayerSave, args: [input] }
    ]);
  });

  it('rejects oversized terminal data before invoking IPC', async () => {
    const invoke = vi.fn();
    const api = createLumoraApi(invoke);
    await expect(
      api.writeRuntime({
        runtimeId: '0198f8b6-18f3-7ca0-9f0f-123456789abc',
        data: 'x'.repeat(65_537)
      })
    ).rejects.toBeDefined();
    expect(invoke).not.toHaveBeenCalled();
  });
});
