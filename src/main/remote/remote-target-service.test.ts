import { describe, expect, it, vi } from 'vitest';

import type {
  ExecutionTarget,
  ProviderId,
  RemoteConnectionProfile,
  RemoteTargetCredentials
} from '../../shared/contracts';
import type { RemoteHelperSessionScanResult } from '../../shared/remote-helper-protocol';
import { createRemoteTargetService } from './remote-target-service';
import {
  RemoteSshError,
  type RemoteSshErrorCode
} from './ssh-errors';

const TARGET_ID = 'b032eb7d-70d0-4b78-b8ce-f228458b44e3';

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

function createHarness() {
  let target = storedTarget;
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
    list: vi.fn(() => [storedProfile]),
    get: vi.fn(() => storedProfile),
    save: vi.fn(() => storedProfile),
    trustHostKey: vi.fn(() => storedProfile)
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
    close: vi.fn()
  };
  const providerPreferences = {
    get: vi.fn((): readonly ProviderId[] => ['codex', 'opencode']),
    save: vi.fn((_id, providers: readonly ProviderId[]) => [...providers])
  };
  const connectHelper = vi.fn().mockResolvedValue(helper);
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
    providerPreferences,
    clock,
    createTargetId: () => TARGET_ID
  });
  return {
    service, targets, profiles, ssh, connected, probePlatform,
    artifact, paths, files, resolveHelperArtifact, inspectHelper,
    installHelper, connectHelper, helper, providerPreferences
  };
}

describe('remote target service', () => {
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

    expect(harness.service.update(TARGET_ID, {
      displayName: 'Renamed build server',
      route: 'direct',
      host: 'build.internal',
      port: 2222,
      username: 'builder',
      authentication: { method: 'password' }
    })).toMatchObject({ target: { connectionState: 'offline' } });

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
          capabilities: ['provider-scan', 'session-scan'],
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

  it('marks an active target offline when its SSH transport closes unexpectedly', async () => {
    const harness = createHarness();
    await harness.service.connect(TARGET_ID, {
      method: 'password', password: 'memory-only'
    });

    harness.connected.triggerClose();

    expect(harness.service.get(TARGET_ID).target.connectionState).toBe('offline');
    expect(harness.helper.close).toHaveBeenCalledOnce();
    expect(harness.files.close).toHaveBeenCalledOnce();
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

    expect(service.disconnect(TARGET_ID)).toMatchObject({
      target: { connectionState: 'offline' }
    });
    expect(service.disconnect(TARGET_ID)).toMatchObject({
      target: { connectionState: 'offline' }
    });
    expect(connected.close).toHaveBeenCalledOnce();
    expect(targets.updateRemoteConnection).toHaveBeenLastCalledWith(
      TARGET_ID,
      { connectionState: 'offline' }
    );
    expect(service.close).not.toThrow();
    expect(service.close).not.toThrow();
  });
});
