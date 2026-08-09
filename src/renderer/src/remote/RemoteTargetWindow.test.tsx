import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { LumoraApi } from '../../../shared/contracts';
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

describe('RemoteTargetWindow', () => {
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
    expect(await screen.findByText('/home/builder')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: 'Environment' }));
    expect(await screen.findByText('v24.0.0')).toBeInTheDocument();
    expect(screen.queryByText('All sessions')).not.toBeInTheDocument();
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
    expect(await screen.findByText('ready')).toBeInTheDocument();
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
    fireEvent.click(await screen.findByRole('tab', { name: 'Providers' }));
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

  it('loads a read-only remote session catalog only when the Sessions page opens', async () => {
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
        }]
      }),
      disconnectRemoteTarget: vi.fn()
    } as unknown as LumoraApi;

    render(<RemoteTargetWindow executionTargetId={TARGET_ID} api={api} />);
    const sessionsTab = await screen.findByRole('tab', { name: 'Sessions' });
    expect(api.scanRemoteSessions).not.toHaveBeenCalled();
    fireEvent.click(sessionsTab);

    expect(await screen.findByRole('heading', { name: 'Repair release workflow' }))
      .toBeInTheDocument();
    expect(screen.getByText('/srv/lumora')).toBeInTheDocument();
    expect(screen.getByText('12,500 tokens')).toBeInTheDocument();
    expect(screen.getByText(/Codex catalog support pending/i)).toBeInTheDocument();
    expect(screen.getByText(/read-only metadata/i)).toBeInTheDocument();
    expect(api.scanRemoteSessions).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'Refresh sessions' }));
    await waitFor(() => expect(api.scanRemoteSessions).toHaveBeenCalledTimes(2));
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
    fireEvent.click(await screen.findByRole('tab', { name: 'Environment' }));

    expect(await screen.findByText(/helper cannot scan providers yet/i))
      .toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Refresh' })).toBeDisabled();
    expect(api.scanRemoteDiscovery).not.toHaveBeenCalled();
  });
});
