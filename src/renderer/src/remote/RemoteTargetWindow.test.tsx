import { act, fireEvent, render as rtlRender, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import {
  DEFAULT_GENERAL_SETTINGS,
  DEFAULT_KEYBOARD_SETTINGS,
  type LumoraApi,
  type RemoteLifecycleEvent,
  type RuntimeSummary
} from '../../../shared/contracts';
import { RemoteTargetWindow } from './RemoteTargetWindow';
import {
  renderWithLocalization,
  TEST_LOCALIZATION_SNAPSHOT,
  TestLocalizationProvider
} from '../test/render-with-localization';

const render = renderWithLocalization;

vi.mock('../terminal/ManagedTerminal', () => ({
  ManagedTerminal: ({ runtime }: { runtime: { displayName: string } }) => (
    <div aria-label={`${runtime.displayName} terminal content`} />
  )
}));

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
    ...providerApiDefaults(),
    getTerminalProfiles: vi.fn().mockResolvedValue([]),
    listRuntimes: vi.fn().mockResolvedValue([]),
    getGeneralSettings: vi.fn().mockResolvedValue({
      enabledProviders: ['codex']
    }),
    getKeyboardSettings: vi.fn().mockResolvedValue(DEFAULT_KEYBOARD_SETTINGS),
    onGeneralSettingsChanged: vi.fn(() => () => undefined),
    onRuntimeEvent: vi.fn(() => () => undefined),
    prepareLaunch: vi.fn(() => new Promise(() => undefined)),
    trustWorkspaceForLaunch: vi.fn().mockResolvedValue({}),
    startRuntime: vi.fn()
  };
}

function providerApiDefaults() {
  return {
    getProviderLaunchConfigs: vi.fn().mockResolvedValue([]),
    saveProviderLaunchConfig: vi.fn().mockResolvedValue([]),
    checkProviderUpdates: vi.fn().mockResolvedValue({
      checkedAt: '2026-08-05T04:03:02.000Z',
      providers: []
    }),
    installProvider: vi.fn().mockResolvedValue({
      outcome: 'completed',
      result: {
        provider: 'codex',
        completedAt: '2026-08-05T04:03:02.000Z',
        installation: {
          provider: 'codex', displayName: 'Codex', state: 'ready',
          executablePath: '/usr/bin/codex', version: '1.0.0', issue: null
        }
      }
    }),
    updateProvider: vi.fn().mockResolvedValue({
      outcome: 'completed',
      result: {
        provider: 'codex',
        completedAt: '2026-08-05T04:03:02.000Z',
        installation: {
          provider: 'codex', displayName: 'Codex', state: 'ready',
          executablePath: '/usr/bin/codex', version: '1.0.0', issue: null
        }
      }
    }),
    openProviderInstallGuide: vi.fn().mockResolvedValue(undefined),
    getWorkspaceTrustDecisions: vi.fn().mockResolvedValue([]),
    revokeWorkspaceTrust: vi.fn().mockResolvedValue([])
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => { resolve = complete; });
  return { promise, resolve };
}

describe('RemoteTargetWindow', () => {
  it('updates an already-open remote window when the active language changes', async () => {
    const api = {
      ...providerApiDefaults(),
      listRemoteTargets: vi.fn().mockResolvedValue([summary]),
      getRemoteCredentialStatus: vi.fn().mockResolvedValue({
        executionTargetId: TARGET_ID,
        storageState: 'available',
        credentialState: 'none',
        autoConnect: false
      })
    } as unknown as LumoraApi;
    const japanese = {
      ...TEST_LOCALIZATION_SNAPSHOT,
      revision: 2,
      locale: 'ja',
      formattingLocale: 'ja-JP',
      messages: {
        ...TEST_LOCALIZATION_SNAPSHOT.messages,
        'remote.window.isolated-target': 'リモート Lumora・独立した接続先',
        'remote.authentication.ssh-password': 'SSH パスワード'
      }
    } as const;
    const view = <RemoteTargetWindow executionTargetId={TARGET_ID} api={api} />;
    const { rerender } = rtlRender(
      <TestLocalizationProvider>{view}</TestLocalizationProvider>
    );
    expect(await screen.findByText('Remote Lumora · isolated target'))
      .toBeInTheDocument();

    rerender(
      <TestLocalizationProvider snapshot={japanese}>{view}</TestLocalizationProvider>
    );

    expect(screen.getByText('リモート Lumora・独立した接続先')).toBeInTheDocument();
    expect(screen.getByLabelText('SSH パスワード')).toBeInTheDocument();
    expect(api.listRemoteTargets).toHaveBeenCalledOnce();
  });
  it('hydrates a kept connection from lifecycle cache without rescanning', async () => {
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
    const catalog = {
      executionTargetId: TARGET_ID,
      scannedAt: '2026-08-11T05:00:00.000Z',
      sessions: [],
      providers: [],
      snapshot: {
        refreshedAt: '2026-08-11T05:00:00.000Z',
        workspaces: [], sessions: [], providerStatus: [],
        providerFacets: [], diagnostics: []
      }
    } as const;
    const scanRemoteDiscovery = vi.fn();
    const scanRemoteSessions = vi.fn();
    const api = {
      ...runtimeApiDefaults(),
      listRemoteLifecycleSnapshots: vi.fn().mockResolvedValue([{
        summary: readySummary,
        generation: 1,
        discovery,
        catalog,
        discoveryState: 'ready',
        catalogState: 'ready',
        activeTerminalCount: 0
      }]),
      listRemoteTargets: vi.fn().mockResolvedValue([readySummary]),
      onRemoteLifecycleEvent: vi.fn(() => () => undefined),
      getRemoteProviderPreferences: vi.fn().mockResolvedValue({
        enabledProviders: ['codex']
      }),
      scanRemoteDiscovery,
      scanRemoteSessions
    } as unknown as LumoraApi;

    render(<RemoteTargetWindow executionTargetId={TARGET_ID} api={api} />);
    await screen.findByTestId('lumora-shell');
    await waitFor(() => expect(api.getRemoteProviderPreferences).toHaveBeenCalled());

    expect(api.listRemoteTargets).not.toHaveBeenCalled();
    expect(scanRemoteDiscovery).not.toHaveBeenCalled();
    expect(scanRemoteSessions).not.toHaveBeenCalled();
  });

  it('opens remote Provider Settings from verified Home update information', async () => {
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
    const catalog = {
      executionTargetId: TARGET_ID,
      scannedAt: '2026-08-11T05:00:00.000Z',
      sessions: [],
      providers: [],
      snapshot: {
        refreshedAt: '2026-08-11T05:00:00.000Z',
        workspaces: [], sessions: [], providerStatus: [],
        providerFacets: [], diagnostics: []
      }
    } as const;
    const checkProviderUpdates = vi.fn().mockResolvedValue({
      checkedAt: '2026-08-24T01:00:00.000Z',
      providers: [{
        provider: 'codex',
        displayName: 'Codex',
        state: 'update_available',
        installedVersion: '1.2.3',
        latestVersion: '1.3.0',
        issue: null
      }]
    });
    const api = {
      ...runtimeApiDefaults(),
      checkProviderUpdates,
      listRemoteLifecycleSnapshots: vi.fn().mockResolvedValue([{
        summary: readySummary,
        generation: 1,
        discovery,
        catalog,
        discoveryState: 'ready',
        catalogState: 'ready',
        activeTerminalCount: 0
      }]),
      listRemoteTargets: vi.fn().mockResolvedValue([readySummary]),
      onRemoteLifecycleEvent: vi.fn(() => () => undefined),
      getRemoteProviderPreferences: vi.fn().mockResolvedValue({
        enabledProviders: ['codex']
      })
    } as unknown as LumoraApi;

    render(<RemoteTargetWindow executionTargetId={TARGET_ID} api={api} />);
    fireEvent.click(await screen.findByRole('button', {
      name: '1 agent update available: Codex. Open Provider Settings'
    }));

    expect(await screen.findByRole('heading', {
      name: 'Settings', level: 1
    })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Providers' })).toHaveAttribute(
      'aria-selected',
      'true'
    );
    expect(checkProviderUpdates).toHaveBeenCalledOnce();
  });

  it('warns before closing a disconnecting window with active terminals', async () => {
    let closeListener: ((request: {
      executionTargetId: typeof TARGET_ID;
      activeTerminalCount: number;
    }) => void) | undefined;
    const resolveRemoteWindowClose = vi.fn().mockResolvedValue(true);
    const readySummary = {
      ...summary,
      target: {
        ...summary.target,
        connectionState: 'ready' as const,
        helperVersion: '0.3.1',
        protocolVersion: 1
      }
    };
    const api = {
      ...runtimeApiDefaults(),
      listRemoteTargets: vi.fn().mockResolvedValue([readySummary]),
      getRemoteProviderPreferences: vi.fn().mockResolvedValue({
        enabledProviders: ['codex']
      }),
      onRemoteWindowCloseRequest: vi.fn((listener) => {
        closeListener = listener;
        return () => undefined;
      }),
      resolveRemoteWindowClose
    } as unknown as LumoraApi;
    render(<RemoteTargetWindow executionTargetId={TARGET_ID} api={api} />);
    await screen.findByText('Linux build server');

    act(() => closeListener?.({
      executionTargetId: TARGET_ID,
      activeTerminalCount: 2
    }));
    const dialog = screen.getByRole('dialog', {
      name: 'Disconnect remote computer?'
    });
    expect(within(dialog).getByText(/2 active terminal sessions/)).toBeVisible();
    fireEvent.click(within(dialog).getByRole('checkbox', {
      name: "Don't show this warning again"
    }));
    fireEvent.click(within(dialog).getByRole('button', {
      name: 'Disconnect and close'
    }));

    await waitFor(() => expect(resolveRemoteWindowClose).toHaveBeenCalledWith({
      action: 'disconnect',
      suppressFutureWarning: true
    }));
  });

  it('waits for remote discovery before scanning sessions on the shared helper channel', async () => {
    const discoveryPending = deferred<typeof discovery>();
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
      scanRemoteDiscovery: vi.fn(() => discoveryPending.promise),
      scanRemoteSessions: vi.fn().mockResolvedValue({
        executionTargetId: TARGET_ID,
        scannedAt: '2026-08-05T04:03:02.000Z',
        sessions: [], providers: [],
        snapshot: {
          refreshedAt: '2026-08-05T04:03:02.000Z',
          workspaces: [], sessions: [], providerStatus: [],
          providerFacets: [], diagnostics: []
        }
      })
    } as unknown as LumoraApi;

    render(<RemoteTargetWindow executionTargetId={TARGET_ID} api={api} />);

    await waitFor(() => expect(api.scanRemoteDiscovery).toHaveBeenCalledOnce());
    expect(api.scanRemoteSessions).not.toHaveBeenCalled();

    discoveryPending.resolve(discovery);
    await waitFor(() => expect(api.scanRemoteSessions).toHaveBeenCalledOnce());
  });

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
    const primaryNavigation = screen.getByRole('navigation', {
      name: 'Primary navigation'
    });
    const applicationNavigation = screen.getByRole('navigation', {
      name: 'Application'
    });
    expect(within(primaryNavigation).queryByRole('button', {
      name: 'Settings'
    })).not.toBeInTheDocument();
    expect(within(applicationNavigation).getByRole('button', {
      name: 'Settings'
    })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Terminal profiles' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Remote computers' })).not.toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'Overview' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Collapse sidebar' }));
    expect(screen.getByTestId('lumora-shell')).toHaveClass('sidebar-collapsed');
    fireEvent.click(screen.getByRole('button', { name: 'Workspaces' }));
    expect(screen.getByTestId('lumora-shell')).not.toHaveClass('sidebar-collapsed');
  });

  it('keeps hidden workspace policies isolated in the remote window', async () => {
    const workspaceId = 'a'.repeat(64);
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
    const catalog = {
      executionTargetId: TARGET_ID,
      scannedAt: '2026-08-12T01:00:00.000Z',
      sessions: [], providers: [],
      snapshot: {
        refreshedAt: '2026-08-12T01:00:00.000Z',
        workspaces: [{
          id: workspaceId,
          displayName: 'Remote project',
          canonicalPath: '/srv/remote-project',
          available: true,
          origin: 'discovered' as const,
          sessionCount: 0,
          providerCounts: {},
          lastActivityAt: null
        }],
        sessions: [], providerStatus: [], providerFacets: [], diagnostics: []
      }
    };
    const policy = {
      workspaceId,
      mode: 'workspace_only' as const,
      updatedAt: '2026-08-12T01:01:00.000Z'
    };
    const setWorkspaceVisibilityPolicy = vi.fn().mockResolvedValue([policy]);
    const api = {
      ...runtimeApiDefaults(),
      listRemoteLifecycleSnapshots: vi.fn().mockResolvedValue([{
        summary: readySummary,
        generation: 1,
        discovery,
        catalog,
        discoveryState: 'ready',
        catalogState: 'ready',
        activeTerminalCount: 0
      }]),
      onRemoteLifecycleEvent: vi.fn(() => () => undefined),
      getRemoteProviderPreferences: vi.fn().mockResolvedValue({
        enabledProviders: ['codex']
      }),
      getWorkspaceVisibilityPolicies: vi.fn().mockResolvedValue([]),
      setWorkspaceVisibilityPolicy
    } as unknown as LumoraApi;

    render(<RemoteTargetWindow executionTargetId={TARGET_ID} api={api} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Workspaces' }));
    expect(await screen.findByRole('heading', { name: 'Remote project' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'More actions for Remote project' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Hide workspace' }));
    fireEvent.click(within(screen.getByRole('dialog', {
      name: 'Hide Remote project'
    })).getByRole('button', { name: 'Hide workspace' }));

    await waitFor(() => expect(setWorkspaceVisibilityPolicy).toHaveBeenCalledWith({
      workspaceId,
      mode: 'workspace_only'
    }));
    expect(screen.queryByRole('heading', { name: 'Remote project' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Hidden workspaces (1)' })).toBeVisible();
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
      ...providerApiDefaults(),
      listRemoteTargets: vi.fn().mockResolvedValue([summary]),
      getRemoteCredentialStatus: vi.fn().mockResolvedValue({
        executionTargetId: TARGET_ID,
        storageState: 'available',
        credentialState: 'none',
        autoConnect: false
      }),
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
      mode: 'manual',
      credentials: { method: 'password', password: 'memory-only' },
      rememberCredential: false
    }));
    expect(await screen.findByTestId('lumora-shell')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    fireEvent.click(screen.getByRole('tab', { name: 'Environment' }));
    expect(await screen.findByText('v24.0.0')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: 'Security' }));
    expect(await screen.findByRole('switch', {
      name: 'Automatically trust workspaces when launching'
    })).toBeInTheDocument();
    expect(screen.getByText('No workspaces are trusted.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Terminal profiles' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Remote computers' })).not.toBeInTheDocument();
  });

  it('releases the connection action after SSH succeeds while credential status refresh is pending', async () => {
    const credentialRefresh = deferred<never>();
    const api = {
      ...runtimeApiDefaults(),
      listRemoteTargets: vi.fn().mockResolvedValue([summary]),
      getRemoteCredentialStatus: vi.fn()
        .mockResolvedValueOnce({
          executionTargetId: TARGET_ID,
          storageState: 'available',
          credentialState: 'none',
          autoConnect: false
        })
        .mockImplementation(() => credentialRefresh.promise),
      connectRemoteTarget: vi.fn().mockResolvedValue({
        ...summary,
        target: {
          ...summary.target,
          connectionState: 'ready',
          helperVersion: '0.3.1',
          protocolVersion: 1,
          capabilities: []
        },
        homeDirectory: '/home/builder',
        defaultShell: '/bin/bash'
      }),
      getRemoteProviderPreferences: vi.fn().mockResolvedValue({
        enabledProviders: ['codex']
      })
    } as unknown as LumoraApi;

    render(<RemoteTargetWindow executionTargetId={TARGET_ID} api={api} />);
    fireEvent.change(await screen.findByLabelText('SSH password'), {
      target: { value: 'memory-only' }
    });
    await waitFor(() => expect(api.getRemoteCredentialStatus).toHaveBeenCalledOnce());
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }));

    await screen.findByTestId('lumora-shell');
    expect(screen.queryByRole('button', { name: 'Disconnecting…' }))
      .not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Disconnect' })).toBeEnabled();
  });

  it('remembers a password and enables auto-connect only after manual success', async () => {
    const connected = {
      ...summary,
      target: { ...summary.target, connectionState: 'ready' as const },
      homeDirectory: '/home/builder',
      defaultShell: '/bin/bash'
    };
    const api = {
      ...providerApiDefaults(),
      listRemoteTargets: vi.fn().mockResolvedValue([summary]),
      getRemoteCredentialStatus: vi.fn().mockResolvedValue({
        executionTargetId: TARGET_ID,
        storageState: 'available',
        credentialState: 'none',
        autoConnect: false
      }),
      connectRemoteTarget: vi.fn().mockResolvedValue(connected),
      setRemoteAutoConnect: vi.fn().mockResolvedValue({
        executionTargetId: TARGET_ID,
        storageState: 'available',
        credentialState: 'remembered',
        autoConnect: true
      }),
      getRemoteProviderPreferences: vi.fn().mockResolvedValue({
        enabledProviders: ['codex']
      }),
      scanRemoteDiscovery: vi.fn().mockResolvedValue(discovery)
    } as unknown as LumoraApi;

    render(<RemoteTargetWindow executionTargetId={TARGET_ID} api={api} />);
    fireEvent.change(await screen.findByLabelText('SSH password'), {
      target: { value: 'memory-only' }
    });
    const remember = screen.getByRole('switch', { name: 'Remember password' });
    const automatic = screen.getByRole('switch', {
      name: 'Connect automatically'
    });
    expect(remember).not.toBeChecked();
    expect(automatic).toBeDisabled();
    fireEvent.click(remember);
    expect(automatic).not.toBeDisabled();
    fireEvent.click(automatic);
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }));

    await waitFor(() => expect(api.connectRemoteTarget).toHaveBeenCalledWith({
      executionTargetId: TARGET_ID,
      mode: 'manual',
      credentials: { method: 'password', password: 'memory-only' },
      rememberCredential: true
    }));
    await waitFor(() => expect(api.setRemoteAutoConnect)
      .toHaveBeenCalledWith(TARGET_ID, true));
  });

  it('attempts automatic connection only once and leaves manual recovery visible', async () => {
    const api = {
      listRemoteTargets: vi.fn().mockResolvedValue([summary]),
      getRemoteCredentialStatus: vi.fn().mockResolvedValue({
        executionTargetId: TARGET_ID,
        storageState: 'available',
        credentialState: 'remembered',
        autoConnect: true
      }),
      connectRemoteTarget: vi.fn().mockRejectedValue(
        new Error('REMOTE_TARGET_AUTHENTICATION_FAILED')
      )
    } as unknown as LumoraApi;

    const view = render(
      <RemoteTargetWindow executionTargetId={TARGET_ID} api={api} />
    );
    await waitFor(() => expect(api.connectRemoteTarget).toHaveBeenCalledWith({
      executionTargetId: TARGET_ID,
      mode: 'automatic'
    }));
    view.rerender(<RemoteTargetWindow executionTargetId={TARGET_ID} api={api} />);
    await screen.findByLabelText('SSH password');
    expect(api.connectRemoteTarget).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Connect' })).toBeInTheDocument();
    expect(screen.getByText(
      'Lumora could not connect to this remote computer. Check the profile and try again.'
    )).toBeInTheDocument();
  });

  it('hides authentication while automatic connection is pending', async () => {
    const connection = deferred<never>();
    const api = {
      listRemoteTargets: vi.fn().mockResolvedValue([summary]),
      getRemoteCredentialStatus: vi.fn().mockResolvedValue({
        executionTargetId: TARGET_ID,
        storageState: 'available',
        credentialState: 'remembered',
        autoConnect: true
      }),
      connectRemoteTarget: vi.fn(() => connection.promise)
    } as unknown as LumoraApi;

    render(<RemoteTargetWindow executionTargetId={TARGET_ID} api={api} />);

    expect(await screen.findByRole('heading', {
      name: 'Connecting to Linux build server'
    })).toBeInTheDocument();
    await waitFor(() => expect(api.connectRemoteTarget).toHaveBeenCalledWith({
      executionTargetId: TARGET_ID,
      mode: 'automatic'
    }));
    expect(screen.queryByLabelText('SSH password')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Connect' })).not.toBeInTheDocument();
    expect(screen.queryByRole('switch', { name: 'Remember password' }))
      .not.toBeInTheDocument();
    expect(screen.queryByRole('switch', { name: 'Connect automatically' }))
      .not.toBeInTheDocument();
  });

  it('enables helper replacement after automatic connection without reconnecting', async () => {
    const pendingDetails = {
      ...summary,
      target: {
        ...summary.target,
        connectionState: 'helper-incompatible' as const
      },
      homeDirectory: '/home/builder',
      defaultShell: '/bin/bash'
    };
    const readyDetails = {
      ...pendingDetails,
      target: {
        ...pendingDetails.target,
        connectionState: 'ready' as const,
        helperVersion: '0.3.3',
        protocolVersion: 1
      }
    };
    const disconnectRemoteTarget = vi.fn();
    const api = {
      ...runtimeApiDefaults(),
      listRemoteTargets: vi.fn().mockResolvedValue([summary]),
      getRemoteCredentialStatus: vi.fn().mockResolvedValue({
        executionTargetId: TARGET_ID,
        storageState: 'available',
        credentialState: 'remembered',
        autoConnect: true
      }),
      connectRemoteTarget: vi.fn().mockResolvedValue(pendingDetails),
      getRemoteHelperInstallDetails: vi.fn().mockResolvedValue({
        status: 'invalid',
        helperVersion: '0.3.3',
        installLocation: '/home/builder/.local/share/lumora/helper/lumora-helper',
        requiresConfirmation: true
      }),
      installRemoteHelper: vi.fn().mockResolvedValue(readyDetails),
      disconnectRemoteTarget,
      getRemoteProviderPreferences: vi.fn().mockResolvedValue({
        enabledProviders: ['codex']
      })
    } as unknown as LumoraApi;

    render(<RemoteTargetWindow executionTargetId={TARGET_ID} api={api} />);

    await waitFor(() => expect(api.connectRemoteTarget).toHaveBeenCalledWith({
      executionTargetId: TARGET_ID,
      mode: 'automatic'
    }));
    await waitFor(() => expect(api.getRemoteHelperInstallDetails)
      .toHaveBeenCalledOnce());
    const open = await screen.findByRole('button', {
      name: 'Install Lumora helper'
    });
    expect(open).toBeEnabled();
    expect(api.connectRemoteTarget).toHaveBeenCalledTimes(1);
    expect(disconnectRemoteTarget).not.toHaveBeenCalled();

    fireEvent.click(open);
    const dialog = screen.getByRole('dialog', {
      name: 'Install Lumora helper'
    });
    fireEvent.click(within(dialog).getByRole('button', {
      name: 'Install helper'
    }));

    await waitFor(() => expect(api.installRemoteHelper).toHaveBeenCalledOnce());
    expect(await screen.findByTestId('lumora-shell')).toBeInTheDocument();
    expect(disconnectRemoteTarget).not.toHaveBeenCalled();
  });

  it('clears the automatic connection action when ready lifecycle state rerenders the effect', async () => {
    let lifecycleListener: ((event: RemoteLifecycleEvent) => void) | undefined;
    const readySummary = {
      ...summary,
      target: {
        ...summary.target,
        connectionState: 'ready' as const,
        helperVersion: '0.3.1',
        protocolVersion: 1,
        capabilities: []
      }
    };
    const connectedDetails = {
      ...readySummary,
      homeDirectory: '/home/builder',
      defaultShell: '/bin/bash'
    };
    const connection = deferred<typeof connectedDetails>();
    const api = {
      ...runtimeApiDefaults(),
      listRemoteTargets: vi.fn().mockResolvedValue([summary]),
      onRemoteLifecycleEvent: vi.fn((listener) => {
        lifecycleListener = listener;
        return () => undefined;
      }),
      getRemoteCredentialStatus: vi.fn().mockResolvedValue({
        executionTargetId: TARGET_ID,
        storageState: 'available',
        credentialState: 'remembered',
        autoConnect: true
      }),
      connectRemoteTarget: vi.fn(() => connection.promise),
      getRemoteProviderPreferences: vi.fn().mockResolvedValue({
        enabledProviders: ['codex']
      })
    } as unknown as LumoraApi;

    render(<RemoteTargetWindow executionTargetId={TARGET_ID} api={api} />);
    await waitFor(() => expect(api.connectRemoteTarget).toHaveBeenCalledWith({
      executionTargetId: TARGET_ID,
      mode: 'automatic'
    }));

    act(() => lifecycleListener?.({
      executionTargetId: TARGET_ID,
      snapshot: {
        summary: readySummary,
        generation: 1,
        discovery: null,
        catalog: null,
        discoveryState: 'idle',
        catalogState: 'idle',
        activeTerminalCount: 0
      }
    }));
    connection.resolve(connectedDetails);

    await screen.findByTestId('lumora-shell');
    await waitFor(() => expect(
      screen.getByRole('button', { name: 'Disconnect' })
    ).toBeEnabled());
    expect(screen.queryByRole('button', { name: 'Disconnecting…' }))
      .not.toBeInTheDocument();
  });

  it('connects explicitly with a remembered password without returning it to the renderer', async () => {
    const api = {
      listRemoteTargets: vi.fn().mockResolvedValue([summary]),
      getRemoteCredentialStatus: vi.fn().mockResolvedValue({
        executionTargetId: TARGET_ID,
        storageState: 'available',
        credentialState: 'remembered',
        autoConnect: false
      }),
      connectRemoteTarget: vi.fn().mockResolvedValue({
        ...summary,
        target: { ...summary.target, connectionState: 'ready' },
        homeDirectory: '/home/builder',
        defaultShell: '/bin/bash'
      }),
      getRemoteProviderPreferences: vi.fn().mockResolvedValue({
        enabledProviders: ['codex']
      }),
      scanRemoteDiscovery: vi.fn().mockResolvedValue(discovery)
    } as unknown as LumoraApi;

    render(<RemoteTargetWindow executionTargetId={TARGET_ID} api={api} />);
    const connect = await screen.findByRole('button', { name: 'Connect' });
    await waitFor(() => expect(connect).not.toBeDisabled());
    expect(screen.getByLabelText('SSH password')).toHaveValue('');
    fireEvent.click(connect);

    await waitFor(() => expect(api.connectRemoteTarget).toHaveBeenCalledWith({
      executionTargetId: TARGET_ID,
      mode: 'remembered'
    }));
  });

  it('disables remembering without secure storage and omits it for SSH agent profiles', async () => {
    const unavailable = {
      listRemoteTargets: vi.fn().mockResolvedValue([summary]),
      getRemoteCredentialStatus: vi.fn().mockResolvedValue({
        executionTargetId: TARGET_ID,
        storageState: 'unavailable',
        credentialState: 'none',
        autoConnect: false
      })
    } as unknown as LumoraApi;
    const first = render(
      <RemoteTargetWindow executionTargetId={TARGET_ID} api={unavailable} />
    );
    expect(await screen.findByRole('switch', { name: 'Remember password' }))
      .toBeDisabled();
    first.unmount();

    const agent = {
      listRemoteTargets: vi.fn().mockResolvedValue([{
        ...summary,
        profile: { ...summary.profile, authentication: { method: 'agent' } }
      }]),
      getRemoteCredentialStatus: vi.fn().mockResolvedValue({
        executionTargetId: TARGET_ID,
        storageState: 'available',
        credentialState: 'none',
        autoConnect: false
      })
    } as unknown as LumoraApi;
    render(<RemoteTargetWindow executionTargetId={TARGET_ID} api={agent} />);
    expect(await screen.findByRole('switch', { name: 'Connect automatically' }))
      .toBeInTheDocument();
    expect(screen.queryByRole('switch', { name: /Remember/ })).not.toBeInTheDocument();
  });

  it('offers passphrase remembering for private-key profiles', async () => {
    const api = {
      listRemoteTargets: vi.fn().mockResolvedValue([{
        ...summary,
        profile: {
          ...summary.profile,
          authentication: {
            method: 'private-key',
            privateKeyPath: '/home/builder/.ssh/id_ed25519'
          }
        }
      }]),
      getRemoteCredentialStatus: vi.fn().mockResolvedValue({
        executionTargetId: TARGET_ID,
        storageState: 'available',
        credentialState: 'none',
        autoConnect: false
      })
    } as unknown as LumoraApi;

    render(<RemoteTargetWindow executionTargetId={TARGET_ID} api={api} />);
    expect(await screen.findByRole('switch', { name: 'Remember passphrase' }))
      .toBeInTheDocument();
    expect(screen.getByLabelText('Private-key passphrase (optional)'))
      .toHaveValue('');
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

  it('saves target-scoped provider choices through the shared provider settings', async () => {
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
      ...providerApiDefaults(),
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
    expect(screen.getByText('Remote provider registry'))
      .toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    await waitFor(() => expect(api.scanRemoteDiscovery).toHaveBeenCalledTimes(2));
    const openCodeSwitch = screen.getByRole('checkbox', { name: 'Use OpenCode' });
    fireEvent.click(openCodeSwitch);
    fireEvent.click(screen.getByRole('button', { name: 'Save provider selection' }));

    await waitFor(() => expect(api.saveRemoteProviderPreferences)
      .toHaveBeenCalledWith({ enabledProviders: ['codex', 'opencode'] }));
    expect(api.scanRemoteDiscovery).toHaveBeenCalledTimes(3);
  });

  it('saves start commands and confirms installs from the remote provider card', async () => {
    const readySummary = {
      ...summary,
      target: {
        ...summary.target,
        connectionState: 'ready' as const,
        helperVersion: '0.3.2',
        protocolVersion: 1,
        capabilities: [
          'provider-scan' as const,
          'provider-lifecycle' as const
        ]
      }
    };
    const remoteDiscovery = {
      ...discovery,
      providers: {
        ...discovery.providers,
        providers: [{
          provider: 'opencode' as const,
          displayName: 'OpenCode',
          state: 'not_found' as const,
          executablePath: null,
          version: null,
          issue: {
            code: 'PROVIDER_NOT_FOUND' as const,
            message: 'OpenCode was not found on PATH.',
            recovery: 'Install OpenCode on the remote computer, then refresh.',
            retryable: true
          }
        }]
      }
    };
    const saveProviderLaunchConfig = vi.fn().mockResolvedValue([{
      provider: 'opencode', command: 'opencode --remote',
      updatedAt: '2026-08-05T04:03:02.000Z'
    }]);
    const installProvider = vi.fn().mockResolvedValue({
      outcome: 'completed',
      result: {
        provider: 'opencode',
        completedAt: '2026-08-05T04:03:02.000Z',
        installation: {
          provider: 'opencode', displayName: 'OpenCode', state: 'ready',
          executablePath: '/usr/bin/opencode', version: '1.0.0', issue: null
        }
      }
    });
    const api = {
      ...runtimeApiDefaults(),
      listRemoteTargets: vi.fn().mockResolvedValue([readySummary]),
      getRemoteProviderPreferences: vi.fn().mockResolvedValue({
        enabledProviders: ['opencode']
      }),
      scanRemoteDiscovery: vi.fn().mockResolvedValue(remoteDiscovery),
      saveProviderLaunchConfig,
      installProvider
    } as unknown as LumoraApi;

    render(<RemoteTargetWindow executionTargetId={TARGET_ID} api={api} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Settings' }));

    const command = await screen.findByLabelText('OpenCode start command');
    fireEvent.change(command, { target: { value: 'opencode --remote' } });
    fireEvent.click(screen.getByRole('button', {
      name: 'Save OpenCode start command'
    }));
    await waitFor(() => expect(saveProviderLaunchConfig).toHaveBeenCalledWith({
      provider: 'opencode', command: 'opencode --remote'
    }));

    fireEvent.click(screen.getByRole('button', { name: 'Install OpenCode' }));
    fireEvent.click(screen.getByRole('button', {
      name: 'Confirm install OpenCode'
    }));
    await waitFor(() => expect(installProvider).toHaveBeenCalledWith('opencode'));
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
    let notifySettingsChanged: (() => void) | null = null;
    const getGeneralSettings = vi.fn()
      .mockResolvedValueOnce(DEFAULT_GENERAL_SETTINGS)
      .mockResolvedValue({
        ...DEFAULT_GENERAL_SETTINGS,
        showInformationalNotices: false
      });
    const api = {
      ...runtimeApiDefaults(),
      listRemoteTargets: vi.fn().mockResolvedValue([readySummary]),
      getGeneralSettings,
      onGeneralSettingsChanged: vi.fn((listener: () => void) => {
        notifySettingsChanged = listener;
        return () => { notifySettingsChanged = null; };
      }),
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

    expect(
      await within(screen.getByRole('main')).findByText('Repair release workflow')
    ).toBeInTheDocument();
    expect(screen.getByText('lumora')).toBeInTheDocument();
    expect(screen.getByText('12.5K tokens')).toBeInTheDocument();
    expect(screen.getByText(/Codex remote catalog support is pending/i)).toBeInTheDocument();

    if (notifySettingsChanged === null) throw new Error('Missing settings listener.');
    act(() => notifySettingsChanged?.());
    await waitFor(() => expect(getGeneralSettings).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(
      screen.queryByText(/Codex remote catalog support is pending/i)
    ).not.toBeInTheDocument());

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
    expect(await screen.findByLabelText(`Starting ${session.title}`))
      .toBeInTheDocument();
    await waitFor(() => expect(prepareLaunch).toHaveBeenCalledWith({
      strategy: 'resume',
      sessionId: session.id,
      interactionRoute: 'automatic',
      startPrompt: '',
      terminalProfileId: null,
      cols: 100,
      rows: 30
    }));

    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    const resumeButton = await screen.findByRole('button', {
      name: `Resume ${session.title}`
    });
    fireEvent.contextMenu(resumeButton, { clientX: 80, clientY: 90 });
    fireEvent.click(await screen.findByRole('menuitem', {
      name: 'Resume options…'
    }));
    expect(await screen.findByRole('dialog', { name: 'Resume session' }))
      .toBeInTheDocument();
  });

  it('switches running remote sessions from the sidebar and reconciles them after exit', async () => {
    let runtimeListener!: (event: {
      type: 'state';
      runtimeId: string;
      runtime: RuntimeSummary;
    }) => void;
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
      title: 'Running remote session',
      createdAt: '2026-08-05T01:00:00.000Z',
      updatedAt: '2026-08-05T04:00:00.000Z',
      lifetimeTokens: 12_500,
      lifecycle: 'saved' as const,
      sourceFreshness: 'current' as const
    };
    const runtime = {
      id: '0198f8b6-18f3-7ca0-9f0f-123456789ad9',
      displayName: session.title,
      strategy: 'resume' as const,
      sessionId: session.id,
      nativeSessionId: session.nativeId,
      reconciliationState: 'not_required' as const,
      provider: 'codex' as const,
      workspaceId: workspace.id,
      terminalProfileId: 'c'.repeat(64),
      launchHash: 'd'.repeat(64),
      state: 'running' as const,
      pid: 4321,
      createdAt: '2026-08-05T04:01:00.000Z',
      startedAt: '2026-08-05T04:01:01.000Z',
      endedAt: null,
      exitCode: null,
      errorCode: null
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
      listRuntimes: vi.fn().mockResolvedValue([]),
      attachRuntime: vi.fn().mockResolvedValue({
        runtime,
        snapshot: '',
        outputSequence: 0
      }),
      onRuntimeEvent: vi.fn((listener) => {
        runtimeListener = listener;
        return () => undefined;
      })
    } as unknown as LumoraApi;

    render(<RemoteTargetWindow executionTargetId={TARGET_ID} api={api} />);

    fireEvent.click(await screen.findByRole('button', { name: 'All sessions' }));
    await screen.findByRole('button', { name: `Resume ${session.title}` });
    act(() => runtimeListener({
      type: 'state',
      runtimeId: runtime.id,
      runtime
    }));
    const runningRegion = await screen.findByRole('region', {
      name: 'Running sessions'
    });
    expect(screen.queryByRole('region', { name: 'Recent sessions' })).toBeNull();
    fireEvent.click(within(runningRegion).getByRole('button', {
      name: new RegExp(session.title)
    }));

    expect(screen.queryByRole('dialog', { name: 'Resume session' }))
      .not.toBeInTheDocument();
    expect(await screen.findByLabelText(`${session.title} terminal content`))
      .toBeInTheDocument();

    act(() => runtimeListener({
      type: 'state',
      runtimeId: runtime.id,
      runtime: {
        ...runtime,
        state: 'completed',
        endedAt: '2026-08-05T04:20:00.000Z',
        exitCode: 0
      }
    }));

    expect(screen.queryByRole('region', { name: 'Running sessions' })).toBeNull();
    const recentRegion = await screen.findByRole('region', {
      name: 'Recent sessions'
    });
    expect(await within(recentRegion).findByText(session.title)).toBeVisible();
    fireEvent.click(within(recentRegion).getByRole('button', {
      name: new RegExp(session.title)
    }));
    expect(await screen.findByLabelText(`Starting ${session.title}`))
      .toBeInTheDocument();
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
    fireEvent.click(screen.getByRole('button', { name: 'Codex command mode' }));
    fireEvent.click(screen.getByRole('option', { name: 'Custom command' }));
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

    fireEvent.keyDown(ptyInput, {
      code: 'Comma', key: ',', ctrlKey: true
    });
    expect(await screen.findByRole('heading', {
      name: 'Settings', level: 1
    })).toBeInTheDocument();
    ptyInput.remove();
  });

  it('ignores the terminal switcher shortcut outside the remote terminal page', async () => {
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
    const firstRuntime = {
      id: '0198f8b6-18f3-7ca0-9f0f-123456789ad0',
      displayName: 'First remote session',
      strategy: 'new' as const,
      sessionId: null,
      nativeSessionId: null,
      reconciliationState: 'not_required' as const,
      provider: 'codex' as const,
      workspaceId: 'a'.repeat(64),
      terminalProfileId: 'b'.repeat(64),
      launchHash: 'c'.repeat(64),
      state: 'running' as const,
      pid: 4321,
      createdAt: '2026-08-05T04:01:00.000Z',
      startedAt: '2026-08-05T04:01:01.000Z',
      endedAt: null,
      exitCode: null,
      errorCode: null
    };
    const secondRuntime = {
      ...firstRuntime,
      id: '0198f8b6-18f3-7ca0-9f0f-123456789ad1',
      displayName: 'Second remote session',
      pid: 4322
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
        sessions: [],
        providers: [],
        snapshot: {
          refreshedAt: '2026-08-05T04:03:02.000Z',
          workspaces: [], sessions: [], providerStatus: [],
          providerFacets: [], diagnostics: []
        }
      }),
      listRuntimes: vi.fn().mockResolvedValue([firstRuntime, secondRuntime])
    } as unknown as LumoraApi;

    render(<RemoteTargetWindow executionTargetId={TARGET_ID} api={api} />);

    await screen.findByLabelText('First remote session terminal content');
    fireEvent.keyDown(window, {
      code: 'Digit1', key: '1', ctrlKey: true
    });
    expect(await screen.findByRole('heading', {
      name: 'Home', level: 1
    })).toBeInTheDocument();

    fireEvent.keyDown(window, { code: 'Tab', key: 'Tab', ctrlKey: true });

    expect(screen.getByRole('heading', {
      name: 'Home', level: 1
    })).toBeInTheDocument();
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
      ...providerApiDefaults(),
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
