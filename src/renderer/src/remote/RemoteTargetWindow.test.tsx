import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import {
  DEFAULT_KEYBOARD_SETTINGS,
  type LumoraApi
} from '../../../shared/contracts';
import { RemoteTargetWindow } from './RemoteTargetWindow';

const TARGET_ID = '5377f5df-cc8c-42a3-bde1-b8764387b802';
const summary = {
  target: {
    id: TARGET_ID,
    kind: 'remote',
    displayName: 'Linux build server',
    platform: 'linux',
    architecture: 'x64',
    connectionState: 'offline',
    helperVersion: null,
    protocolVersion: null,
    capabilities: [],
    lastConnectedAt: null,
    lastScannedAt: null
  },
  profile: {
    executionTargetId: TARGET_ID,
    displayName: 'Linux build server',
    route: 'direct',
    host: 'linux.internal',
    port: 22,
    username: 'builder',
    sshConfigHost: null,
    authentication: { method: 'password' },
    verifiedHostFingerprint: 'SHA256:57qsnZ7C9rC8S3dftMDSqdHcpZ+PZfNclRBfXZXp0mM',
    createdAt: '2026-08-04T09:00:00.000Z',
    updatedAt: '2026-08-04T09:00:00.000Z'
  }
} as const;

const discovery = {
  executionTargetId: TARGET_ID,
  scannedAt: '2026-08-05T04:03:02.000Z',
  environment: {
    checkedAt: '2026-08-05T04:03:02.000Z',
    node: {
      state: 'ready', executablePath: '/usr/bin/node', version: 'v24.0.0'
    },
    npm: { state: 'not_found', executablePath: null, version: null }
  },
  providers: {
    scannedAt: '2026-08-05T04:03:02.000Z',
    providers: [{
      provider: 'codex', displayName: 'Codex', state: 'ready',
      executablePath: '/usr/bin/codex', version: 'codex 1.2.3', issue: null
    }]
  }
} as const;

function runtimeApiDefaults() {
  return {
    getTerminalProfiles: vi.fn().mockResolvedValue([]),
    listRuntimes: vi.fn().mockResolvedValue([]),
    getGeneralSettings: vi.fn().mockResolvedValue({
      enabledProviders: ['codex']
    }),
    getKeyboardSettings: vi.fn().mockResolvedValue(DEFAULT_KEYBOARD_SETTINGS),
    onRuntimeEvent: vi.fn(() => () => undefined)
  };
}

describe('RemoteTargetWindow', () => {
  it('uses the shared Lumora shell and remote-scoped routes after connection', async () => {
    const readySummary = {
      ...summary,
      target: {
        ...summary.target,
        connectionState: 'ready' as const,
        helperVersion: '0.3.0',
        protocolVersion: 1,
        capabilities: ['provider-scan' as const, 'session-scan' as const]
      }
    };
    const api = {
      listRemoteTargets: vi.fn().mockResolvedValue([readySummary]),
      getRemoteProviderPreferences: vi.fn().mockResolvedValue({
        enabledProviders: ['opencode']
      }),
      scanRemoteDiscovery: vi.fn().mockResolvedValue(discovery),
      scanRemoteSessions: vi.fn().mockResolvedValue({
        executionTargetId: TARGET_ID,
        scannedAt: '2026-08-05T04:03:02.000Z',
        sessions: [],
        providers: [],
        snapshot: {
          refreshedAt: '2026-08-05T04:03:02.000Z',
          workspaces: [], sessions: [], providerStatus: [],
          providerFacets: [], diagnostics: []
        }
      })
    } as unknown as LumoraApi;

    render(<RemoteTargetWindow executionTargetId={TARGET_ID} api={api} />);

    expect(await screen.findByTestId('lumora-shell')).toBeInTheDocument();
    for (const route of ['Home', 'Workspaces', 'All sessions', 'Settings']) {
      expect(screen.getByRole('button', { name: route })).toBeInTheDocument();
    }
    expect(screen.queryByRole('button', { name: 'Terminal profiles' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Remote computers' })).not.toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'Overview' })).not.toBeInTheDocument();
  });

  it('keeps the current shell and cached page visible after disconnection', async () => {
    const readySummary = {
      ...summary,
      target: {
        ...summary.target,
        connectionState: 'ready' as const,
        helperVersion: '0.3.0',
        protocolVersion: 1,
        capabilities: ['provider-scan' as const, 'session-scan' as const]
      }
    };
    const api = {
      listRemoteTargets: vi.fn().mockResolvedValue([readySummary]),
      getRemoteProviderPreferences: vi.fn().mockResolvedValue({
        enabledProviders: ['opencode']
      }),
      scanRemoteDiscovery: vi.fn().mockResolvedValue(discovery),
      scanRemoteSessions: vi.fn().mockResolvedValue({
        executionTargetId: TARGET_ID,
        scannedAt: '2026-08-05T04:03:02.000Z',
        sessions: [], providers: [],
        snapshot: {
          refreshedAt: '2026-08-05T04:03:02.000Z',
          workspaces: [], sessions: [], providerStatus: [],
          providerFacets: [], diagnostics: []
        }
      }),
      disconnectRemoteTarget: vi.fn().mockResolvedValue({
        ...readySummary,
        target: {
          ...readySummary.target,
          connectionState: 'offline',
          capabilities: []
        }
      })
    } as unknown as LumoraApi;

    render(<RemoteTargetWindow executionTargetId={TARGET_ID} api={api} />);
    await screen.findByTestId('lumora-shell');
    fireEvent.click(screen.getByRole('button', { name: 'Workspaces' }));
    expect(await screen.findByRole('heading', { name: 'Workspaces', level: 1 }))
      .toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Disconnect' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      /connection to this remote computer was lost/i
    );
    expect(screen.getByRole('heading', { name: 'Workspaces', level: 1 }))
      .toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reconnect' })).toBeInTheDocument();
  });
  it('connects its bound target with an ephemeral password and exposes no local controls', async () => {
    const api = {
      listRemoteTargets: vi.fn().mockResolvedValue([summary]),
      connectRemoteTarget: vi.fn().mockResolvedValue({
        ...summary,
        target: {
          ...summary.target,
          connectionState: 'ready',
          helperVersion: '0.2.0',
          protocolVersion: 1,
          capabilities: ['provider-scan']
        },
        homeDirectory: '/home/builder',
        defaultShell: '/bin/bash'
      }),
      disconnectRemoteTarget: vi.fn(),
      getRemoteProviderPreferences: vi.fn().mockResolvedValue({
        enabledProviders: ['codex']
      }),
      scanRemoteDiscovery: vi.fn().mockResolvedValue(discovery)
    } as unknown as LumoraApi;

    render(<RemoteTargetWindow executionTargetId={TARGET_ID} api={api} />);
    expect(await screen.findByRole('heading', { name: 'Linux build server' }))
      .toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('SSH password'), {
      target: { value: 'memory-only' }
    });
    const connect = screen.getByRole('button', { name: 'Connect' });
    expect(connect).toHaveClass('refresh-button');
    fireEvent.click(connect);

    await waitFor(() => expect(api.connectRemoteTarget).toHaveBeenCalledWith({
      executionTargetId: TARGET_ID,
      credentials: { method: 'password', password: 'memory-only' }
    }));
    expect(await screen.findByTestId('lumora-shell')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    fireEvent.click(screen.getByRole('tab', { name: 'Environment' }));
    expect(await screen.findByText('v24.0.0')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: 'Security' }));
    expect(await screen.findByText('/home/builder')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Terminal profiles' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Remote computers' })).not.toBeInTheDocument();
  });

  it('shows a safe actionable connection-stage failure without raw diagnostics', async () => {
    const failure = new Error(
      "Error invoking remote method 'lumora:targets:connect': Error: " +
      'REMOTE_TARGET_PLATFORM_PROBE_FAILED: Lumora could not complete the remote-target operation.'
    );
    const api = {
      listRemoteTargets: vi.fn().mockResolvedValue([summary]),
      connectRemoteTarget: vi.fn().mockRejectedValue(failure)
    } as unknown as LumoraApi;

    render(<RemoteTargetWindow executionTargetId={TARGET_ID} api={api} />);
    fireEvent.change(await screen.findByLabelText('SSH password'), {
      target: { value: 'memory-only' }
    });
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }));

    expect(await screen.findByText(
      'SSH connected, but Lumora could not identify the remote operating system. Check that the account can run non-interactive shell commands.'
    )).toBeInTheDocument();
    expect(screen.queryByText(/private\/remote\/path/)).not.toBeInTheDocument();
  });

  it('requires host verification in the local window before authentication', async () => {
    const api = {
      listRemoteTargets: vi.fn().mockResolvedValue([{
        ...summary,
        profile: { ...summary.profile, verifiedHostFingerprint: null }
      }])
    } as unknown as LumoraApi;

    render(<RemoteTargetWindow executionTargetId={TARGET_ID} api={api} />);
    expect(await screen.findByText(/verify this computer in the local Lumora window/i))
      .toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Connect' })).toBeDisabled();
  });

  it('confirms a missing helper inside Lumora before target-scoped installation', async () => {
    const pendingDetails = {
      ...summary,
      target: { ...summary.target, connectionState: 'helper-missing' as const },
      homeDirectory: '/home/builder',
      defaultShell: '/bin/bash'
    };
    const api = {
      listRemoteTargets: vi.fn().mockResolvedValue([summary]),
      connectRemoteTarget: vi.fn().mockResolvedValue(pendingDetails),
      getRemoteHelperInstallDetails: vi.fn().mockResolvedValue({
        status: 'missing',
        helperVersion: '0.1.0',
        installLocation: '/home/builder/.local/share/lumora/helper/lumora-helper',
        requiresConfirmation: true
      }),
      installRemoteHelper: vi.fn().mockResolvedValue({
        ...pendingDetails,
        target: {
          ...pendingDetails.target,
          connectionState: 'ready', helperVersion: '0.1.0', protocolVersion: 1
        }
      }),
      disconnectRemoteTarget: vi.fn(),
      getRemoteProviderPreferences: vi.fn().mockResolvedValue({
        enabledProviders: ['codex']
      }),
      scanRemoteDiscovery: vi.fn().mockResolvedValue(discovery)
    } as unknown as LumoraApi;

    render(<RemoteTargetWindow executionTargetId={TARGET_ID} api={api} />);
    fireEvent.change(await screen.findByLabelText('SSH password'), {
      target: { value: 'memory-only' }
    });
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }));

    const open = await screen.findByRole('button', { name: 'Install Lumora helper' });
    expect(screen.queryByLabelText('SSH password')).not.toBeInTheDocument();
    fireEvent.click(open);
    let dialog = screen.getByRole('dialog', { name: 'Install Lumora helper' });
    expect(dialog).toHaveClass('new-session-dialog');
    expect(within(dialog).getByText('0.1.0')).toBeInTheDocument();
    expect(within(dialog).getByText(/\.local\/share\/lumora\/helper/)).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(api.installRemoteHelper).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Install Lumora helper' }));
    dialog = screen.getByRole('dialog', { name: 'Install Lumora helper' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Install helper' }));
    await waitFor(() => expect(api.installRemoteHelper).toHaveBeenCalledWith());
    expect(await screen.findByTestId('lumora-shell')).toBeInTheDocument();
    expect(screen.getByText('SSH helper connected')).toBeInTheDocument();
  });

  it('saves target-scoped provider choices and rescans without install controls', async () => {
    const readySummary = {
      ...summary,
      target: {
        ...summary.target,
        connectionState: 'ready' as const,
        helperVersion: '0.2.0',
        protocolVersion: 1,
        capabilities: ['provider-scan' as const]
      }
    };
    const api = {
      listRemoteTargets: vi.fn().mockResolvedValue([readySummary]),
      getRemoteProviderPreferences: vi.fn().mockResolvedValue({
        enabledProviders: ['codex']
      }),
      saveRemoteProviderPreferences: vi.fn().mockResolvedValue({
        enabledProviders: ['codex', 'opencode']
      }),
      scanRemoteDiscovery: vi.fn().mockResolvedValue(discovery),
      disconnectRemoteTarget: vi.fn()
    } as unknown as LumoraApi;

    render(<RemoteTargetWindow executionTargetId={TARGET_ID} api={api} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Settings' }));
    expect(await screen.findByRole('tab', { name: 'Providers' })).toHaveAttribute(
      'aria-selected',
      'true'
    );
    expect(await screen.findByText('codex 1.2.3')).toBeInTheDocument();
    expect(screen.getByText(/install or repair CLIs directly on the remote computer/i))
      .toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /install/i })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    await waitFor(() => expect(api.scanRemoteDiscovery).toHaveBeenCalledTimes(2));
    const openCodeSwitch = screen.getByRole('switch', { name: 'Enable OpenCode' });
    expect(openCodeSwitch.closest('.settings-switch')).not.toBeNull();
    fireEvent.click(openCodeSwitch);
    fireEvent.click(screen.getByRole('button', { name: 'Save and scan' }));

    await waitFor(() => expect(api.saveRemoteProviderPreferences)
      .toHaveBeenCalledWith({ enabledProviders: ['codex', 'opencode'] }));
    expect(api.scanRemoteDiscovery).toHaveBeenCalledTimes(3);
  });

  it('loads a read-only remote catalog for the shared catalog routes', async () => {
    const readySummary = {
      ...summary,
      target: {
        ...summary.target,
        connectionState: 'ready' as const,
        helperVersion: '0.3.0',
        protocolVersion: 1,
        capabilities: ['provider-scan' as const, 'session-scan' as const]
      }
    };
    const api = {
      listRemoteTargets: vi.fn().mockResolvedValue([readySummary]),
      getRemoteProviderPreferences: vi.fn().mockResolvedValue({
        enabledProviders: ['codex', 'opencode']
      }),
      scanRemoteDiscovery: vi.fn().mockResolvedValue(discovery),
      scanRemoteSessions: vi.fn().mockResolvedValue({
        executionTargetId: TARGET_ID,
        scannedAt: '2026-08-05T04:03:02.000Z',
        sessions: [{
          provider: 'opencode',
          nativeId: 'session-1',
          workspacePath: '/srv/lumora',
          title: 'Repair release workflow',
          createdAt: '2026-08-05T01:00:00.000Z',
          updatedAt: '2026-08-05T04:00:00.000Z',
          lifetimeTokens: 12500
        }],
        providers: [{
          provider: 'codex', status: 'unsupported', sessionCount: 0, invalidCount: 0
        }, {
          provider: 'opencode', status: 'ready', sessionCount: 1, invalidCount: 0
        }],
        snapshot: {
          refreshedAt: '2026-08-05T04:03:02.000Z',
          workspaces: [{
            id: 'a'.repeat(64),
            displayName: 'lumora',
            canonicalPath: '/srv/lumora',
            available: true,
            origin: 'discovered',
            sessionCount: 1,
            providerCounts: { opencode: 1 },
            lastActivityAt: '2026-08-05T04:00:00.000Z'
          }],
          sessions: [{
            id: 'b'.repeat(64),
            nativeId: 'session-1',
            provider: 'opencode',
            workspaceId: 'a'.repeat(64),
            title: 'Repair release workflow',
            createdAt: '2026-08-05T01:00:00.000Z',
            updatedAt: '2026-08-05T04:00:00.000Z',
            lifetimeTokens: 12500,
            lifecycle: 'saved',
            sourceFreshness: 'current'
          }],
          providerStatus: [{
            provider: 'codex', state: 'unavailable', discoveredCount: 0,
            unchangedCount: 0, invalidCount: 0
          }, {
            provider: 'opencode', state: 'ready', discoveredCount: 1,
            unchangedCount: 0, invalidCount: 0
          }],
          providerFacets: [{ provider: 'opencode', sessionCount: 1 }],
          diagnostics: [{
            code: 'CATALOG_PROVIDER_INCOMPATIBLE',
            provider: 'codex',
            affectedCount: 0,
            message: 'Codex remote catalog support is pending.',
            recovery: 'Use a supported provider on this remote computer.',
            retryable: false,
            scannedAt: '2026-08-05T04:03:02.000Z'
          }]
        }
      }),
      disconnectRemoteTarget: vi.fn()
    } as unknown as LumoraApi;

    render(<RemoteTargetWindow executionTargetId={TARGET_ID} api={api} />);
    await waitFor(() => expect(api.scanRemoteSessions).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole('button', { name: 'All sessions' }));

    expect(await screen.findByText('Repair release workflow')).toBeInTheDocument();
    expect(screen.getByText('lumora')).toBeInTheDocument();
    expect(screen.getByText('12.5K tokens')).toBeInTheDocument();
    expect(screen.getByText(/Codex remote catalog support is pending/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Refresh catalog' }));
    await waitFor(() => expect(api.scanRemoteSessions).toHaveBeenCalledTimes(2));
  });

  it('opens the shared new-session workflow with target-owned profiles and IPC', async () => {
    const readySummary = {
      ...summary,
      target: {
        ...summary.target,
        connectionState: 'ready' as const,
        helperVersion: '0.3.1',
        protocolVersion: 1,
        capabilities: ['provider-scan' as const, 'session-scan' as const]
      }
    };
    const workspace = {
      id: 'a'.repeat(64),
      displayName: 'lumora',
      canonicalPath: '/srv/lumora',
      available: true,
      origin: 'discovered' as const,
      sessionCount: 0,
      providerCounts: {},
      lastActivityAt: null
    };
    const profile = {
      id: 'c'.repeat(64),
      kind: 'detected' as const,
      name: 'Remote SSH PTY',
      shellFamily: 'bash' as const,
      executablePath: '/bin/bash',
      args: [],
      available: true,
      recommended: true
    };
    const prepareLaunch = vi.fn(() => new Promise(() => undefined));
    const api = {
      ...runtimeApiDefaults(),
      listRemoteTargets: vi.fn().mockResolvedValue([readySummary]),
      getRemoteProviderPreferences: vi.fn().mockResolvedValue({
        enabledProviders: ['codex']
      }),
      scanRemoteDiscovery: vi.fn().mockResolvedValue(discovery),
      scanRemoteSessions: vi.fn().mockResolvedValue({
        executionTargetId: TARGET_ID,
        scannedAt: '2026-08-05T04:03:02.000Z',
        sessions: [],
        providers: [{
          provider: 'codex', status: 'ready', sessionCount: 0, invalidCount: 0
        }],
        snapshot: {
          refreshedAt: '2026-08-05T04:03:02.000Z',
          workspaces: [workspace], sessions: [],
          providerStatus: [{
            provider: 'codex', state: 'ready', discoveredCount: 0,
            unchangedCount: 0, invalidCount: 0
          }],
          providerFacets: [], diagnostics: []
        }
      }),
      getTerminalProfiles: vi.fn().mockResolvedValue([profile]),
      listRuntimes: vi.fn().mockResolvedValue([]),
      getGeneralSettings: vi.fn().mockResolvedValue({
        enabledProviders: ['codex']
      }),
      onRuntimeEvent: vi.fn(() => () => undefined),
      prepareLaunch
    } as unknown as LumoraApi;

    render(<RemoteTargetWindow executionTargetId={TARGET_ID} api={api} />);

    fireEvent.click(await screen.findByRole('button', { name: 'New session' }));
    expect(await screen.findByRole('dialog', { name: 'New session' }))
      .toBeInTheDocument();
    await waitFor(() => expect(prepareLaunch).toHaveBeenCalledWith({
      strategy: 'new',
      workspaceId: workspace.id,
      provider: 'codex',
      startPrompt: '',
      terminalProfileId: null,
      cols: 100,
      rows: 30
    }));
  });

  it('opens an exact same-provider remote resume through the shared workflow', async () => {
    const readySummary = {
      ...summary,
      target: {
        ...summary.target,
        connectionState: 'ready' as const,
        helperVersion: '0.3.1',
        protocolVersion: 1,
        capabilities: ['provider-scan' as const, 'session-scan' as const]
      }
    };
    const workspace = {
      id: 'a'.repeat(64),
      displayName: 'lumora',
      canonicalPath: '/srv/lumora',
      available: true,
      origin: 'discovered' as const,
      sessionCount: 1,
      providerCounts: { codex: 1 },
      lastActivityAt: '2026-08-05T04:00:00.000Z'
    };
    const session = {
      id: 'b'.repeat(64),
      nativeId: 'codex-remote-session',
      provider: 'codex' as const,
      workspaceId: workspace.id,
      title: 'Resume this remote session',
      createdAt: '2026-08-05T01:00:00.000Z',
      updatedAt: '2026-08-05T04:00:00.000Z',
      lifetimeTokens: 12_500,
      lifecycle: 'saved' as const,
      sourceFreshness: 'current' as const
    };
    const profile = {
      id: 'c'.repeat(64),
      kind: 'detected' as const,
      name: 'Remote SSH PTY',
      shellFamily: 'bash' as const,
      executablePath: '/bin/bash',
      args: [],
      available: true,
      recommended: true
    };
    const prepareLaunch = vi.fn(() => new Promise(() => undefined));
    const api = {
      ...runtimeApiDefaults(),
      listRemoteTargets: vi.fn().mockResolvedValue([readySummary]),
      getRemoteProviderPreferences: vi.fn().mockResolvedValue({
        enabledProviders: ['codex']
      }),
      scanRemoteDiscovery: vi.fn().mockResolvedValue(discovery),
      scanRemoteSessions: vi.fn().mockResolvedValue({
        executionTargetId: TARGET_ID,
        scannedAt: '2026-08-05T04:03:02.000Z',
        sessions: [{
          provider: session.provider,
          nativeId: session.nativeId,
          workspacePath: workspace.canonicalPath,
          title: session.title,
          createdAt: session.createdAt,
          updatedAt: session.updatedAt,
          lifetimeTokens: session.lifetimeTokens
        }],
        providers: [{
          provider: 'codex', status: 'ready', sessionCount: 1, invalidCount: 0
        }],
        snapshot: {
          refreshedAt: '2026-08-05T04:03:02.000Z',
          workspaces: [workspace],
          sessions: [session],
          providerStatus: [{
            provider: 'codex', state: 'ready', discoveredCount: 1,
            unchangedCount: 0, invalidCount: 0
          }],
          providerFacets: [{ provider: 'codex', sessionCount: 1 }],
          diagnostics: []
        }
      }),
      getTerminalProfiles: vi.fn().mockResolvedValue([profile]),
      getGeneralSettings: vi.fn().mockResolvedValue({
        enabledProviders: ['codex'],
        crossAgentWorkflowEnabled: false
      }),
      prepareLaunch
    } as unknown as LumoraApi;

    render(<RemoteTargetWindow executionTargetId={TARGET_ID} api={api} />);

    fireEvent.click(await screen.findByRole('button', { name: 'All sessions' }));
    fireEvent.click(await screen.findByRole('button', {
      name: `Resume ${session.title}`
    }));
    expect(await screen.findByRole('dialog', { name: 'Resume session' }))
      .toBeInTheDocument();
    await waitFor(() => expect(prepareLaunch).toHaveBeenCalledWith({
      strategy: 'resume',
      sessionId: session.id,
      startPrompt: '',
      terminalProfileId: null,
      cols: 100,
      rows: 30
    }));
  });

  it('stores custom provider commands in the remote target launch settings', async () => {
    const readySummary = {
      ...summary,
      target: {
        ...summary.target,
        connectionState: 'ready' as const,
        helperVersion: '0.3.1',
        protocolVersion: 1,
        capabilities: ['provider-scan' as const, 'session-scan' as const]
      }
    };
    const saveLaunchSettingsLayer = vi.fn().mockResolvedValue([]);
    const api = {
      ...runtimeApiDefaults(),
      listRemoteTargets: vi.fn().mockResolvedValue([readySummary]),
      getRemoteProviderPreferences: vi.fn().mockResolvedValue({
        enabledProviders: ['codex']
      }),
      scanRemoteDiscovery: vi.fn().mockResolvedValue(discovery),
      getLaunchSettingsLayers: vi.fn().mockResolvedValue([]),
      saveLaunchSettingsLayer
    } as unknown as LumoraApi;

    render(<RemoteTargetWindow executionTargetId={TARGET_ID} api={api} />);

    fireEvent.click(await screen.findByRole('button', { name: 'Settings' }));
    fireEvent.click(screen.getByRole('tab', { name: 'Launch' }));
    await screen.findByText('Launch defaults');
    fireEvent.change(screen.getByLabelText('Codex command mode'), {
      target: { value: 'custom' }
    });
    fireEvent.change(screen.getByLabelText('Codex command'), {
      target: { value: 'codexp --remote-profile' }
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save launch settings' }));

    await waitFor(() => expect(saveLaunchSettingsLayer).toHaveBeenCalledWith({
      scope: 'global',
      targetId: 'global',
      settings: {
        providerCommands: { codex: 'codexp --remote-profile' }
      }
    }));
  });

  it('captures Lumora navigation shortcuts before remote PTY input', async () => {
    const readySummary = {
      ...summary,
      target: {
        ...summary.target,
        connectionState: 'ready' as const,
        helperVersion: '0.3.1',
        protocolVersion: 1,
        capabilities: ['provider-scan' as const, 'session-scan' as const]
      }
    };
    const api = {
      ...runtimeApiDefaults(),
      listRemoteTargets: vi.fn().mockResolvedValue([readySummary]),
      getRemoteProviderPreferences: vi.fn().mockResolvedValue({
        enabledProviders: ['codex']
      }),
      scanRemoteDiscovery: vi.fn().mockResolvedValue(discovery),
      scanRemoteSessions: vi.fn().mockResolvedValue({
        executionTargetId: TARGET_ID,
        scannedAt: '2026-08-05T04:03:02.000Z',
        sessions: [], providers: [],
        snapshot: {
          refreshedAt: '2026-08-05T04:03:02.000Z',
          workspaces: [], sessions: [], providerStatus: [],
          providerFacets: [], diagnostics: []
        }
      }),
      getKeyboardSettings: vi.fn().mockResolvedValue(DEFAULT_KEYBOARD_SETTINGS)
    } as unknown as LumoraApi;

    render(<RemoteTargetWindow executionTargetId={TARGET_ID} api={api} />);
    await screen.findByRole('heading', { name: 'Home', level: 1 });
    await waitFor(() => expect(api.getKeyboardSettings).toHaveBeenCalledOnce());
    const ptyInput = document.createElement('textarea');
    ptyInput.className = 'xterm-helper-textarea';
    document.body.append(ptyInput);

    fireEvent.keyDown(ptyInput, {
      code: 'Digit3', key: '3', ctrlKey: true
    });

    expect(await screen.findByRole('heading', {
      name: 'All sessions', level: 1
    })).toBeInTheDocument();
    ptyInput.remove();
  });

  it('keeps connected pages stable and explains when the helper cannot scan yet', async () => {
    const readyWithoutDiscovery = {
      ...summary,
      target: {
        ...summary.target,
        connectionState: 'ready' as const,
        helperVersion: '0.1.0',
        protocolVersion: 1,
        capabilities: []
      }
    };
    const api = {
      listRemoteTargets: vi.fn().mockResolvedValue([readyWithoutDiscovery]),
      getRemoteProviderPreferences: vi.fn().mockResolvedValue({
        enabledProviders: ['codex']
      }),
      scanRemoteDiscovery: vi.fn(),
      disconnectRemoteTarget: vi.fn()
    } as unknown as LumoraApi;

    render(<RemoteTargetWindow executionTargetId={TARGET_ID} api={api} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Settings' }));
    fireEvent.click(screen.getByRole('tab', { name: 'Environment' }));

    expect(await screen.findByText(/helper cannot scan providers yet/i))
      .toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Refresh' })).toBeDisabled();
    expect(api.scanRemoteDiscovery).not.toHaveBeenCalled();
  });
});
