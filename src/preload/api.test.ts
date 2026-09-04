import { describe, expect, it, vi } from 'vitest';

import {
  DEFAULT_GENERAL_SETTINGS,
  DEFAULT_KEYBOARD_SETTINGS,
  IPC_CHANNELS
} from '../shared/contracts';
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
  providerFacets: [],
  diagnostics: []
} as const;

describe('createLumoraApi', () => {
  it('exposes validated localization operations and change events', async () => {
    const snapshot = {
      revision: 1,
      preference: 'system',
      locale: 'en',
      formattingLocale: 'en-US',
      direction: 'ltr',
      availableLocales: [{
        locale: 'en',
        displayName: 'English',
        direction: 'ltr',
        sources: ['bundled'],
        catalogVersion: 1
      }],
      messages: { 'common.actions.cancel': 'Cancel' },
      warnings: []
    } as const;
    const invoke = vi.fn(async (channel: string) => {
      if (channel === IPC_CHANNELS.localizationSnapshotGet) return snapshot;
      if (channel === IPC_CHANNELS.localizationReload) return {
        snapshot,
        loadedUserPacks: 0,
        rejectedUserPacks: 0
      };
      return { opened: true };
    });
    let receiver: ((value: unknown) => void) | null = null;
    const unsubscribe = vi.fn();
    const api = createLumoraApi(invoke, (channel, listener) => {
      expect(channel).toBe(IPC_CHANNELS.localizationChanged);
      receiver = listener;
      return unsubscribe;
    });

    await expect(api.getLocalizationSnapshot()).resolves.toEqual(snapshot);
    await expect(api.reloadLocalization()).resolves.toMatchObject({ snapshot });
    await expect(api.openUserLocaleFolder()).resolves.toBeUndefined();
    const listener = vi.fn();
    expect(api.onLocalizationChanged(listener)).toBe(unsubscribe);
    const deliver = receiver as unknown as (value: unknown) => void;
    deliver(snapshot);
    expect(listener).toHaveBeenCalledWith(snapshot);
    expect(invoke.mock.calls.slice(0, 3)).toEqual([
      [IPC_CHANNELS.localizationSnapshotGet],
      [IPC_CHANNELS.localizationReload],
      [IPC_CHANNELS.localizationUserFolderOpen]
    ]);
    expect(() => deliver({ ...snapshot, revision: -1 })).toThrow();
  });

  it('exposes validated Mods directory operations', async () => {
    const settings = {
      rootPath: 'D:\\Lumora Mods',
      localesPath: 'D:\\Lumora Mods\\locales',
      fontsPath: 'D:\\Lumora Mods\\fonts',
      themesPath: 'D:\\Lumora Mods\\themes',
      usesDefault: false
    };
    const fontPresets = {
      presets: [{
        id: 'my-font',
        displayName: 'My font',
        interfaceFontFamily: 'Inter',
        terminalFontFamily: null
      }],
      rejectedCount: 0
    };
    const themePresets = {
      presets: [],
      rejectedCount: 1
    };
    const invoke = vi.fn(async (channel: string) => {
      if (channel === IPC_CHANNELS.modsRootChoose) {
        return { canceled: false, settings };
      }
      if (channel === IPC_CHANNELS.modsRootOpen) return { opened: true };
      if (channel === IPC_CHANNELS.fontPresetsGet) return fontPresets;
      if (channel === IPC_CHANNELS.fontPresetFolderOpen) return { opened: true };
      if (channel === IPC_CHANNELS.themePresetsGet) return themePresets;
      if (channel === IPC_CHANNELS.themePresetFolderOpen) return { opened: true };
      return settings;
    });
    const api = createLumoraApi(invoke);

    await expect(api.getModsSettings()).resolves.toEqual(settings);
    await expect(api.chooseModsRoot()).resolves.toEqual({
      canceled: false,
      settings
    });
    await expect(api.resetModsRoot()).resolves.toEqual(settings);
    await expect(api.openModsRoot()).resolves.toBeUndefined();
    await expect(api.getFontPresets()).resolves.toEqual(fontPresets);
    await expect(api.openFontPresetFolder()).resolves.toBeUndefined();
    await expect(api.getThemePresets()).resolves.toEqual(themePresets);
    await expect(api.openThemePresetFolder()).resolves.toBeUndefined();
    expect(invoke.mock.calls).toEqual([
      [IPC_CHANNELS.modsSettingsGet],
      [IPC_CHANNELS.modsRootChoose],
      [IPC_CHANNELS.modsRootReset],
      [IPC_CHANNELS.modsRootOpen],
      [IPC_CHANNELS.fontPresetsGet],
      [IPC_CHANNELS.fontPresetFolderOpen],
      [IPC_CHANNELS.themePresetsGet],
      [IPC_CHANNELS.themePresetFolderOpen]
    ]);
  });

  it('uses narrow About channels and validates their results', async () => {
    const invoke = vi.fn(async (channel: string) => {
      if (channel === IPC_CHANNELS.applicationAboutGet) return {
        productName: 'Lumora', developer: 'HAYASAKA7',
        system: { platform: 'win32', arch: 'x64', appVersion: '0.3.5' }
      };
      if (channel === IPC_CHANNELS.applicationReleaseStatusGet) return {
        state: 'current', installedVersion: '0.3.5', latestVersion: '0.3.5'
      };
      return { opened: true };
    });
    const api = createLumoraApi(invoke);

    await expect(api.getApplicationAboutInfo()).resolves.toMatchObject({ productName: 'Lumora' });
    await expect(api.getApplicationReleaseStatus()).resolves.toMatchObject({ state: 'current' });
    await api.openLumoraProjectPage();
    await api.openApplicationReleasePage();
    expect(invoke.mock.calls.slice(-4)).toEqual([
      [IPC_CHANNELS.applicationAboutGet],
      [IPC_CHANNELS.applicationReleaseStatusGet],
      [IPC_CHANNELS.applicationProjectOpen],
      [IPC_CHANNELS.applicationReleaseOpen]
    ]);
  });
  it('validates application quit requests and resolutions', async () => {
    let requestReceiver: ((value: unknown) => void) | null = null;
    const listener = vi.fn();
    const invoke = vi.fn().mockResolvedValue({ accepted: true });
    const api = createLumoraApi(invoke, (channel, receiver) => {
      expect(channel).toBe(IPC_CHANNELS.applicationQuitRequest);
      requestReceiver = receiver;
      return vi.fn();
    });

    api.onApplicationQuitRequest(listener);
    const deliverRequest = requestReceiver as unknown as (value: unknown) => void;
    deliverRequest({
      localActiveAgentCount: 1,
      remoteActiveAgentCount: 2,
      totalActiveAgentCount: 3
    });
    expect(listener).toHaveBeenCalledWith({
      localActiveAgentCount: 1,
      remoteActiveAgentCount: 2,
      totalActiveAgentCount: 3
    });
    await expect(api.resolveApplicationQuit({
      action: 'exit',
      suppressFutureWarning: true
    })).resolves.toBe(true);
    expect(invoke).toHaveBeenCalledWith(IPC_CHANNELS.applicationQuitResolve, {
      action: 'exit',
      suppressFutureWarning: true
    });
    expect(() => deliverRequest({
      localActiveAgentCount: 1,
      remoteActiveAgentCount: 2,
      totalActiveAgentCount: 2
    })).toThrow();
  });

  it('exposes validated diagnostic summary, export, and storage operations', async () => {
    const invocations: string[] = [];
    const summary = {
      generatedAt: '2026-08-13T08:00:00.000Z',
      previousRunAbnormal: false,
      journal: { storedEvents: 2, invalidRecords: 0 },
      agents: { activeCount: 1 },
      processes: { processCount: 3, workingSetBytes: 1024, cpuPercent: 1.5 },
      recentEvents: []
    } as const;
    const storage = {
      selectedJournalDirectory: null,
      effectiveJournalDirectory: 'C:\\Lumora\\diagnostics',
      selectedExportDirectory: null,
      effectiveExportDirectory: 'C:\\Documents',
      journalUsesDefault: true,
      exportUsesDefault: true,
      restartRequired: false,
      fallbackActive: false
    } as const;
    const api = createLumoraApi(async (channel) => {
      invocations.push(channel);
      if (channel === IPC_CHANNELS.diagnosticSummaryGet) return summary;
      if (channel === IPC_CHANNELS.diagnosticBundleExport) return { status: 'saved' };
      return storage;
    });

    await expect(api.getDiagnosticSummary()).resolves.toEqual(summary);
    await expect(api.exportDiagnosticBundle()).resolves.toEqual({
      status: 'saved'
    });
    await expect(api.getDiagnosticStorageSettings()).resolves.toEqual(storage);
    await expect(api.chooseDiagnosticJournalDirectory()).resolves.toEqual(storage);
    await expect(api.resetDiagnosticJournalDirectory()).resolves.toEqual(storage);
    await expect(api.chooseDiagnosticExportDirectory()).resolves.toEqual(storage);
    await expect(api.resetDiagnosticExportDirectory()).resolves.toEqual(storage);
    expect(invocations).toEqual([
      IPC_CHANNELS.diagnosticSummaryGet,
      IPC_CHANNELS.diagnosticBundleExport,
      IPC_CHANNELS.diagnosticStorageGet,
      IPC_CHANNELS.diagnosticJournalDirectoryChoose,
      IPC_CHANNELS.diagnosticJournalDirectoryReset,
      IPC_CHANNELS.diagnosticExportDirectoryChoose,
      IPC_CHANNELS.diagnosticExportDirectoryReset
    ]);

    const invalidApi = createLumoraApi(vi.fn().mockResolvedValue({}));
    await expect(invalidApi.getDiagnosticSummary()).rejects.toBeDefined();
    await expect(invalidApi.exportDiagnosticBundle()).rejects.toBeDefined();
    await expect(invalidApi.getDiagnosticStorageSettings()).rejects.toBeDefined();
  });

  it('uses target-derived remote discovery and provider-preference channels', async () => {
    const invocations: Array<{ channel: string; args: readonly unknown[] }> = [];
    const snapshot = {
      executionTargetId: '05f4e306-4af2-4c73-9e0d-706084623645',
      scannedAt: '2026-08-05T04:03:02.000Z',
      environment: {
        checkedAt: '2026-08-05T04:03:02.000Z',
        node: { state: 'not_found', executablePath: null, version: null },
        npm: { state: 'not_found', executablePath: null, version: null }
      },
      providers: { scannedAt: '2026-08-05T04:03:02.000Z', providers: [] }
    } as const;
    const sessions = {
      executionTargetId: snapshot.executionTargetId,
      scannedAt: '2026-08-09T04:03:02.000Z',
      sessions: [],
      providers: [],
      snapshot: {
        refreshedAt: '2026-08-09T04:03:02.000Z',
        workspaces: [],
        sessions: [],
        providerStatus: [],
        providerFacets: [],
        diagnostics: []
      }
    } as const;
    const api = createLumoraApi(async (channel, ...args) => {
      invocations.push({ channel, args });
      if (channel === IPC_CHANNELS.remoteDiscoveryScan) return snapshot;
      if (channel === IPC_CHANNELS.remoteSessionScan) return sessions;
      if (channel === IPC_CHANNELS.remoteProviderPreferencesSave) return args[0];
      return { enabledProviders: ['codex'] };
    });

    await expect(api.getRemoteProviderPreferences()).resolves.toEqual({
      enabledProviders: ['codex']
    });
    await expect(api.saveRemoteProviderPreferences({
      enabledProviders: ['opencode', 'codex']
    })).resolves.toEqual({ enabledProviders: ['codex', 'opencode'] });
    await expect(api.scanRemoteDiscovery()).resolves.toEqual(snapshot);
    await expect(api.scanRemoteSessions()).resolves.toEqual(sessions);
    expect(invocations).toEqual([
      { channel: IPC_CHANNELS.remoteProviderPreferencesGet, args: [] },
      {
        channel: IPC_CHANNELS.remoteProviderPreferencesSave,
        args: [{ enabledProviders: ['codex', 'opencode'] }]
      },
      { channel: IPC_CHANNELS.remoteDiscoveryScan, args: [] },
      { channel: IPC_CHANNELS.remoteSessionScan, args: [] }
    ]);
  });

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

  it('claims startup presentation through a validated boolean response', async () => {
    const invoke = vi.fn().mockResolvedValue(true);
    const api = createLumoraApi(invoke);

    const firstClaim = api.claimStartupPresentation();
    const strictModeClaim = api.claimStartupPresentation();

    await expect(firstClaim).resolves.toBe(true);
    await expect(strictModeClaim).resolves.toBe(true);
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledWith(IPC_CHANNELS.startupPresentationClaim);

    const invalidApi = createLumoraApi(vi.fn().mockResolvedValue('yes'));
    await expect(invalidApi.claimStartupPresentation()).rejects.toThrow();
  });

  it('acknowledges startup presentation completion through a narrow channel', async () => {
    const invoke = vi.fn().mockResolvedValue({ acknowledged: true });
    const api = createLumoraApi(invoke);

    await expect(api.completeStartupPresentation()).resolves.toBeUndefined();
    expect(invoke).toHaveBeenCalledWith(
      IPC_CHANNELS.startupPresentationComplete
    );

    const invalidApi = createLumoraApi(vi.fn().mockResolvedValue(undefined));
    await expect(invalidApi.completeStartupPresentation()).rejects.toThrow();
  });

  it('uses narrow environment channels and validates their responses', async () => {
    const environmentScan = {
      checkedAt: '2026-07-17T01:00:00.000Z',
      node: {
        state: 'ready',
        executablePath: '/usr/bin/node',
        version: 'v24.18.0'
      },
      npm: {
        state: 'not_found',
        executablePath: null,
        version: null
      }
    } as const;
    const invocations: Array<{ channel: string; args: readonly unknown[] }> = [];
    const api = createLumoraApi(async (channel, ...args) => {
      invocations.push({ channel, args });
      if (channel === IPC_CHANNELS.environmentScan) return environmentScan;
      return { opened: true };
    });

    await expect(api.scanDeveloperEnvironment()).resolves.toEqual(
      environmentScan
    );
    await expect(api.openNodeDownloadPage()).resolves.toBeUndefined();
    expect(invocations).toEqual([
      { channel: IPC_CHANNELS.environmentScan, args: [] },
      { channel: IPC_CHANNELS.nodeDownloadOpen, args: [] }
    ]);
  });

  it('rejects malformed environment and browser-open responses', async () => {
    const invalidScanApi = createLumoraApi(async () => ({
      checkedAt: 'invalid',
      node: { state: 'ready', executablePath: null, version: '1.0.0' },
      npm: { state: 'not_found', executablePath: null, version: null }
    }));
    const invalidOpenApi = createLumoraApi(async () => ({ opened: false }));

    await expect(invalidScanApi.scanDeveloperEnvironment()).rejects.toBeDefined();
    await expect(invalidOpenApi.openNodeDownloadPage()).rejects.toBeDefined();
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

  it('uses validated narrow channels for provider updates', async () => {
    const invocations: Array<{ channel: string; args: readonly unknown[] }> = [];
    const check = {
      checkedAt: '2026-07-17T02:00:00.000Z',
      providers: [
        {
          provider: 'codex' as const, displayName: 'Codex',
          state: 'up_to_date' as const, installedVersion: '1.2.3',
          latestVersion: '1.2.3', issue: null
        },
        {
          provider: 'claude' as const, displayName: 'Claude Code',
          state: 'update_available' as const, installedVersion: '2.0.0',
          latestVersion: '2.1.0', issue: null
        }
      ]
    };
    const update = {
      provider: 'claude' as const,
      completedAt: '2026-07-17T02:01:00.000Z',
      installation: {
        provider: 'claude' as const, displayName: 'Claude Code', state: 'ready' as const,
        executablePath: '/usr/bin/claude', version: '2.1.0', issue: null
      }
    };
    const api = createLumoraApi(async (channel, ...args) => {
      invocations.push({ channel, args });
      if (channel === IPC_CHANNELS.providerUpdatesCheck) return check;
      if (channel === IPC_CHANNELS.providerInstallGuideOpen) {
        return { opened: true };
      }
      return { outcome: 'completed', result: update };
    });

    await expect(api.checkProviderUpdates()).resolves.toEqual(check);
    await expect(api.updateProvider('claude'))
      .resolves.toEqual({ outcome: 'completed', result: update });
    await expect(api.installProvider('claude'))
      .resolves.toEqual({ outcome: 'completed', result: update });
    await expect(api.openProviderInstallGuide('aider')).resolves.toBeUndefined();
    expect(invocations).toEqual([
      { channel: IPC_CHANNELS.providerUpdatesCheck, args: [] },
      {
        channel: IPC_CHANNELS.providerUpdateRun,
        args: [{ provider: 'claude' }]
      },
      {
        channel: IPC_CHANNELS.providerInstallRun,
        args: [{ provider: 'claude' }]
      },
      {
        channel: IPC_CHANNELS.providerInstallGuideOpen,
        args: [{ provider: 'aider' }]
      }
    ]);
  });

  it('rejects malformed provider update requests and responses', async () => {
    const invoke = vi.fn(async () => ({ unexpected: true }));
    const api = createLumoraApi(invoke);

    await expect(
      api.updateProvider('unknown-agent' as 'codex')
    ).rejects.toBeDefined();
    expect(invoke).not.toHaveBeenCalled();
    await expect(api.checkProviderUpdates()).rejects.toBeDefined();
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

  it('validates and routes workspace visibility operations without target ids', async () => {
    const workspaceId = 'a'.repeat(64);
    const policy = {
      workspaceId,
      mode: 'workspace_only' as const,
      updatedAt: '2026-08-12T01:00:00.000Z'
    };
    const invocations: { channel: string; args: readonly unknown[] }[] = [];
    const api = createLumoraApi(async (channel, ...args) => {
      invocations.push({ channel, args });
      return channel === IPC_CHANNELS.workspaceVisibilityRestore ||
        channel === IPC_CHANNELS.workspaceVisibilityRestoreAll
        ? []
        : [policy];
    });

    await expect(api.getWorkspaceVisibilityPolicies()).resolves.toEqual([policy]);
    await expect(api.setWorkspaceVisibilityPolicy({
      workspaceId,
      mode: 'workspace_only'
    })).resolves.toEqual([policy]);
    await expect(api.restoreWorkspaceVisibility({
      workspaceIds: [workspaceId]
    })).resolves.toEqual([]);
    await expect(api.restoreAllWorkspaceVisibility()).resolves.toEqual([]);

    expect(invocations).toEqual([
      { channel: IPC_CHANNELS.workspaceVisibilityGet, args: [] },
      {
        channel: IPC_CHANNELS.workspaceVisibilitySet,
        args: [{ workspaceId, mode: 'workspace_only' }]
      },
      {
        channel: IPC_CHANNELS.workspaceVisibilityRestore,
        args: [{ workspaceIds: [workspaceId] }]
      },
      { channel: IPC_CHANNELS.workspaceVisibilityRestoreAll, args: [] }
    ]);
  });

  it('rejects malformed workspace visibility requests and responses', async () => {
    const invoke = vi.fn(async () => [{ workspaceId: '../escape' }]);
    const api = createLumoraApi(invoke);

    await expect(api.getWorkspaceVisibilityPolicies()).rejects.toBeDefined();
    await expect(api.setWorkspaceVisibilityPolicy({
      workspaceId: '../escape',
      mode: 'workspace_only'
    } as never)).rejects.toBeDefined();
    await expect(api.restoreWorkspaceVisibility({
      workspaceIds: []
    })).rejects.toBeDefined();
    expect(invoke).toHaveBeenCalledOnce();
  });

  it('reads clipboard text through only the dedicated channel', async () => {
    const invocations: { channel: string; args: readonly unknown[] }[] = [];
    const api = createLumoraApi(async (channel, ...args) => {
      invocations.push({ channel, args });
      return channel === IPC_CHANNELS.clipboardTextRead
        ? 'clipboard value'
        : { accepted: true };
    });

    await expect(api.readClipboardText()).resolves.toBe('clipboard value');
    expect(invocations).toEqual([
      { channel: IPC_CHANNELS.clipboardTextRead, args: [] }
    ]);
  });

  it('reads a runtime-scoped terminal clipboard result through its dedicated channel', async () => {
    const runtimeId = '5a795d90-06b3-4fca-b9a7-c0d0bf312c1d';
    const invoke = vi.fn(async () => ({
      kind: 'image',
      pasteText: '[Pasted image: "/tmp/lumora/image.png"]'
    }));
    const api = createLumoraApi(invoke);

    await expect(api.readTerminalClipboard(runtimeId)).resolves.toEqual({
      kind: 'image',
      pasteText: '[Pasted image: "/tmp/lumora/image.png"]'
    });
    expect(invoke).toHaveBeenCalledWith(IPC_CHANNELS.terminalClipboardRead, {
      runtimeId
    });
  });

  it('rejects image bytes at the terminal clipboard preload boundary', async () => {
    const api = createLumoraApi(async () => ({
      kind: 'image',
      pasteText: 'image',
      png: new Uint8Array([1, 2, 3])
    }));

    await expect(
      api.readTerminalClipboard('5a795d90-06b3-4fca-b9a7-c0d0bf312c1d')
    ).rejects.toBeDefined();
  });

  it('writes validated clipboard text through only the dedicated channel', async () => {
    const invocations: { channel: string; args: readonly unknown[] }[] = [];
    const api = createLumoraApi(async (channel, ...args) => {
      invocations.push({ channel, args });
      return channel === IPC_CHANNELS.clipboardTextRead
        ? 'clipboard value'
        : { accepted: true };
    });

    await expect(
      api.writeClipboardText('selected value')
    ).resolves.toBeUndefined();
    expect(invocations).toEqual([
      {
        channel: IPC_CHANNELS.clipboardTextWrite,
        args: ['selected value']
      }
    ]);
  });

  it('rejects malformed clipboard read results at the preload boundary', async () => {
    const api = createLumoraApi(async () => ({ text: 'clipboard value' }));

    await expect(api.readClipboardText()).rejects.toBeDefined();
  });

  it('rejects oversized clipboard writes before invoking IPC', async () => {
    const invoke = vi.fn(async () => ({ accepted: true }));
    const api = createLumoraApi(invoke);

    await expect(
      api.writeClipboardText('x'.repeat(4_194_305))
    ).rejects.toBeDefined();
    expect(invoke).not.toHaveBeenCalled();
  });

  it.each([
    { accepted: false },
    { accepted: true, unexpected: 'data' }
  ])(
    'rejects malformed clipboard write result $accepted at the preload boundary',
    async (result) => {
      const api = createLumoraApi(async () => result);

      await expect(api.writeClipboardText('selected value')).rejects.toBeDefined();
    }
  );

  it('allows empty clipboard text for reads and writes', async () => {
    const invocations: { channel: string; args: readonly unknown[] }[] = [];
    const api = createLumoraApi(async (channel, ...args) => {
      invocations.push({ channel, args });
      return channel === IPC_CHANNELS.clipboardTextRead
        ? ''
        : { accepted: true };
    });

    await expect(api.readClipboardText()).resolves.toBe('');
    await expect(api.writeClipboardText('')).resolves.toBeUndefined();
    expect(invocations).toEqual([
      { channel: IPC_CHANNELS.clipboardTextRead, args: [] },
      { channel: IPC_CHANNELS.clipboardTextWrite, args: [''] }
    ]);
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
        if (channel === IPC_CHANNELS.terminalLinkOpen) return { opened: true };
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
    await expect(
      api.openTerminalLink('https://example.com/docs')
    ).resolves.toBeUndefined();
    expect(invocations).toEqual([
      { channel: IPC_CHANNELS.terminalProfilesGet, args: [] },
      {
        channel: IPC_CHANNELS.runtimeWrite,
        args: [{ runtimeId, data: 'hello' }]
      },
      {
        channel: IPC_CHANNELS.terminalLinkOpen,
        args: [{ url: 'https://example.com/docs' }]
      }
    ]);

    const listener = vi.fn();
    const remove = api.onRuntimeEvent(listener);
    eventReceiver!({ type: 'output', runtimeId, sequence: 1, data: 'ready' });
    expect(listener).toHaveBeenCalledWith({
      type: 'output', runtimeId, sequence: 1, data: 'ready'
    });
    remove();
    expect(unsubscribe).toHaveBeenCalledOnce();
  });

  it('rejects unsafe terminal links before invoking IPC', async () => {
    const invoke = vi.fn();
    const api = createLumoraApi(invoke);

    for (const url of [
      'file:///tmp/session',
      'javascript:alert(1)',
      'https://user:secret@example.com/private',
      'not a url'
    ]) {
      await expect(api.openTerminalLink(url)).rejects.toBeDefined();
    }
    expect(invoke).not.toHaveBeenCalled();
  });

  it('validates tray resume-session events before exposing them', () => {
    const sessionId = 'a'.repeat(64);
    let receiver: ((value: unknown) => void) | null = null;
    const unsubscribe = vi.fn();
    const api = createLumoraApi(
      vi.fn(),
      (channel, listener) => {
        expect(channel).toBe(IPC_CHANNELS.trayResumeSession);
        receiver = listener;
        return unsubscribe;
      }
    );
    const listener = vi.fn();

    const remove = api.onTrayResumeSessionRequested(listener);
    receiver!({ sessionId });

    expect(listener).toHaveBeenCalledWith(sessionId);
    expect(() => receiver!({ sessionId: 'unsafe' })).toThrow();
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

  it('uses validated narrow channels for keyboard settings', async () => {
    const invocations: { channel: string; args: readonly unknown[] }[] = [];
    const custom = {
      ...DEFAULT_KEYBOARD_SETTINGS,
      terminalSwitcher: {
        code: 'KeyK',
        control: true,
        alt: false,
        shift: true,
        meta: false
      }
    };
    const api = createLumoraApi(async (channel, ...args) => {
      invocations.push({ channel, args });
      return channel === IPC_CHANNELS.keyboardSettingsGet
        ? DEFAULT_KEYBOARD_SETTINGS
        : custom;
    });

    await expect(api.getKeyboardSettings()).resolves.toEqual(
      DEFAULT_KEYBOARD_SETTINGS
    );
    await expect(api.saveKeyboardSettings(custom)).resolves.toEqual(custom);
    expect(invocations).toEqual([
      { channel: IPC_CHANNELS.keyboardSettingsGet, args: [] },
      { channel: IPC_CHANNELS.keyboardSettingsSave, args: [custom] }
    ]);
  });

  it('uses validated narrow channels for general settings', async () => {
    const invocations: { channel: string; args: readonly unknown[] }[] = [];
    const hidden = {
      ...DEFAULT_GENERAL_SETTINGS,
      showInformationalNotices: false
    };
    const api = createLumoraApi(async (channel, ...args) => {
      invocations.push({ channel, args });
      return channel === IPC_CHANNELS.generalSettingsGet
        ? DEFAULT_GENERAL_SETTINGS
        : hidden;
    });

    await expect(api.getGeneralSettings()).resolves.toEqual(
      DEFAULT_GENERAL_SETTINGS
    );
    await expect(api.saveGeneralSettings(hidden)).resolves.toEqual(hidden);
    expect(invocations).toEqual([
      { channel: IPC_CHANNELS.generalSettingsGet, args: [] },
      { channel: IPC_CHANNELS.generalSettingsSave, args: [hidden] }
    ]);

    await expect(
      api.saveGeneralSettings({
        ...DEFAULT_GENERAL_SETTINGS,
        showInformationalNotices: 'no'
      } as never)
    ).rejects.toBeDefined();
  });

  it('exposes a validated General-settings change subscription', () => {
    let subscribedChannel: string | null = null;
    let subscribedListener: ((value: unknown) => void) | null = null;
    const unsubscribe = vi.fn();
    const api = createLumoraApi(vi.fn(), (channel, listener) => {
      subscribedChannel = channel;
      subscribedListener = listener;
      return unsubscribe;
    });
    const listener = vi.fn();

    expect(api.onGeneralSettingsChanged(listener)).toBe(unsubscribe);
    expect(subscribedChannel).toBe(IPC_CHANNELS.generalSettingsChanged);
    const notify = subscribedListener as ((value: unknown) => void) | null;
    if (notify === null) throw new Error('Missing subscription.');
    notify(null);
    expect(listener).toHaveBeenCalledOnce();
    expect(() => notify({ settings: 'leaked' })).toThrow();
  });

  it('exposes opaque appearance background operations', async () => {
    const state = { available: true, revision: '1720000000000-4096' };
    const invoke = vi.fn().mockResolvedValue(state);
    const api = createLumoraApi(invoke);

    await expect(api.getAppearanceBackground()).resolves.toEqual(state);
    await expect(api.chooseAppearanceBackground()).resolves.toEqual(state);
    await expect(api.removeAppearanceBackground()).resolves.toEqual(state);
    expect(invoke.mock.calls).toEqual([
      [IPC_CHANNELS.appearanceBackgroundGet],
      [IPC_CHANNELS.appearanceBackgroundChoose],
      [IPC_CHANNELS.appearanceBackgroundRemove]
    ]);
  });

  it('uses validated narrow channels for workspace trust', async () => {
    const invocations: { channel: string; args: readonly unknown[] }[] = [];
    const launchToken = '0198f8b6-18f3-7ca0-9f0f-123456789abc';
    const decision = {
      workspaceId: 'a'.repeat(64),
      canonicalPath: 'D:\\Projects\\Lumora',
      trustedAt: '2026-07-13T08:00:00.000Z'
    };
    const api = createLumoraApi(async (channel, ...args) => {
      invocations.push({ channel, args });
      if (channel === IPC_CHANNELS.workspaceTrustGet) return [decision];
      if (channel === IPC_CHANNELS.workspaceTrustGrant) return decision;
      if (channel === IPC_CHANNELS.workspaceTrustRevoke) return [];
      throw new Error(`Unexpected channel ${channel}`);
    });

    await expect(api.getWorkspaceTrustDecisions()).resolves.toEqual([decision]);
    await expect(api.trustWorkspaceForLaunch(launchToken)).resolves.toEqual(
      decision
    );
    await expect(
      api.revokeWorkspaceTrust(decision.workspaceId)
    ).resolves.toEqual([]);
    expect(invocations).toEqual([
      { channel: IPC_CHANNELS.workspaceTrustGet, args: [] },
      {
        channel: IPC_CHANNELS.workspaceTrustGrant,
        args: [{ launchToken }]
      },
      {
        channel: IPC_CHANNELS.workspaceTrustRevoke,
        args: [{ workspaceId: decision.workspaceId }]
      }
    ]);
  });

  it('rejects malformed workspace trust requests and responses', async () => {
    const invoke = vi.fn(async () => [{ workspaceId: '../escape' }]);
    const api = createLumoraApi(invoke);

    await expect(api.getWorkspaceTrustDecisions()).rejects.toBeDefined();
    await expect(api.trustWorkspaceForLaunch('not-a-uuid')).rejects.toBeDefined();
    await expect(api.revokeWorkspaceTrust('../escape')).rejects.toBeDefined();
    expect(invoke).toHaveBeenCalledOnce();
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
  it('uses validated narrow channels for session transfer workflows and progress', async () => {
    const token = '0198f8b6-18f3-7ca0-9f0f-123456789abc';
    const sessionId = 'a'.repeat(64);
    const workspaceId = 'b'.repeat(64);
    const expiresAt = '2026-07-29T08:15:00.000Z';
    const capability = {
      provider: 'opencode' as const,
      displayName: 'OpenCode',
      exportSupport: 'supported' as const,
      routes: [
        {
          sourcePlatform: 'win32' as const,
          destinationPlatform: 'win32' as const,
          support: 'supported' as const
        }
      ],
      installGuidance: null
    };
    const plannedSession = {
      sessionId,
      nativeSessionId: 'ses_transfer',
      provider: 'opencode' as const,
      title: 'Transfer session',
      workspaceId,
      estimatedBytes: 0
    };
    const exportPlan = {
      planToken: token,
      sessions: [plannedSession],
      skipped: [],
      estimatedBytes: 0,
      expiresAt
    };
    const selection = {
      selectionToken: token,
      fileName: 'sessions.lumora-sessions',
      encrypted: false
    };
    const inspection = {
      inspectionToken: token,
      archiveName: selection.fileName,
      encrypted: false,
      sourcePlatform: 'win32' as const,
      providers: [
        {
          provider: 'opencode' as const,
          displayName: 'OpenCode',
          sessionCount: 1,
          support: 'supported' as const,
          installGuidance: null
        }
      ],
      workspaces: [],
      sessionCount: 1,
      expiresAt
    };
    const importPlan = {
      planToken: token,
      ready: [plannedSession],
      skipped: [],
      providers: ['opencode' as const],
      expiresAt
    };
    const result = {
      operationId: token,
      direction: 'import' as const,
      completedAt: '2026-07-29T08:00:00.000Z',
      status: 'completed' as const,
      importedCount: 1,
      exportedCount: 0,
      skippedCount: 0,
      failedCount: 0,
      providers: ['opencode' as const],
      items: [
        {
          sessionId,
          provider: 'opencode' as const,
          status: 'imported' as const,
          reason: null,
          message: 'Session imported.'
        }
      ]
    };
    const workspace = {
      id: workspaceId,
      displayName: 'Lumora',
      canonicalPath: 'D:\\Projects\\Lumora',
      available: true,
      origin: 'manual' as const,
      sessionCount: 1,
      providerCounts: { opencode: 1 },
      lastActivityAt: result.completedAt
    };
    const history = [
      {
        id: token,
        direction: 'import' as const,
        completedAt: result.completedAt,
        importedCount: 1,
        exportedCount: 0,
        skippedCount: 0,
        providers: ['opencode' as const]
      }
    ];
    const invocations: Array<{ channel: string; args: readonly unknown[] }> = [];
    let eventReceiver: ((value: unknown) => void) | undefined;
    const unsubscribe = vi.fn();
    const api = createLumoraApi(
      async (channel, ...args) => {
        invocations.push({ channel, args });
        if (channel === IPC_CHANNELS.transferCapabilitiesGet) return [capability];
        if (channel === IPC_CHANNELS.transferExportPrepare) return exportPlan;
        if (channel === IPC_CHANNELS.transferExportExecute) {
          return { ...result, direction: 'export', importedCount: 0, exportedCount: 1 };
        }
        if (channel === IPC_CHANNELS.transferImportChoose) return selection;
        if (channel === IPC_CHANNELS.transferImportInspect) return inspection;
        if (channel === IPC_CHANNELS.transferImportPlan) return importPlan;
        if (channel === IPC_CHANNELS.transferImportExecute) return result;
        if (channel === IPC_CHANNELS.transferWorkspaceChoose) return workspace;
        if (channel === IPC_CHANNELS.transferHistoryGet) return history;
        if (channel === IPC_CHANNELS.transferOperationCancel) {
          return { accepted: true };
        }
        throw new Error(`Unexpected transfer channel: ${channel}`);
      },
      (channel, listener) => {
        expect(channel).toBe(IPC_CHANNELS.transferEvent);
        eventReceiver = listener;
        return unsubscribe;
      }
    );

    await expect(api.getTransferCapabilities()).resolves.toEqual([capability]);
    await expect(
      api.prepareSessionExport({ sessionIds: [sessionId] })
    ).resolves.toEqual(exportPlan);
    await expect(
      api.executeSessionExport({
        planToken: token,
        protection: { encrypted: false }
      })
    ).resolves.toMatchObject({ direction: 'export', exportedCount: 1 });
    await expect(api.chooseSessionImportArchive()).resolves.toEqual(selection);
    await expect(
      api.inspectSessionImport({ selectionToken: token })
    ).resolves.toEqual(inspection);
    await expect(
      api.planSessionImport({
        inspectionToken: token,
        providers: ['opencode'],
        workspaceMappings: []
      })
    ).resolves.toEqual(importPlan);
    await expect(
      api.executeSessionImport({ planToken: token })
    ).resolves.toEqual(result);
    await expect(api.chooseTransferWorkspace()).resolves.toEqual(workspace);
    await expect(api.getTransferHistory()).resolves.toEqual(history);
    await expect(api.cancelTransferOperation(token)).resolves.toBeUndefined();

    const listener = vi.fn();
    const remove = api.onTransferEvent(listener);
    eventReceiver?.({
      operationId: token,
      direction: 'import',
      phase: 'verifying',
      completed: 1,
      total: 1,
      message: 'Verifying session.'
    });
    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({ phase: 'verifying', completed: 1 })
    );
    remove();
    expect(unsubscribe).toHaveBeenCalledOnce();
    expect(invocations.map(({ channel }) => channel)).toEqual([
      IPC_CHANNELS.transferCapabilitiesGet,
      IPC_CHANNELS.transferExportPrepare,
      IPC_CHANNELS.transferExportExecute,
      IPC_CHANNELS.transferImportChoose,
      IPC_CHANNELS.transferImportInspect,
      IPC_CHANNELS.transferImportPlan,
      IPC_CHANNELS.transferImportExecute,
      IPC_CHANNELS.transferWorkspaceChoose,
      IPC_CHANNELS.transferHistoryGet,
      IPC_CHANNELS.transferOperationCancel
    ]);
  });
});

describe('createLumoraApi structured agent bridge', () => {
  it('validates structured operations and event subscriptions', async () => {
    const summary = {
      connectionId: 'connection-1', providerId: 'codex' as const,
      nativeSessionId: 'native-1', catalogSessionId: null, workspaceId: 'workspace-1',
      title: 'Structured session', state: 'ready' as const, generation: 1,
      createdAt: '2026-08-27T00:00:00.000Z', updatedAt: '2026-08-27T00:00:00.000Z',
      error: null
    };
    const calls: Array<[string, ...unknown[]]> = [];
    let receiver: ((value: unknown) => void) | null = null;
    const unsubscribe = vi.fn();
    const api = createLumoraApi(async (channel, ...args) => {
      calls.push([channel, ...args]);
      if (channel === IPC_CHANNELS.structuredCapabilityScan) return [];
      if (
        channel === IPC_CHANNELS.structuredPreferencesGet ||
        channel === IPC_CHANNELS.structuredPreferenceSave
      ) return [
        { providerId: 'codex', useUnifiedWhenAvailable: true, executablePathOverride: null },
        { providerId: 'claude', useUnifiedWhenAvailable: true, executablePathOverride: null },
        { providerId: 'gemini', useUnifiedWhenAvailable: true, executablePathOverride: null },
        { providerId: 'opencode', useUnifiedWhenAvailable: true, executablePathOverride: null },
        { providerId: 'cursor', useUnifiedWhenAvailable: true, executablePathOverride: null },
        { providerId: 'copilot', useUnifiedWhenAvailable: true, executablePathOverride: null },
        { providerId: 'qwen', useUnifiedWhenAvailable: true, executablePathOverride: null },
        { providerId: 'kimi', useUnifiedWhenAvailable: true, executablePathOverride: null },
        { providerId: 'goose', useUnifiedWhenAvailable: true, executablePathOverride: null }
      ];
      if (channel === IPC_CHANNELS.structuredRuntimeList) return [summary];
      if (channel === IPC_CHANNELS.structuredRuntimeSnapshot) {
        return { runtime: summary, events: [], boundary: null };
      }
      if (channel === IPC_CHANNELS.structuredRuntimeAction) return { accepted: true };
      if (channel === IPC_CHANNELS.agentRuntimeStart) {
        return { mode: 'structured', routeReason: 'verified', runtime: summary };
      }
      if (channel === IPC_CHANNELS.agentRuntimeCancelStart) {
        return { accepted: true };
      }
      return summary;
    }, (channel, listener) => {
      expect(channel).toBe(IPC_CHANNELS.structuredRuntimeEvent);
      receiver = listener;
      return unsubscribe;
    });

    await expect(api.startAgentRuntime(
      '0198f8b6-18f3-7ca0-9f0f-123456789abc',
      '0198f8b6-18f3-7ca0-9f0f-abcdef123456'
    )).resolves.toMatchObject({ mode: 'structured', routeReason: 'verified' });
    await expect(api.cancelAgentRuntimeStart(
      '0198f8b6-18f3-7ca0-9f0f-abcdef123456'
    )).resolves.toBeUndefined();
    await expect(api.scanStructuredProviderCapabilities(true)).resolves.toEqual([]);
    await expect(api.getStructuredProviderPreferences()).resolves.toHaveLength(9);
    await expect(api.saveStructuredProviderPreference({
      providerId: 'codex', useUnifiedWhenAvailable: true, executablePathOverride: null
    })).resolves.toHaveLength(9);
    await expect(api.launchStructuredRuntime({
      strategy: 'new', providerId: 'codex', workspaceId: 'workspace-1', startPrompt: ''
    })).resolves.toEqual(summary);
    await expect(api.listStructuredRuntimes()).resolves.toEqual([summary]);
    await expect(api.getStructuredRuntimeSnapshot('connection-1')).resolves.toMatchObject({
      runtime: summary
    });
    await expect(api.dispatchStructuredAgentAction({
      kind: 'turn.cancel', connectionId: 'connection-1'
    })).resolves.toBeUndefined();
    await expect(api.reconnectStructuredRuntime('connection-1')).resolves.toEqual(summary);
    await expect(api.closeStructuredRuntime('connection-1')).resolves.toEqual(summary);

    const listener = vi.fn();
    expect(api.onStructuredAgentEvent(listener)).toBe(unsubscribe);
    const event = {
      connectionId: 'connection-1', providerId: 'codex', nativeSessionId: 'native-1',
      turnId: 'lifecycle', eventId: 'event-1', parentEventId: null, sequence: 1,
      generation: 1, timestamp: '2026-08-27T00:00:00.000Z', kind: 'runtime.status',
      payload: { state: 'ready', message: null }
    };
    (receiver as unknown as (value: unknown) => void)(event);
    expect(listener).toHaveBeenCalledWith(event);
    expect(calls.map(([channel]) => channel)).toEqual([
      IPC_CHANNELS.agentRuntimeStart,
      IPC_CHANNELS.agentRuntimeCancelStart,
      IPC_CHANNELS.structuredCapabilityScan,
      IPC_CHANNELS.structuredPreferencesGet,
      IPC_CHANNELS.structuredPreferenceSave,
      IPC_CHANNELS.structuredRuntimeLaunch,
      IPC_CHANNELS.structuredRuntimeList,
      IPC_CHANNELS.structuredRuntimeSnapshot,
      IPC_CHANNELS.structuredRuntimeAction,
      IPC_CHANNELS.structuredRuntimeReconnect,
      IPC_CHANNELS.structuredRuntimeClose
    ]);
  });
});
