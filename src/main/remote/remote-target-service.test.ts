import { describe, expect, it, vi } from 'vitest';

import type {
  ExecutionTarget,
  ProviderId,
  RemoteConnectionProfile,
  RemoteTargetCredentials
} from '../../shared/contracts';
import type { RemoteHelperSessionScanResult } from '../../shared/remote-helper-protocol';
import { RemoteHelperConnectionError } from './helper-connection';
import { createRemoteTargetService } from './remote-target-service';
import {
  RemoteSshError,
  type RemoteSshErrorCode
} from './ssh-errors';

const TARGET_ID = 'b032eb7d-70d0-4b78-b8ce-f228458b44e3';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

const storedProfile: RemoteConnectionProfile = {
  executionTargetId: TARGET_ID,
  displayName: 'Build server',
  route: 'direct',
  host: 'build.internal',
  port: 22,
  username: 'builder',
  sshConfigHost: null,
  authentication: { method: 'password' },
  verifiedHostFingerprint: 'SHA256:57qsnZ7C9rC8S3dftMDSqdHcpZ+PZfNclRBfXZXp0mM',
  createdAt: '2026-08-04T06:00:00.000Z',
  updatedAt: '2026-08-04T06:00:00.000Z'
};

const storedTarget: Extract<ExecutionTarget, { kind: 'remote' }> = {
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
};

function createHarness(options: {
  createSessionRuntime?: (...args: any[]) => any;
  profile?: RemoteConnectionProfile;
  autoConnect?: boolean;
} = {}) {
  let target = storedTarget;
  let profile = options.profile ?? storedProfile;
  const targets = {
    list: vi.fn(() => [target]),
    get: vi.fn(() => target),
    createRemote: vi.fn(() => target),
    updateRemoteConnection: vi.fn((_id, update) => {
      target = { ...target, ...update };
      return target;
    }),
    deleteRemote: vi.fn()
  };
  const profiles = {
    list: vi.fn(() => [profile]),
    get: vi.fn(() => profile),
    save: vi.fn((_id, input) => {
      profile = { ...profile, ...input, executionTargetId: TARGET_ID };
      return profile;
    }),
    trustHostKey: vi.fn(() => profile)
  };
  let closeListener: (() => void) | null = null;
  const connected = {
    execute: vi.fn(),
    openExec: vi.fn().mockResolvedValue({}),
    openFileTransfer: vi.fn().mockResolvedValue({ close: vi.fn() }),
    onClose: vi.fn((listener: () => void) => {
      closeListener = listener;
      return () => { if (closeListener === listener) closeListener = null; };
    }),
    triggerClose: () => closeListener?.(),
    close: vi.fn()
  };
  const ssh = {
    observeHostKey: vi.fn().mockResolvedValue({
      executionTargetId: TARGET_ID,
      fingerprint: storedProfile.verifiedHostFingerprint
    }),
    connect: vi.fn().mockResolvedValue(connected)
  };
  let autoConnect = options.autoConnect ?? false;
  const credentialPreferences = {
    getAutoConnect: vi.fn(() => autoConnect),
    setAutoConnect: vi.fn((_id, enabled: boolean) => {
      autoConnect = enabled;
    })
  };
  const credentialVault = {
    getStorageState: vi.fn().mockResolvedValue('available'),
    getCredentialState: vi.fn((): 'none' | 'remembered' | 'needs-attention' =>
      'none'
    ),
    save: vi.fn().mockResolvedValue(undefined),
    resolve: vi.fn().mockResolvedValue(null),
    forget: vi.fn()
  };
  const probePlatform = vi.fn().mockResolvedValue({
    platform: 'linux',
    architecture: 'arm64',
    homeDirectory: '/home/builder',
    helperBaseDirectory: '/home/builder',
    defaultShell: '/bin/bash'
  });
  const artifact = {
    helperVersion: '0.1.0',
    protocolVersion: 1,
    platform: 'linux' as const,
    architecture: 'arm64' as const,
    absolutePath: 'D:\\helper',
    size: 42,
    sha256: 'a'.repeat(64),
    capabilities: ['system-info' as const]
  };
  const paths = {
    rootDirectory: '/home/builder/.lumora/helper',
    versionDirectory: '/home/builder/.lumora/helper/0.1.0',
    executablePath: '/home/builder/.lumora/helper/0.1.0/lumora-helper',
    temporaryPath: '/home/builder/.lumora/helper/0.1.0/.helper.tmp'
  };
  const files = { close: vi.fn() };
  connected.openFileTransfer.mockResolvedValue(files);
  const resolveHelperArtifact = vi.fn().mockResolvedValue(artifact);
  const createHelperPaths = vi.fn(() => paths);
  const inspectHelper = vi.fn().mockResolvedValue({ status: 'installed', paths });
  const installHelper = vi.fn().mockResolvedValue(undefined);
  const helper = {
    info: {
      helperVersion: '0.1.0',
      protocolVersion: 1,
      platform: 'linux' as const,
      architecture: 'arm64' as const,
      homeDirectory: '/home/builder',
      defaultShell: '/bin/bash',
      capabilities: [
        'system-info' as const,
        'provider-scan' as const,
        'provider-lifecycle' as const,
        'session-scan' as const
      ]
    },
    scanDiscovery: vi.fn().mockResolvedValue({
      checkedAt: '2026-08-05T04:03:02.000Z',
      node: {
        state: 'ready', executablePath: '/usr/bin/node', version: 'v24.0.0'
      },
      npm: { state: 'not_found', executablePath: null, version: null },
      providers: [{
        provider: 'codex', state: 'ready',
        executablePath: '/usr/bin/codex', version: 'codex 1.2.3'
      }, {
        provider: 'opencode', state: 'not_found',
        executablePath: null, version: null
      }]
    }),
    scanSessionPage: vi.fn(async (
      provider: ProviderId,
      cursor: string | null
    ): Promise<RemoteHelperSessionScanResult> => {
      if (provider === 'codex') {
        return {
          provider,
          scannedAt: '2026-08-09T04:03:02.000Z',
          status: 'unsupported' as const,
          sessions: [] as const,
          invalidCount: 0 as const,
          nextCursor: null
        };
      }
      return {
        provider: 'opencode' as const,
        scannedAt: '2026-08-09T04:03:02.000Z',
        status: 'ready' as const,
        sessions: cursor === null ? [{
          nativeId: 'session-1', workspacePath: '/work/lumora',
          title: 'Remote work', createdAt: '2026-08-08T04:03:02.000Z',
          updatedAt: '2026-08-09T04:03:02.000Z', lifetimeTokens: null,
          sourceKey: '/private/opencode/session-1'
        }] : [{
          nativeId: 'session-2', workspacePath: '/work/other',
          title: 'Older work', createdAt: '2026-08-07T04:03:02.000Z',
          updatedAt: '2026-08-08T04:03:02.000Z', lifetimeTokens: 12,
          sourceKey: '/private/opencode/session-2'
        }],
        invalidCount: 1,
        nextCursor: cursor === null ? '1' : null
      };
    }),
    runProviderLifecycle: vi.fn().mockResolvedValue({
      provider: 'opencode',
      action: 'install',
      completedAt: '2026-08-04T08:00:00.000Z'
    }),
    close: vi.fn()
  };
  const providerPreferences = {
    get: vi.fn((): readonly ProviderId[] => ['codex', 'opencode']),
    save: vi.fn((_id, providers: readonly ProviderId[]) => [...providers])
  };
  const connectHelper = vi.fn().mockResolvedValue(helper);
  const providerReleases = {
    latestVersion: vi.fn(async () => '2.0.0')
  };
  const terminalImageStager = {
    stage: vi.fn().mockResolvedValue({
      remotePath: '/home/builder/.lumora/tmp/terminal-images/image.png',
      pasteText: '[Pasted image: "/home/builder/.lumora/tmp/terminal-images/image.png"]'
    }),
    cleanupRuntime: vi.fn().mockResolvedValue(undefined)
  };
  const clock = vi.fn(() => new Date('2026-08-04T08:00:00.000Z'));
  const service = createRemoteTargetService({
    targets,
    profiles,
    ssh,
    probePlatform,
    resolveHelperArtifact,
    createHelperPaths,
    inspectHelper,
    installHelper,
    connectHelper,
    providerReleases,
    terminalImageStager,
    ...(options.createSessionRuntime === undefined
      ? {}
      : { createSessionRuntime: options.createSessionRuntime }),
    providerPreferences,
    credentialPreferences,
    credentialVault,
    clock,
    createTargetId: () => TARGET_ID
  });
  return {
    service, targets, profiles, ssh, connected, probePlatform,
    artifact, paths, files, resolveHelperArtifact, inspectHelper,
    installHelper, connectHelper, helper, providerPreferences, providerReleases,
    credentialPreferences, credentialVault, terminalImageStager
  };
}

describe('remote target service', () => {
  it('reports only non-secret remembered credential and auto-connect state', async () => {
    const harness = createHarness({ autoConnect: true });
    harness.credentialVault.getCredentialState.mockReturnValue('remembered');

    await expect(harness.service.getCredentialStatus(TARGET_ID)).resolves.toEqual({
      executionTargetId: TARGET_ID,
      storageState: 'available',
      credentialState: 'remembered',
      autoConnect: true
    });
  });

  it('enables password auto-connect only when a credential is remembered', async () => {
    const harness = createHarness();

    await expect(harness.service.setAutoConnect(TARGET_ID, true))
      .rejects.toMatchObject({ code: 'REMOTE_TARGET_CREDENTIAL_REQUIRED' });
    harness.credentialVault.getCredentialState.mockReturnValue('remembered');
    await expect(harness.service.setAutoConnect(TARGET_ID, true)).resolves
      .toMatchObject({ autoConnect: true, credentialState: 'remembered' });
    expect(harness.credentialPreferences.setAutoConnect)
      .toHaveBeenCalledWith(TARGET_ID, true);
  });

  it('forgets a password idempotently and disables its automatic connection', async () => {
    const harness = createHarness({ autoConnect: true });

    await harness.service.forgetCredential(TARGET_ID);
    await harness.service.forgetCredential(TARGET_ID);

    expect(harness.credentialVault.forget).toHaveBeenCalledTimes(2);
    expect(harness.credentialPreferences.setAutoConnect)
      .toHaveBeenLastCalledWith(TARGET_ID, false);
  });

  it('forgets incompatible credentials when authentication changes or a profile is removed', async () => {
    const changed = createHarness({ autoConnect: true });
    await changed.service.update(TARGET_ID, {
      displayName: 'Build server',
      route: 'direct',
      host: 'build.internal',
      port: 22,
      username: 'builder',
      authentication: { method: 'agent' }
    });
    expect(changed.credentialVault.forget).toHaveBeenCalledWith(TARGET_ID);
    expect(changed.credentialPreferences.setAutoConnect)
      .toHaveBeenCalledWith(TARGET_ID, false);

    const removed = createHarness();
    await removed.service.remove(TARGET_ID);
    expect(removed.credentialVault.forget).toHaveBeenCalledWith(TARGET_ID);
  });

  it('remembers a manual password only after SSH authentication succeeds', async () => {
    const harness = createHarness();

    await harness.service.connect(TARGET_ID, {
      mode: 'manual',
      credentials: { method: 'password', password: 'memory-only' },
      rememberCredential: true
    });

    expect(harness.credentialVault.save).toHaveBeenCalledWith(
      TARGET_ID,
      'password',
      'memory-only'
    );
    expect(harness.ssh.connect.mock.invocationCallOrder[0]!)
      .toBeLessThan(harness.credentialVault.save.mock.invocationCallOrder[0]!);
  });

  it('does not remember a password when SSH authentication fails', async () => {
    const harness = createHarness();
    harness.ssh.connect.mockRejectedValueOnce(
      new RemoteSshError('AUTHENTICATION_FAILED', 'Authentication failed.')
    );

    await expect(harness.service.connect(TARGET_ID, {
      mode: 'manual',
      credentials: { method: 'password', password: 'wrong' },
      rememberCredential: true
    })).rejects.toMatchObject({ code: 'REMOTE_TARGET_AUTHENTICATION_FAILED' });
    expect(harness.credentialVault.save).not.toHaveBeenCalled();
  });

  it('remembers a private-key passphrase only after successful authentication', async () => {
    const profile: RemoteConnectionProfile = {
      ...storedProfile,
      authentication: {
        method: 'private-key',
        privateKeyPath: '/home/builder/.ssh/id_ed25519'
      }
    };
    const harness = createHarness({ profile });

    await harness.service.connect(TARGET_ID, {
      mode: 'manual',
      credentials: { method: 'private-key', passphrase: 'key-secret' },
      rememberCredential: true
    });

    expect(harness.ssh.connect).toHaveBeenCalledWith(profile, {
      method: 'private-key',
      passphrase: 'key-secret'
    });
    expect(harness.credentialVault.save).toHaveBeenCalledWith(
      TARGET_ID,
      'private-key-passphrase',
      'key-secret'
    );
  });

  it('resolves a remembered password for one automatic connection attempt', async () => {
    const harness = createHarness({ autoConnect: true });
    harness.credentialVault.resolve.mockResolvedValueOnce('remembered');

    await harness.service.connect(TARGET_ID, { mode: 'automatic' });

    expect(harness.credentialVault.resolve).toHaveBeenCalledWith(
      TARGET_ID,
      'password'
    );
    expect(harness.ssh.connect).toHaveBeenCalledOnce();
    expect(harness.ssh.connect).toHaveBeenCalledWith(
      storedProfile,
      { method: 'password', password: 'remembered' }
    );
  });

  it('uses a remembered password for an explicit connection without enabling auto-connect', async () => {
    const harness = createHarness();
    harness.credentialVault.resolve.mockResolvedValueOnce('remembered');

    await harness.service.connect(TARGET_ID, { mode: 'remembered' });

    expect(harness.credentialPreferences.getAutoConnect()).toBe(false);
    expect(harness.credentialVault.resolve).toHaveBeenCalledWith(
      TARGET_ID,
      'password'
    );
    expect(harness.ssh.connect).toHaveBeenCalledWith(storedProfile, {
      method: 'password',
      password: 'remembered'
    });
  });

  it('disables password auto-connect when a successful manual connection forgets it', async () => {
    const harness = createHarness({ autoConnect: true });

    await harness.service.connect(TARGET_ID, {
      mode: 'manual',
      credentials: { method: 'password', password: 'ephemeral' },
      rememberCredential: false
    });

    expect(harness.credentialVault.forget).toHaveBeenCalledWith(TARGET_ID);
    expect(harness.credentialPreferences.getAutoConnect()).toBe(false);
  });

  it('supports automatic private-key and SSH-agent authentication', async () => {
    const privateKeyProfile: RemoteConnectionProfile = {
      ...storedProfile,
      authentication: {
        method: 'private-key',
        privateKeyPath: '/home/builder/.ssh/id_ed25519'
      }
    };
    const privateKey = createHarness({
      profile: privateKeyProfile,
      autoConnect: true
    });
    privateKey.credentialVault.resolve.mockResolvedValueOnce('key-secret');
    await privateKey.service.connect(TARGET_ID, { mode: 'automatic' });
    expect(privateKey.ssh.connect).toHaveBeenCalledWith(privateKeyProfile, {
      method: 'private-key',
      passphrase: 'key-secret'
    });

    const agentProfile: RemoteConnectionProfile = {
      ...storedProfile,
      authentication: { method: 'agent' }
    };
    const agent = createHarness({ profile: agentProfile, autoConnect: true });
    await agent.service.connect(TARGET_ID, { mode: 'automatic' });
    expect(agent.credentialVault.resolve).not.toHaveBeenCalled();
    expect(agent.ssh.connect).toHaveBeenCalledWith(agentProfile, {
      method: 'agent'
    });
  });

  it('requires an enabled preference and remembered password for automatic connection', async () => {
    const disabled = createHarness();
    await expect(disabled.service.connect(TARGET_ID, { mode: 'automatic' }))
      .rejects.toMatchObject({ code: 'REMOTE_TARGET_CREDENTIAL_REQUIRED' });
    expect(disabled.ssh.connect).not.toHaveBeenCalled();

    const missing = createHarness({ autoConnect: true });
    await expect(missing.service.connect(TARGET_ID, { mode: 'automatic' }))
      .rejects.toMatchObject({ code: 'REMOTE_TARGET_CREDENTIAL_REQUIRED' });
    expect(missing.ssh.connect).not.toHaveBeenCalled();
  });

  it('lists only remote targets joined to their non-secret profiles', () => {
    const { service } = createHarness();

    expect(service.list()).toEqual([{ target: storedTarget, profile: storedProfile }]);
    expect(JSON.stringify(service.list())).not.toContain('password":"');
  });

  it('disconnects active resources and resets state when a profile is edited', async () => {
    const harness = createHarness();
    await harness.service.connect(TARGET_ID, {
      method: 'password', password: 'memory-only'
    });

    await expect(harness.service.update(TARGET_ID, {
      displayName: 'Renamed build server',
      route: 'direct',
      host: 'build.internal',
      port: 2222,
      username: 'builder',
      authentication: { method: 'password' }
    })).resolves.toMatchObject({ target: { connectionState: 'offline' } });

    expect(harness.helper.close).toHaveBeenCalledOnce();
    expect(harness.files.close).toHaveBeenCalledOnce();
    expect(harness.connected.close).toHaveBeenCalledOnce();
    expect(harness.profiles.save).toHaveBeenCalledWith(
      TARGET_ID,
      expect.objectContaining({ displayName: 'Renamed build server', port: 2222 }),
      new Date('2026-08-04T08:00:00.000Z')
    );
    expect(harness.targets.updateRemoteConnection).toHaveBeenLastCalledWith(
      TARGET_ID,
      { connectionState: 'offline' }
    );
  });

  it('connects through the verified profile, probes the platform, and persists safe state', async () => {
    const { service, targets, ssh, probePlatform, connected } = createHarness();
    const credentials: RemoteTargetCredentials = {
      method: 'password',
      password: 'memory-only'
    };

    await expect(service.connect(TARGET_ID, credentials)).resolves.toMatchObject({
      target: {
        connectionState: 'ready',
        platform: 'linux',
        architecture: 'arm64',
        helperVersion: '0.1.0',
        protocolVersion: 1,
        lastConnectedAt: '2026-08-04T08:00:00.000Z'
      },
      homeDirectory: '/home/builder',
      defaultShell: '/bin/bash'
    });
    expect(targets.updateRemoteConnection.mock.calls.map((call) => call[1]))
      .toEqual([
        { connectionState: 'connecting' },
        { connectionState: 'authenticating' },
        {
          connectionState: 'authenticating',
          platform: 'linux',
          architecture: 'arm64',
          helperVersion: null,
          protocolVersion: null,
          capabilities: [],
          lastConnectedAt: '2026-08-04T08:00:00.000Z'
        },
        {
          connectionState: 'ready',
          platform: 'linux',
          architecture: 'arm64',
          helperVersion: '0.1.0',
          protocolVersion: 1,
          capabilities: ['provider-scan', 'provider-lifecycle', 'session-scan'],
          lastConnectedAt: '2026-08-04T08:00:00.000Z'
        }
      ]);
    expect(ssh.connect).toHaveBeenCalledWith(storedProfile, credentials);
    expect(probePlatform).toHaveBeenCalledWith(expect.any(Function));
    expect(connected.openExec).toHaveBeenCalledWith(
      "HOME='/home/builder' SHELL='/bin/bash' " +
      "LUMORA_LOGIN_SHELL='/bin/bash' exec " +
      "'/home/builder/.lumora/helper/0.1.0/lumora-helper'"
    );
    expect(JSON.stringify(targets.updateRemoteConnection.mock.calls))
      .not.toContain('memory-only');
  });

  it('publishes authoritative lifecycle snapshots with the latest catalog', async () => {
    const harness = createHarness();
    const lifecycle = harness.service as unknown as {
      getLifecycleSnapshot?: (id: typeof TARGET_ID) => {
        summary: { target: { connectionState: string } };
        catalog: unknown;
      };
      subscribeLifecycle?: (listener: (event: unknown) => void) => () => void;
    };

    expect(lifecycle.getLifecycleSnapshot).toBeTypeOf('function');
    expect(lifecycle.subscribeLifecycle).toBeTypeOf('function');
    const listener = vi.fn();
    const unsubscribe = lifecycle.subscribeLifecycle!(listener);

    await harness.service.connect(TARGET_ID, {
      method: 'password', password: 'memory-only'
    });
    const catalog = await harness.service.scanSessions(TARGET_ID);

    expect(lifecycle.getLifecycleSnapshot!(TARGET_ID)).toMatchObject({
      summary: { target: { connectionState: 'ready' } },
      catalog
    });
    expect(listener).toHaveBeenCalled();
    unsubscribe();
  });

  it('marks an active target offline when its SSH transport closes unexpectedly', async () => {
    const removeRuntimeListener = vi.fn();
    const sessionRuntime = {
      updateCatalog: vi.fn(),
      subscribe: vi.fn(() => removeRuntimeListener),
      shutdown: vi.fn().mockResolvedValue(undefined),
      close: vi.fn()
    };
    const harness = createHarness({
      createSessionRuntime: vi.fn(() => sessionRuntime)
    });
    await harness.service.connect(TARGET_ID, {
      method: 'password', password: 'memory-only'
    });

    harness.connected.triggerClose();

    expect(harness.service.get(TARGET_ID).target.connectionState).toBe('offline');
    expect(harness.helper.close).toHaveBeenCalledOnce();
    expect(harness.files.close).toHaveBeenCalledOnce();
    expect(removeRuntimeListener).toHaveBeenCalledOnce();
    expect(sessionRuntime.close).toHaveBeenCalledOnce();
    expect(sessionRuntime.shutdown).not.toHaveBeenCalled();
  });

  it('scans only target-enabled providers and normalizes helper results', async () => {
    const harness = createHarness();
    await harness.service.connect(TARGET_ID, {
      method: 'password', password: 'memory-only'
    });

    await expect(harness.service.scanDiscovery(TARGET_ID)).resolves.toEqual({
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
        providers: [
          {
            provider: 'codex', displayName: 'Codex', state: 'ready',
            executablePath: '/usr/bin/codex', version: 'codex 1.2.3', issue: null
          },
          {
            provider: 'opencode', displayName: 'OpenCode', state: 'not_found',
            executablePath: null, version: null,
            issue: {
              code: 'PROVIDER_NOT_FOUND',
              message: 'OpenCode was not found on PATH.',
              recovery: 'Install OpenCode on the remote computer, then refresh.',
              retryable: true
            }
          }
        ]
      }
    });
    expect(harness.helper.scanDiscovery).toHaveBeenCalledWith([
      'codex', 'opencode'
    ]);
    expect(harness.targets.updateRemoteConnection).toHaveBeenLastCalledWith(
      TARGET_ID,
      { lastScannedAt: '2026-08-05T04:03:02.000Z' }
    );
    expect(harness.service.getProviderPreferences(TARGET_ID)).toEqual({
      enabledProviders: ['codex', 'opencode']
    });
    expect(harness.service.saveProviderPreferences(TARGET_ID, {
      enabledProviders: ['opencode']
    })).toEqual({ enabledProviders: ['opencode'] });
  });

  it('checks, installs, and rescans providers through the active target helper', async () => {
    const harness = createHarness();
    await harness.service.connect(TARGET_ID, {
      method: 'password', password: 'memory-only'
    });

    await expect(harness.service.checkProviderUpdates(TARGET_ID)).resolves.toMatchObject({
      providers: expect.arrayContaining([
        expect.objectContaining({
          provider: 'codex', state: 'update_available'
        })
      ])
    });

    harness.helper.scanDiscovery
      .mockResolvedValueOnce({
        checkedAt: '2026-08-05T04:04:00.000Z',
        node: { state: 'ready', executablePath: '/usr/bin/node', version: 'v24' },
        npm: { state: 'ready', executablePath: '/usr/bin/npm', version: '10.0.0' },
        providers: [{
          provider: 'codex', state: 'ready',
          executablePath: '/usr/bin/codex', version: 'codex 1.2.3'
        }, {
          provider: 'opencode', state: 'not_found',
          executablePath: null, version: null
        }]
      })
      .mockResolvedValueOnce({
        checkedAt: '2026-08-05T04:05:00.000Z',
        node: { state: 'ready', executablePath: '/usr/bin/node', version: 'v24' },
        npm: { state: 'ready', executablePath: '/usr/bin/npm', version: '10.0.0' },
        providers: [{
          provider: 'codex', state: 'ready',
          executablePath: '/usr/bin/codex', version: 'codex 1.2.3'
        }, {
          provider: 'opencode', state: 'ready',
          executablePath: '/home/builder/.local/bin/opencode', version: '2.0.0'
        }]
      });

    await expect(
      harness.service.installProvider(TARGET_ID, 'opencode')
    ).resolves.toMatchObject({
      provider: 'opencode',
      installation: { state: 'ready', version: '2.0.0' }
    });
    expect(harness.helper.runProviderLifecycle).toHaveBeenCalledWith(
      'opencode', 'install'
    );
  });

  it('collects bounded session pages and strips helper-only source paths', async () => {
    const harness = createHarness();
    await harness.service.connect(TARGET_ID, {
      method: 'password', password: 'memory-only'
    });

    const catalog = await harness.service.scanSessions(TARGET_ID);

    expect(catalog).toMatchObject({
      executionTargetId: TARGET_ID,
      scannedAt: '2026-08-04T08:00:00.000Z',
      sessions: [{
        provider: 'opencode', nativeId: 'session-1',
        workspacePath: '/work/lumora', title: 'Remote work',
        createdAt: '2026-08-08T04:03:02.000Z',
        updatedAt: '2026-08-09T04:03:02.000Z', lifetimeTokens: null
      }, {
        provider: 'opencode', nativeId: 'session-2',
        workspacePath: '/work/other', title: 'Older work',
        createdAt: '2026-08-07T04:03:02.000Z',
        updatedAt: '2026-08-08T04:03:02.000Z', lifetimeTokens: 12
      }],
      providers: [{
        provider: 'codex', status: 'unsupported',
        sessionCount: 0, invalidCount: 0
      }, {
        provider: 'opencode', status: 'ready',
        sessionCount: 2, invalidCount: 1
      }]
    });
    expect(harness.helper.scanSessionPage.mock.calls).toEqual([
      ['codex', null, 100],
      ['opencode', null, 100],
      ['opencode', '1', 100]
    ]);
    expect(JSON.stringify(catalog)).not.toContain('/private/opencode');
    expect(catalog.snapshot.workspaces).toHaveLength(2);
    expect(catalog.snapshot.sessions).toHaveLength(2);
    expect(catalog.snapshot.workspaces.every(
      (workspace) => /^[a-f0-9]{64}$/.test(workspace.id)
    )).toBe(true);
    expect(catalog.snapshot.sessions.every(
      (session) => /^[a-f0-9]{64}$/.test(session.id)
    )).toBe(true);
    expect(catalog.snapshot.sessions[0]).toMatchObject({
      nativeId: 'session-1', provider: 'opencode',
      lifecycle: 'saved', sourceFreshness: 'current'
    });
    expect(catalog.snapshot.providerFacets).toEqual([
      { provider: 'opencode', sessionCount: 2 }
    ]);
  });

  it('composes one target-owned session runtime and synchronizes scanned catalog state', async () => {
    let runtimeListener: ((event: any) => void) | null = null;
    const sessionRuntime = {
      updateCatalog: vi.fn(),
      subscribe: vi.fn((listener: (event: any) => void) => {
        runtimeListener = listener;
        return () => { runtimeListener = null; };
      }),
      shutdown: vi.fn().mockResolvedValue(undefined),
      close: vi.fn()
    };
    const createSessionRuntime = vi.fn(() => sessionRuntime);
    const harness = createHarness({ createSessionRuntime });
    await harness.service.connect(TARGET_ID, {
      method: 'password', password: 'memory-only'
    });

    const catalog = await harness.service.scanSessions(TARGET_ID);

    expect(createSessionRuntime).toHaveBeenCalledWith({
      executionTargetId: TARGET_ID,
      platform: 'linux',
      defaultShell: '/bin/bash',
      ssh: harness.connected
    });
    expect(sessionRuntime.updateCatalog).toHaveBeenCalledWith(catalog);
    expect(harness.service.resolveSessionRuntime(TARGET_ID)).toBe(sessionRuntime);

    const onEvent = vi.fn();
    harness.service.subscribeSessionRuntimeEvents(onEvent);
    const event = {
      type: 'output',
      runtimeId: '0198f8b6-18f3-7ca0-9f0f-123456789abc',
      sequence: 1,
      data: 'remote output'
    };
    (runtimeListener as ((event: any) => void) | null)?.(event);
    expect(onEvent).toHaveBeenCalledWith(TARGET_ID, event);
  });

  it('stages images only for a live runtime owned by the connected target', async () => {
    const runtimeId = '5a795d90-06b3-4fca-b9a7-c0d0bf312c1d';
    const sessionRuntime = {
      updateCatalog: vi.fn(),
      subscribe: vi.fn(() => () => undefined),
      listRuntimes: vi.fn(() => [{ id: runtimeId, state: 'running' }]),
      shutdown: vi.fn().mockResolvedValue(undefined),
      close: vi.fn()
    };
    const harness = createHarness({
      createSessionRuntime: vi.fn(() => sessionRuntime)
    });
    await harness.service.connect(TARGET_ID, {
      method: 'password', password: 'memory-only'
    });

    await expect(
      harness.service.stageTerminalImage(TARGET_ID, runtimeId, Buffer.from('png'))
    ).resolves.toMatchObject({ remotePath: expect.stringContaining('image.png') });
    expect(harness.terminalImageStager.stage).toHaveBeenCalledWith({
      runtimeId,
      png: Buffer.from('png'),
      platform: 'linux',
      baseDirectory: '/home/builder',
      files: harness.files
    });

    await expect(
      harness.service.stageTerminalImage(
        TARGET_ID,
        'a52d2434-5876-46e8-b33c-f967e4959934',
        Buffer.from('png')
      )
    ).rejects.toMatchObject({ code: 'REMOTE_TARGET_OPERATION_FAILED' });
  });

  it('waits for remote terminal shutdown before closing the SSH transport', async () => {
    let finishShutdown!: () => void;
    const shutdownPending = new Promise<void>((resolve) => {
      finishShutdown = resolve;
    });
    const sessionRuntime = {
      updateCatalog: vi.fn(),
      subscribe: vi.fn(() => () => undefined),
      shutdown: vi.fn(() => shutdownPending),
      close: vi.fn()
    };
    const harness = createHarness({
      createSessionRuntime: vi.fn(() => sessionRuntime)
    });
    await harness.service.connect(TARGET_ID, {
      method: 'password', password: 'memory-only'
    });

    const disconnecting = harness.service.disconnect(TARGET_ID);
    await Promise.resolve();

    expect(sessionRuntime.shutdown).toHaveBeenCalledOnce();
    expect(harness.connected.close).not.toHaveBeenCalled();
    expect(sessionRuntime.close).not.toHaveBeenCalled();

    finishShutdown();
    await expect(disconnecting).resolves.toMatchObject({
      target: { connectionState: 'offline' }
    });
    expect(sessionRuntime.close).toHaveBeenCalledOnce();
    expect(harness.connected.close).toHaveBeenCalledOnce();
  });

  it('publishes offline state when terminal shutdown fails during disconnect', async () => {
    const sessionRuntime = {
      updateCatalog: vi.fn(),
      subscribe: vi.fn(() => () => undefined),
      shutdown: vi.fn().mockRejectedValue(new Error('remote shutdown failed')),
      close: vi.fn()
    };
    const harness = createHarness({
      createSessionRuntime: vi.fn(() => sessionRuntime)
    });
    await harness.service.connect(TARGET_ID, {
      method: 'password', password: 'memory-only'
    });
    const lifecycleEvents: Array<{
      snapshot: { summary: { target: { connectionState: string } } };
    }> = [];
    harness.service.subscribeLifecycle((event) => lifecycleEvents.push(event));

    await expect(harness.service.disconnect(TARGET_ID)).resolves.toMatchObject({
      target: { connectionState: 'offline' }
    });

    expect(sessionRuntime.close).toHaveBeenCalledOnce();
    expect(harness.connected.close).toHaveBeenCalledOnce();
    expect(lifecycleEvents.at(-1)?.snapshot.summary.target.connectionState)
      .toBe('offline');
  });

  it('reports an installed provider scan failure as retryable', async () => {
    const harness = createHarness();
    harness.providerPreferences.get.mockReturnValue(['codex']);
    harness.helper.scanSessionPage.mockResolvedValue({
      provider: 'codex',
      scannedAt: '2026-08-09T04:03:02.000Z',
      status: 'failed',
      sessions: [],
      invalidCount: 0,
      nextCursor: null
    });
    await harness.service.connect(TARGET_ID, {
      method: 'password', password: 'memory-only'
    });

    const catalog = await harness.service.scanSessions(TARGET_ID);

    expect(catalog.providers).toEqual([{
      provider: 'codex', status: 'failed', sessionCount: 0, invalidCount: 0
    }]);
    expect(catalog.snapshot.diagnostics).toEqual([
      expect.objectContaining({
        provider: 'codex',
        message: 'Codex remote catalog scan failed.',
        recovery: 'Retry the scan or update Codex on the remote computer.',
        retryable: true
      })
    ]);
  });

  it('keeps authenticated SSH available when the helper is missing', async () => {
    const harness = createHarness();
    harness.inspectHelper.mockResolvedValueOnce({
      status: 'missing',
      paths: harness.paths
    });

    await expect(harness.service.connect(TARGET_ID, {
      method: 'password',
      password: 'memory-only'
    })).resolves.toMatchObject({
      target: { connectionState: 'helper-missing' }
    });
    expect(harness.connected.close).not.toHaveBeenCalled();
    expect(harness.files.close).not.toHaveBeenCalled();
    expect(harness.service.getHelperInstallDetails(TARGET_ID)).toEqual({
      status: 'missing',
      helperVersion: '0.1.0',
      installLocation: harness.paths.executablePath,
      requiresConfirmation: true
    });

    await expect(harness.service.installHelper(TARGET_ID)).resolves.toMatchObject({
      target: { connectionState: 'ready', helperVersion: '0.1.0' }
    });
    expect(harness.installHelper).toHaveBeenCalledWith(expect.objectContaining({
      replaceExisting: false,
      artifact: harness.artifact,
      paths: harness.paths
    }));
    expect(harness.connectHelper).toHaveBeenCalled();
  });

  it('marks an invalid installed helper incompatible until confirmed replacement', async () => {
    const harness = createHarness();
    harness.inspectHelper.mockResolvedValueOnce({
      status: 'invalid',
      paths: harness.paths
    });

    await expect(harness.service.connect(TARGET_ID, {
      method: 'password', password: 'memory-only'
    })).resolves.toMatchObject({
      target: { connectionState: 'helper-incompatible' }
    });
    expect(harness.service.getHelperInstallDetails(TARGET_ID))
      .toMatchObject({ status: 'invalid' });
    await harness.service.installHelper(TARGET_ID);
    expect(harness.installHelper).toHaveBeenCalledWith(expect.objectContaining({
      replaceExisting: true
    }));
  });

  it.each([
    ['AUTHENTICATION_MISMATCH', 'REMOTE_TARGET_AUTHENTICATION_FAILED'],
    ['AUTHENTICATION_FAILED', 'REMOTE_TARGET_AUTHENTICATION_FAILED'],
    ['SSH_AGENT_UNAVAILABLE', 'REMOTE_TARGET_AUTHENTICATION_FAILED'],
    ['HOST_KEY_CHANGED', 'REMOTE_TARGET_HOST_KEY_CHANGED'],
    ['SSH_TIMEOUT', 'REMOTE_TARGET_SSH_TIMEOUT'],
    ['HOST_KEY_UNAVAILABLE', 'REMOTE_TARGET_SSH_CONNECTION_FAILED'],
    ['SSH_CONNECTION_FAILED', 'REMOTE_TARGET_SSH_CONNECTION_FAILED'],
    ['SSH_OUTPUT_LIMIT', 'REMOTE_TARGET_SSH_CONNECTION_FAILED']
  ] as const)(
    'maps the SSH %s failure to %s without exposing its message',
    async (sshCode: RemoteSshErrorCode, expectedCode) => {
      const harness = createHarness();
      harness.ssh.connect.mockRejectedValueOnce(
        new RemoteSshError(sshCode, '/private/ssh/diagnostic')
      );

      const failure = await harness.service.connect(TARGET_ID, {
        method: 'password', password: 'memory-only'
      }).catch((error: unknown) => error);

      expect(failure).toMatchObject({
        code: expectedCode,
        message: 'Lumora could not connect to the remote computer.'
      });
      expect(JSON.stringify(failure)).not.toContain('/private/ssh/diagnostic');
    }
  );

  it('identifies a platform-probe failure and closes the SSH client', async () => {
    const harness = createHarness();
    harness.probePlatform.mockRejectedValueOnce(new Error('/private/remote/path'));

    const failure = await harness.service.connect(TARGET_ID, {
      method: 'password',
      password: 'memory-only'
    }).catch((error: unknown) => error);

    expect(failure).toMatchObject({
      code: 'REMOTE_TARGET_PLATFORM_PROBE_FAILED',
      message: 'Lumora could not connect to the remote computer.'
    });
    expect(JSON.stringify(failure)).not.toContain('/private/remote/path');
    expect(harness.connected.close).toHaveBeenCalledOnce();
    expect(harness.targets.updateRemoteConnection).toHaveBeenLastCalledWith(
      TARGET_ID,
      { connectionState: 'error' }
    );
  });

  it.each([
    ['helper bundle', 'REMOTE_TARGET_HELPER_BUNDLE_FAILED'],
    ['file transfer', 'REMOTE_TARGET_FILE_TRANSFER_FAILED'],
    ['helper inspection', 'REMOTE_TARGET_HELPER_INSPECTION_FAILED']
  ] as const)('identifies a %s connection-stage failure', async (stage, expectedCode) => {
    const harness = createHarness();
    if (stage === 'helper bundle') {
      harness.resolveHelperArtifact.mockRejectedValueOnce(
        new Error('/private/helper/bundle')
      );
    } else if (stage === 'file transfer') {
      harness.connected.openFileTransfer.mockRejectedValueOnce(
        new Error('/private/sftp/subsystem')
      );
    } else {
      harness.inspectHelper.mockRejectedValueOnce(
        new Error('/private/helper/install')
      );
    }

    const failure = await harness.service.connect(TARGET_ID, {
      method: 'password', password: 'memory-only'
    }).catch((error: unknown) => error);

    expect(failure).toMatchObject({
      code: expectedCode,
      message: 'Lumora could not connect to the remote computer.'
    });
    expect(JSON.stringify(failure)).not.toContain('/private/');
    expect(harness.connected.close).toHaveBeenCalledOnce();
  });

  it('disconnects idempotently and closes all clients during shutdown', async () => {
    const { service, connected, targets } = createHarness();
    await service.connect(TARGET_ID, { method: 'password', password: 'secret' });

    await expect(service.disconnect(TARGET_ID)).resolves.toMatchObject({
      target: { connectionState: 'offline' }
    });
    await expect(service.disconnect(TARGET_ID)).resolves.toMatchObject({
      target: { connectionState: 'offline' }
    });
    expect(connected.close).toHaveBeenCalledOnce();
    expect(targets.updateRemoteConnection).toHaveBeenLastCalledWith(
      TARGET_ID,
      { connectionState: 'offline' }
    );
    await expect(service.close()).resolves.toBeUndefined();
    await expect(service.close()).resolves.toBeUndefined();
  });

  it('waits for an in-flight connection before closing its resources', async () => {
    const harness = createHarness();
    const connection = deferred<typeof harness.connected>();
    harness.ssh.connect.mockImplementationOnce(() => connection.promise);
    const connecting = harness.service.connect(TARGET_ID, {
      method: 'password', password: 'memory-only'
    });
    await vi.waitFor(() => expect(harness.ssh.connect).toHaveBeenCalledOnce());

    const firstClose = harness.service.close();
    const secondClose = harness.service.close();
    expect(firstClose).toBe(secondClose);
    connection.resolve(harness.connected);

    await expect(connecting).resolves.toMatchObject({
      target: { id: TARGET_ID }
    });
    await expect(firstClose).resolves.toBeUndefined();
    expect(harness.connected.close).toHaveBeenCalledOnce();
    expect(harness.targets.updateRemoteConnection).toHaveBeenLastCalledWith(
      TARGET_ID,
      { connectionState: 'offline' }
    );

    await expect(harness.service.connect(TARGET_ID, {
      method: 'password', password: 'memory-only'
    })).rejects.toBeInstanceOf(Error);
    expect(harness.ssh.connect).toHaveBeenCalledOnce();
  });

  it('returns a retryable provider diagnostic when a helper session scan times out', async () => {
    const harness = createHarness();
    harness.providerPreferences.get.mockReturnValue(['codex']);
    harness.helper.scanSessionPage.mockRejectedValue(
      new RemoteHelperConnectionError('HELPER_TIMEOUT')
    );
    await harness.service.connect(TARGET_ID, {
      method: 'password', password: 'memory-only'
    });

    const catalog = await harness.service.scanSessions(TARGET_ID);

    expect(catalog.providers).toEqual([{
      provider: 'codex', status: 'failed', sessionCount: 0, invalidCount: 0
    }]);
    expect(catalog.snapshot.diagnostics).toEqual([
      expect.objectContaining({
        provider: 'codex',
        message: 'Codex remote catalog scan failed.',
        retryable: true
      })
    ]);
  });
});
