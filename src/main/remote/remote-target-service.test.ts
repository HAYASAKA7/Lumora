import { describe, expect, it, vi } from 'vitest';

import type {
  ExecutionTarget,
  ProviderId,
  RemoteConnectionProfile,
  RemoteTargetCredentials
} from '../../shared/contracts';
import { createRemoteTargetService } from './remote-target-service';

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
  const connected = {
    execute: vi.fn(),
    openExec: vi.fn().mockResolvedValue({}),
    openFileTransfer: vi.fn().mockResolvedValue({ close: vi.fn() }),
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
    scanSessionPage: vi.fn(async (provider: ProviderId, cursor: string | null) => {
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
    get: vi.fn(() => ['codex', 'opencode'] as const),
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
    const { service, targets, ssh, probePlatform } = createHarness();
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
    expect(JSON.stringify(targets.updateRemoteConnection.mock.calls))
      .not.toContain('memory-only');
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

    expect(catalog).toEqual({
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

  it('closes a partially connected client and stores only a generic error state', async () => {
    const harness = createHarness();
    harness.probePlatform.mockRejectedValueOnce(new Error('/private/remote/path'));

    await expect(harness.service.connect(TARGET_ID, {
      method: 'password',
      password: 'memory-only'
    })).rejects.toMatchObject({
      code: 'REMOTE_TARGET_CONNECTION_FAILED',
      message: 'Lumora could not connect to the remote computer.'
    });
    expect(harness.connected.close).toHaveBeenCalledOnce();
    expect(harness.targets.updateRemoteConnection).toHaveBeenLastCalledWith(
      TARGET_ID,
      { connectionState: 'error' }
    );
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
