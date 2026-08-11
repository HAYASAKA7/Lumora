import { describe, expect, it, vi } from 'vitest';

import {
  IPC_CHANNELS,
  type ProviderId,
  type LumoraWindowContext,
  type RemoteTargetSummary
} from '../../shared/contracts';
import { RemoteTargetServiceError } from '../remote/remote-target-service';
import { registerTargetIpc } from './register-target-ipc';

const TARGET_ID = '05f4e306-4af2-4c73-9e0d-706084623645';
const OTHER_TARGET_ID = '395612e9-c281-487b-a571-166d62fb15fe';

const summary = {
  target: {
    id: TARGET_ID,
    kind: 'remote',
    displayName: 'Build server',
    platform: 'unknown',
    architecture: 'unknown',
    connectionState: 'offline',
    helperVersion: null,
    protocolVersion: null,
    capabilities: [],
    lastConnectedAt: null,
    lastScannedAt: null
  },
  profile: {
    executionTargetId: TARGET_ID,
    displayName: 'Build server',
    route: 'direct',
    host: 'build.internal',
    port: 22,
    username: 'builder',
    sshConfigHost: null,
    authentication: { method: 'password' },
    verifiedHostFingerprint: null,
    createdAt: '2026-08-04T09:00:00.000Z',
    updatedAt: '2026-08-04T09:00:00.000Z'
  }
} as const satisfies RemoteTargetSummary;

type Handler = (event: unknown, ...args: unknown[]) => Promise<unknown>;

function createHarness(context: LumoraWindowContext) {
  const handlers = new Map<string, Handler>();
  const service = {
    list: vi.fn(() => [summary]),
    get: vi.fn(() => summary),
    create: vi.fn(() => summary),
    update: vi.fn().mockResolvedValue(summary),
    remove: vi.fn().mockResolvedValue(undefined),
    observeHostKey: vi.fn().mockResolvedValue({
      executionTargetId: TARGET_ID,
      fingerprint: 'SHA256:57qsnZ7C9rC8S3dftMDSqdHcpZ+PZfNclRBfXZXp0mM'
    }),
    trustHostKey: vi.fn(() => summary),
    connect: vi.fn().mockResolvedValue({
      ...summary,
      homeDirectory: '/home/builder',
      defaultShell: '/bin/bash'
    }),
    getCredentialStatus: vi.fn().mockResolvedValue({
      executionTargetId: TARGET_ID,
      storageState: 'available',
      credentialState: 'remembered',
      autoConnect: false
    }),
    setAutoConnect: vi.fn().mockResolvedValue({
      executionTargetId: TARGET_ID,
      storageState: 'available',
      credentialState: 'remembered',
      autoConnect: true
    }),
    forgetCredential: vi.fn().mockResolvedValue({
      executionTargetId: TARGET_ID,
      storageState: 'available',
      credentialState: 'none',
      autoConnect: false
    }),
    disconnect: vi.fn().mockResolvedValue(summary),
    getHelperInstallDetails: vi.fn(() => ({
      status: 'missing' as const,
      helperVersion: '0.1.0',
      installLocation: '/home/builder/.local/share/lumora/helper/lumora-helper',
      requiresConfirmation: true as const
    })),
    installHelper: vi.fn().mockResolvedValue({
      ...summary,
      target: { ...summary.target, connectionState: 'ready' },
      homeDirectory: '/home/builder',
      defaultShell: '/bin/bash'
    }),
    getProviderPreferences: vi.fn(() => ({
      enabledProviders: ['codex'] as ProviderId[]
    })),
    saveProviderPreferences: vi.fn((_id, preferences) => preferences),
    scanDiscovery: vi.fn().mockResolvedValue({
      executionTargetId: TARGET_ID,
      scannedAt: '2026-08-05T04:03:02.000Z',
      environment: {
        checkedAt: '2026-08-05T04:03:02.000Z',
        node: { state: 'not_found', executablePath: null, version: null },
        npm: { state: 'not_found', executablePath: null, version: null }
      },
      providers: {
        scannedAt: '2026-08-05T04:03:02.000Z', providers: []
      }
    }),
    scanSessions: vi.fn().mockResolvedValue({
      executionTargetId: TARGET_ID,
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
    })
  };
  const openTargetWindow = vi.fn().mockResolvedValue(undefined);
  const beforeProfileMutation = vi.fn().mockResolvedValue(undefined);
  registerTargetIpc({
    ipc: {
      handle(channel, handler) {
        handlers.set(channel, handler as Handler);
      }
    },
    authorize: vi.fn(() => context),
    service,
    beforeProfileMutation,
    openTargetWindow
  });
  return { handlers, service, beforeProfileMutation, openTargetWindow };
}

const event = { senderFrame: { url: 'app://lumora/index.html' }, sender: { id: 1 } };

describe('registerTargetIpc', () => {
  it('lets the local window manage profiles and open a target window', async () => {
    const { handlers, service, openTargetWindow } = createHarness({
      mode: 'local',
      executionTargetId: 'local'
    });
    expect([...handlers.keys()]).toEqual([
      IPC_CHANNELS.targetWindowContextGet,
      IPC_CHANNELS.remoteTargetList,
      IPC_CHANNELS.remoteTargetCreate,
      IPC_CHANNELS.remoteTargetUpdate,
      IPC_CHANNELS.remoteTargetRemove,
      IPC_CHANNELS.remoteTargetObserveHost,
      IPC_CHANNELS.remoteTargetTrustHost,
      IPC_CHANNELS.remoteTargetConnect,
      IPC_CHANNELS.remoteCredentialStatus,
      IPC_CHANNELS.remoteCredentialForget,
      IPC_CHANNELS.remoteAutoConnectPreferenceSave,
      IPC_CHANNELS.remoteTargetDisconnect,
      IPC_CHANNELS.remoteTargetHelperDetails,
      IPC_CHANNELS.remoteTargetHelperInstall,
      IPC_CHANNELS.remoteProviderPreferencesGet,
      IPC_CHANNELS.remoteProviderPreferencesSave,
      IPC_CHANNELS.remoteDiscoveryScan,
      IPC_CHANNELS.remoteSessionScan,
      IPC_CHANNELS.remoteTargetWindowOpen
    ]);
    await expect(handlers.get(IPC_CHANNELS.remoteTargetCreate)!(event, {
      displayName: 'Build server',
      route: 'direct',
      host: 'build.internal',
      port: 22,
      username: 'builder',
      authentication: { method: 'password' }
    })).resolves.toEqual(summary);
    await expect(handlers.get(IPC_CHANNELS.remoteTargetWindowOpen)!(event, {
      executionTargetId: TARGET_ID
    })).resolves.toEqual({ opened: true, executionTargetId: TARGET_ID });
    expect(service.create).toHaveBeenCalledOnce();
    expect(openTargetWindow).toHaveBeenCalledWith(TARGET_ID);
  });

  it('closes the target window before editing or removing a profile', async () => {
    const { handlers, service, beforeProfileMutation } = createHarness({
      mode: 'local', executionTargetId: 'local'
    });
    const edited = {
      displayName: 'Renamed build server',
      route: 'direct' as const,
      host: 'build.internal',
      port: 2222,
      username: 'builder',
      authentication: { method: 'password' as const }
    };

    await handlers.get(IPC_CHANNELS.remoteTargetUpdate)!(event, {
      executionTargetId: TARGET_ID,
      profile: edited
    });
    await handlers.get(IPC_CHANNELS.remoteTargetRemove)!(event, {
      executionTargetId: TARGET_ID
    });

    expect(beforeProfileMutation).toHaveBeenCalledTimes(2);
    expect(beforeProfileMutation).toHaveBeenNthCalledWith(1, TARGET_ID);
    expect(beforeProfileMutation).toHaveBeenNthCalledWith(2, TARGET_ID);
    expect(beforeProfileMutation.mock.invocationCallOrder[0]!)
      .toBeLessThan(service.update.mock.invocationCallOrder[0]!);
    expect(beforeProfileMutation.mock.invocationCallOrder[1]!)
      .toBeLessThan(service.remove.mock.invocationCallOrder[0]!);
  });

  it('limits a remote window to reading and connecting its own target', async () => {
    const { handlers, service } = createHarness({
      mode: 'remote',
      executionTargetId: TARGET_ID
    });

    await expect(handlers.get(IPC_CHANNELS.remoteTargetList)!(event))
      .resolves.toEqual([summary]);
    await expect(handlers.get(IPC_CHANNELS.remoteTargetConnect)!(event, {
      executionTargetId: TARGET_ID,
      mode: 'manual',
      credentials: { method: 'password', password: 'memory-only' },
      rememberCredential: true
    })).resolves.toMatchObject({ target: { id: TARGET_ID } });
    await expect(handlers.get(IPC_CHANNELS.remoteCredentialStatus)!(event, {
      executionTargetId: TARGET_ID
    })).resolves.toMatchObject({ credentialState: 'remembered' });
    await expect(handlers.get(IPC_CHANNELS.remoteAutoConnectPreferenceSave)!(
      event,
      { executionTargetId: TARGET_ID, autoConnect: true }
    )).resolves.toMatchObject({ autoConnect: true });
    await expect(handlers.get(IPC_CHANNELS.remoteCredentialForget)!(event, {
      executionTargetId: TARGET_ID
    })).resolves.toMatchObject({ credentialState: 'none' });
    await expect(handlers.get(IPC_CHANNELS.remoteTargetConnect)!(event, {
      executionTargetId: TARGET_ID,
      mode: 'remembered'
    })).resolves.toMatchObject({ target: { id: TARGET_ID } });
    await expect(handlers.get(IPC_CHANNELS.remoteTargetConnect)!(event, {
      executionTargetId: TARGET_ID,
      mode: 'automatic'
    })).resolves.toMatchObject({ target: { id: TARGET_ID } });
    await expect(handlers.get(IPC_CHANNELS.remoteTargetConnect)!(event, {
      executionTargetId: OTHER_TARGET_ID,
      mode: 'automatic'
    })).rejects.toMatchObject({ code: 'REMOTE_TARGET_OPERATION_FAILED' });
    await expect(handlers.get(IPC_CHANNELS.remoteTargetRemove)!(event, {
      executionTargetId: TARGET_ID
    })).rejects.toMatchObject({ code: 'REMOTE_TARGET_OPERATION_FAILED' });
    await expect(handlers.get(IPC_CHANNELS.remoteTargetHelperDetails)!(event))
      .resolves.toMatchObject({ status: 'missing' });
    await expect(handlers.get(IPC_CHANNELS.remoteTargetHelperInstall)!(event))
      .resolves.toMatchObject({ target: { connectionState: 'ready' } });
    await expect(handlers.get(IPC_CHANNELS.remoteProviderPreferencesGet)!(event))
      .resolves.toEqual({ enabledProviders: ['codex'] });
    await expect(handlers.get(IPC_CHANNELS.remoteProviderPreferencesSave)!(
      event,
      { enabledProviders: ['opencode', 'codex'] }
    )).resolves.toEqual({ enabledProviders: ['codex', 'opencode'] });
    await expect(handlers.get(IPC_CHANNELS.remoteDiscoveryScan)!(event))
      .resolves.toMatchObject({ executionTargetId: TARGET_ID });
    await expect(handlers.get(IPC_CHANNELS.remoteSessionScan)!(event))
      .resolves.toMatchObject({ executionTargetId: TARGET_ID });
    expect(service.connect).toHaveBeenCalledTimes(3);
    expect(service.connect).toHaveBeenCalledWith(TARGET_ID, {
      executionTargetId: TARGET_ID,
      mode: 'remembered'
    });
    expect(service.connect).toHaveBeenLastCalledWith(TARGET_ID, {
      executionTargetId: TARGET_ID,
      mode: 'automatic'
    });
    expect(service.getCredentialStatus).toHaveBeenCalledWith(TARGET_ID);
    expect(service.setAutoConnect).toHaveBeenCalledWith(TARGET_ID, true);
    expect(service.forgetCredential).toHaveBeenCalledWith(TARGET_ID);
    expect(service.getHelperInstallDetails).toHaveBeenCalledWith(TARGET_ID);
    expect(service.installHelper).toHaveBeenCalledWith(TARGET_ID);
    expect(service.getProviderPreferences).toHaveBeenCalledWith(TARGET_ID);
    expect(service.saveProviderPreferences).toHaveBeenCalledWith(
      TARGET_ID,
      { enabledProviders: ['codex', 'opencode'] }
    );
    expect(service.scanDiscovery).toHaveBeenCalledWith(TARGET_ID);
    expect(service.scanSessions).toHaveBeenCalledWith(TARGET_ID);
    expect(service.remove).not.toHaveBeenCalled();
  });

  it('preserves only an allowlisted remote connection failure code', async () => {
    const { handlers, service } = createHarness({
      mode: 'remote', executionTargetId: TARGET_ID
    });
    service.connect.mockRejectedValueOnce(
      new RemoteTargetServiceError('REMOTE_TARGET_PLATFORM_PROBE_FAILED')
    );

    await expect(handlers.get(IPC_CHANNELS.remoteTargetConnect)!(event, {
      executionTargetId: TARGET_ID,
      mode: 'manual',
      credentials: { method: 'password', password: 'memory-only' },
      rememberCredential: false
    })).rejects.toMatchObject({
      code: 'REMOTE_TARGET_PLATFORM_PROBE_FAILED',
      message: 'REMOTE_TARGET_PLATFORM_PROBE_FAILED: Lumora could not complete the remote-target operation.'
    });

    service.connect.mockRejectedValueOnce(
      Object.assign(new Error('/private/remote/path'), {
        code: 'PRIVATE_REMOTE_PATH'
      })
    );
    await expect(handlers.get(IPC_CHANNELS.remoteTargetConnect)!(event, {
      executionTargetId: TARGET_ID,
      mode: 'automatic'
    })).rejects.toMatchObject({
      code: 'REMOTE_TARGET_OPERATION_FAILED'
    });
  });

  it('does not expose target-scoped helper installation to the local window', async () => {
    const { handlers, service } = createHarness({
      mode: 'local', executionTargetId: 'local'
    });
    await expect(handlers.get(IPC_CHANNELS.remoteTargetHelperDetails)!(event))
      .rejects.toMatchObject({ code: 'REMOTE_TARGET_OPERATION_FAILED' });
    await expect(handlers.get(IPC_CHANNELS.remoteTargetHelperInstall)!(event))
      .rejects.toMatchObject({ code: 'REMOTE_TARGET_OPERATION_FAILED' });
    await expect(handlers.get(IPC_CHANNELS.remoteProviderPreferencesGet)!(event))
      .rejects.toMatchObject({ code: 'REMOTE_TARGET_OPERATION_FAILED' });
    await expect(handlers.get(IPC_CHANNELS.remoteDiscoveryScan)!(event))
      .rejects.toMatchObject({ code: 'REMOTE_TARGET_OPERATION_FAILED' });
    await expect(handlers.get(IPC_CHANNELS.remoteSessionScan)!(event))
      .rejects.toMatchObject({ code: 'REMOTE_TARGET_OPERATION_FAILED' });
    expect(service.getHelperInstallDetails).not.toHaveBeenCalled();
    expect(service.installHelper).not.toHaveBeenCalled();
  });

  it('returns the immutable authorized window context', async () => {
    const context = { mode: 'remote', executionTargetId: TARGET_ID } as const;
    const { handlers } = createHarness(context);
    await expect(handlers.get(IPC_CHANNELS.targetWindowContextGet)!(event))
      .resolves.toEqual(context);
  });
});
