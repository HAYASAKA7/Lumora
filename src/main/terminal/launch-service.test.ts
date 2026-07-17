import { describe, expect, it, vi } from 'vitest';

import type {
  LaunchSettingsLayer,
  ProviderScanResult,
  TerminalProfile
} from '../../shared/contracts';
import type { SessionLaunchInfo } from '../storage/terminal-repository';
import { buildResumeArguments } from '../providers/launch-command';
import {
  createSessionCatalogRegistry,
  type SessionCatalogAdapter
} from '../providers/session-catalog-adapter';
import { SESSION_PROVIDER_IDS } from '../../shared/provider-definitions';
import { LaunchService, TerminalLaunchError } from './launch-service';

const workspaceId = 'a'.repeat(64);
const profileId = 'b'.repeat(64);
const sessionId = 'c'.repeat(64);
const nativeId = 'native-session-123';
const session: SessionLaunchInfo = {
  id: sessionId,
  title: 'Repository cleanup',
  nativeId,
  provider: 'codex',
  workspaceId,
  sourceFreshness: 'current'
};
const profile: TerminalProfile = {
  id: profileId,
  kind: 'detected',
  name: 'Bash',
  shellFamily: 'bash',
  executablePath: '/bin/bash',
  args: [],
  available: true,
  recommended: true
};
const scan: ProviderScanResult = {
  scannedAt: '2026-07-11T04:00:00.000Z',
  providers: SESSION_PROVIDER_IDS.map((provider) => ({
    provider,
    displayName: provider,
    state: 'ready' as const,
    executablePath: `/usr/local/bin/${provider}`,
    version: '1.0.0',
    issue: null
  }))
};

const sessionCatalogRegistry = createSessionCatalogRegistry(
  SESSION_PROVIDER_IDS.map(
    (provider): SessionCatalogAdapter => ({
      provider,
      discover: vi.fn(),
      buildResumeArguments: (nativeSessionId) =>
        buildResumeArguments(provider, nativeSessionId)
    })
  )
);

function captureLaunchError(action: () => unknown): TerminalLaunchError {
  try {
    action();
  } catch (error) {
    expect(error).toBeInstanceOf(TerminalLaunchError);
    return error as TerminalLaunchError;
  }
  throw new Error('Expected a terminal launch error.');
}

function harness(overrides: {
  workspace?: { id: string; canonicalPath: string; displayName: string; available: boolean } | null;
  profile?: TerminalProfile | null;
  session?: SessionLaunchInfo | null;
  scan?: ProviderScanResult;
  now?: Date;
  env?: Readonly<Record<string, string | undefined>>;
  command?: string | null;
  layers?: LaunchSettingsLayer[];
  profiles?: TerminalProfile[];
  baseline?: readonly string[] | Error;
  trusted?: boolean;
} = {}) {
  let now = overrides.now ?? new Date('2026-07-11T04:00:00.000Z');
  let currentWorkspace =
    overrides.workspace === undefined
      ? {
          id: workspaceId,
          canonicalPath: '/work/lumora',
          displayName: 'Lumora',
          available: true
        }
      : overrides.workspace;
  let currentSession = overrides.session === undefined ? session : overrides.session;
  let trusted = overrides.trusted ?? false;
  let currentLayers =
    overrides.layers ??
    (overrides.command === undefined
      ? []
      : [
          {
            scope: 'provider',
            targetId: currentSession?.provider ?? 'codex',
            settings: {
              providerCommands: {
                [currentSession?.provider ?? 'codex']: overrides.command
              }
            },
            updatedAt: '2026-07-11T04:00:00.000Z'
          } as LaunchSettingsLayer
        ]);
  const profiles =
    overrides.profiles ??
    [overrides.profile === undefined ? profile : overrides.profile].filter(
      (value): value is TerminalProfile => value !== null
    );
  const trustWorkspace = vi.fn(
    (id: string, canonicalPath: string, trustedAt: string) => {
      trusted = true;
      return { workspaceId: id, canonicalPath, trustedAt };
    }
  );
  const repository = {
    getWorkspace: vi.fn(() => currentWorkspace),
    getProfile: vi.fn(() =>
      overrides.profile === undefined ? profile : overrides.profile
    ),
    getSession: vi.fn(() => currentSession),
    getProviderLaunchCommand: vi.fn(() => overrides.command ?? null),
    listLaunchSettingsLayers: vi.fn(() => currentLayers),
    listProfiles: vi.fn(() => profiles),
    isWorkspaceTrusted: vi.fn(() => trusted),
    trustWorkspace
  };
  const captureSessionBaseline = vi.fn(async () => {
    if (overrides.baseline instanceof Error) throw overrides.baseline;
    return overrides.baseline ?? [];
  });
  const service = new LaunchService({
    repository,
    sessionCatalogRegistry,
    scanProviders: vi.fn(async () => overrides.scan ?? scan),
    isExecutablePath: vi.fn(async () => true),
    captureSessionBaseline,
    platform: 'linux',
    env: overrides.env ?? { PATH: '/usr/local/bin:/usr/bin' },
    clock: () => now,
    createToken: () => '0198f8b6-18f3-7ca0-9f0f-123456789abc'
  });
  return {
    service,
    repository,
    captureSessionBaseline,
    setNow(value: string) {
      now = new Date(value);
    },
    setSession(value: SessionLaunchInfo | null) {
      currentSession = value;
    },
    setWorkspace(value: typeof currentWorkspace) {
      currentWorkspace = value;
    },
    setTrusted(value: boolean) {
      trusted = value;
    },
    setLayers(value: LaunchSettingsLayer[]) {
      currentLayers = value;
    }
  };
}

describe('LaunchService', () => {
  it.each([
    ['codex', ['resume', nativeId]],
    ['claude', ['--resume', nativeId]],
    ['gemini', ['--resume', nativeId]],
    ['opencode', ['--session', nativeId]],
    ['copilot', ['--session-id', nativeId]],
    ['qwen', ['--resume', nativeId]]
  ] as const)('prepares a native %s resume', async (provider, args) => {
    const { service } = harness({ session: { ...session, provider } });

    await expect(
      service.prepare({
        strategy: 'resume',
        sessionId,
        terminalProfileId: profileId,
        cols: 100,
        rows: 30
      })
    ).resolves.toMatchObject({
      strategy: 'resume',
      sessionId,
      provider,
      args
    });
  });

  it('uses the catalog session title for a resumed runtime', async () => {
    const { service } = harness({ trusted: true });
    const preview = await service.prepare({
      strategy: 'resume',
      sessionId,
      terminalProfileId: profileId,
      cols: 100,
      rows: 30
    });

    await expect(service.consume(preview.launchToken)).resolves.toMatchObject({
      displayName: 'Repository cleanup'
    });
  });

  it.each([
    ['codex', 'New Codex session'],
    ['claude', 'New Claude Code session'],
    ['gemini', 'New Gemini CLI session']
  ] as const)('uses the provider fallback for a new %s runtime', async (
    provider,
    displayName
  ) => {
    const providerScan: ProviderScanResult = {
      ...scan,
      providers: provider === 'gemini'
        ? [
            ...scan.providers,
            {
              provider: 'gemini',
              displayName: 'Gemini CLI',
              state: 'ready',
              executablePath: '/usr/local/bin/gemini',
              version: '1.0.0',
              issue: null
            }
          ]
        : scan.providers
    };
    const { service, captureSessionBaseline } = harness({
      trusted: true,
      scan: providerScan
    });
    const preview = await service.prepare({
      strategy: 'new',
      provider,
      workspaceId,
      terminalProfileId: profileId,
      cols: 100,
      rows: 30
    });

    await expect(service.consume(preview.launchToken)).resolves.toMatchObject({
      displayName
    });
    expect(captureSessionBaseline).toHaveBeenCalledTimes(1);
  });

  it('rejects missing and stale sessions', async () => {
    await expect(
      harness({ session: null }).service.prepare({
        strategy: 'resume',
        sessionId,
        terminalProfileId: profileId,
        cols: 100,
        rows: 30
      })
    ).rejects.toMatchObject({ code: 'SESSION_UNAVAILABLE' });

    await expect(
      harness({
        session: { ...session, sourceFreshness: 'stale' }
      }).service.prepare({
        strategy: 'resume',
        sessionId,
        terminalProfileId: profileId,
        cols: 100,
        rows: 30
      })
    ).rejects.toMatchObject({ code: 'SESSION_UNAVAILABLE' });
  });

  it('rejects resume identity drift when consuming a token', async () => {
    const { service, setSession } = harness({ trusted: true });
    const preview = await service.prepare({
      strategy: 'resume',
      sessionId,
      terminalProfileId: profileId,
      cols: 100,
      rows: 30
    });
    setSession({ ...session, nativeId: 'replacement-native-id' });

    await expect(service.consume(preview.launchToken)).rejects.toMatchObject({
      code: 'SESSION_UNAVAILABLE'
    });
  });

  it('appends exact resume arguments to a configured provider command', async () => {
    const preview = await harness({
      command: 'opencodex --profile work',
      session: { ...session, provider: 'opencode', nativeId: 'ses_01JABC' }
    }).service.prepare({
      strategy: 'resume',
      sessionId,
      terminalProfileId: profileId,
      cols: 100,
      rows: 30
    });

    expect(preview).toMatchObject({
      strategy: 'resume',
      provider: 'opencode',
      command: 'opencodex --profile work',
      args: ['--session', 'ses_01JABC']
    });
  });

  it('resolves session settings once and consumes the immutable result', async () => {
    const sessionProfile = {
      ...profile,
      id: 'd'.repeat(64),
      name: 'Session shell',
      recommended: false
    };
    const sessionLayer = {
      scope: 'session',
      targetId: sessionId,
      settings: {
        terminalProfileId: sessionProfile.id,
        providerCommands: { codex: 'session-codex' }
      },
      updatedAt: '2026-07-13T00:00:00.000Z'
    } as LaunchSettingsLayer;
    const { service, setLayers } = harness({
      layers: [sessionLayer],
      profiles: [profile, sessionProfile],
      trusted: true
    });

    const preview = await service.prepare({
      strategy: 'resume',
      sessionId,
      terminalProfileId: null,
      cols: 100,
      rows: 30
    });
    expect(preview).toMatchObject({
      command: 'session-codex',
      terminalProfile: { id: sessionProfile.id },
      configuration: [
        { field: 'providerCommand', winningSource: { scope: 'session' } },
        { field: 'terminalProfile', winningSource: { scope: 'session' } }
      ]
    });

    setLayers([]);
    await expect(service.consume(preview.launchToken)).resolves.toMatchObject({
      command: 'session-codex',
      terminalProfile: { id: sessionProfile.id }
    });
  });

  it('captures a normalized pre-launch baseline only for new sessions', async () => {
    const { service } = harness({
      baseline: ['native-b', 'native-a', 'native-a'],
      trusted: true
    });
    const preview = await service.prepare({
      strategy: 'new',
      workspaceId,
      provider: 'codex',
      terminalProfileId: profileId,
      cols: 100,
      rows: 30
    });

    await expect(service.consume(preview.launchToken)).resolves.toMatchObject({
      reconciliationBaselineNativeIds: ['native-a', 'native-b']
    });

    const failed = harness({
      baseline: new Error('scan failed'),
      trusted: true
    }).service;
    const failedPreview = await failed.prepare({
      strategy: 'new',
      workspaceId,
      provider: 'codex',
      terminalProfileId: profileId,
      cols: 100,
      rows: 30
    });
    await expect(failed.consume(failedPreview.launchToken)).resolves.toMatchObject({
      reconciliationBaselineNativeIds: null
    });

    const resume = harness({
      baseline: new Error('must not run'),
      trusted: true
    }).service;
    const resumePreview = await resume.prepare({
      strategy: 'resume',
      sessionId,
      terminalProfileId: profileId,
      cols: 100,
      rows: 30
    });
    await expect(resume.consume(resumePreview.launchToken)).resolves.toMatchObject({
      reconciliationBaselineNativeIds: null
    });
  });

  it.each(['codex', 'claude'] as const)(
    'prepares a typed, secret-free %s launch preview',
    async (provider) => {
      const { service } = harness();
      const preview = await service.prepare({
        strategy: 'new',
        workspaceId,
        provider,
        terminalProfileId: profileId,
        cols: 120,
        rows: 36
      });

      expect(preview).toMatchObject({
        strategy: 'new',
        provider,
        executablePath: `/usr/local/bin/${provider}`,
        args: [],
        workingDirectory: '/work/lumora',
        workspaceTrusted: false,
        environmentNames: ['PATH', 'SHELL'],
        terminalProfile: profile,
        warnings: []
      });
      expect(preview.launchHash).toMatch(/^[a-f0-9]{64}$/);
      expect(JSON.stringify(preview)).not.toContain('/secret');
    }
  );

  it('blocks an untrusted prepared launch before returning its specification', async () => {
    const { service } = harness();
    const preview = await service.prepare({
      strategy: 'new',
      workspaceId,
      provider: 'codex',
      terminalProfileId: profileId,
      cols: 100,
      rows: 30
    });

    expect(preview.workspaceTrusted).toBe(false);
    await expect(service.consume(preview.launchToken)).rejects.toMatchObject({
      code: 'WORKSPACE_NOT_TRUSTED'
    });
  });

  it('reports and consumes an already trusted workspace', async () => {
    const { service } = harness({ trusted: true });
    const preview = await service.prepare({
      strategy: 'new',
      workspaceId,
      provider: 'codex',
      terminalProfileId: profileId,
      cols: 100,
      rows: 30
    });

    expect(preview.workspaceTrusted).toBe(true);
    await expect(service.consume(preview.launchToken)).resolves.toMatchObject({
      workspaceId,
      workingDirectory: '/work/lumora'
    });
  });

  it('grants trust through the exact prepared launch token', async () => {
    const { service, repository } = harness();
    const preview = await service.prepare({
      strategy: 'new',
      workspaceId,
      provider: 'codex',
      terminalProfileId: profileId,
      cols: 100,
      rows: 30
    });

    expect(service.trustWorkspaceForLaunch(preview.launchToken)).toEqual({
      workspaceId,
      canonicalPath: '/work/lumora',
      trustedAt: '2026-07-11T04:00:00.000Z'
    });
    expect(repository.trustWorkspace).toHaveBeenCalledWith(
      workspaceId,
      '/work/lumora',
      '2026-07-11T04:00:00.000Z'
    );
    await expect(service.consume(preview.launchToken)).resolves.toMatchObject({
      workspaceId
    });
  });

  it('rejects invalid or changed prepared launches when granting trust', async () => {
    const unknown = harness().service;
    expect(
      captureLaunchError(() =>
        unknown.trustWorkspaceForLaunch(
          '0198f8b6-18f3-7ca0-9f0f-123456789abd'
        )
      )
    ).toMatchObject({ code: 'LAUNCH_TOKEN_INVALID' });

    const expiredHarness = harness();
    const expiredPreview = await expiredHarness.service.prepare({
      strategy: 'new',
      workspaceId,
      provider: 'codex',
      terminalProfileId: profileId,
      cols: 100,
      rows: 30
    });
    expiredHarness.setNow('2026-07-11T04:05:00.001Z');
    expect(
      captureLaunchError(() =>
        expiredHarness.service.trustWorkspaceForLaunch(
          expiredPreview.launchToken
        )
      )
    ).toMatchObject({ code: 'LAUNCH_TOKEN_EXPIRED' });

    const unavailableHarness = harness();
    const unavailablePreview = await unavailableHarness.service.prepare({
      strategy: 'new',
      workspaceId,
      provider: 'codex',
      terminalProfileId: profileId,
      cols: 100,
      rows: 30
    });
    unavailableHarness.setWorkspace({
      id: workspaceId,
      canonicalPath: '/work/lumora',
      displayName: 'Lumora',
      available: false
    });
    expect(
      captureLaunchError(() =>
        unavailableHarness.service.trustWorkspaceForLaunch(
          unavailablePreview.launchToken
        )
      )
    ).toMatchObject({ code: 'WORKSPACE_UNAVAILABLE' });

    const driftHarness = harness();
    const driftPreview = await driftHarness.service.prepare({
      strategy: 'new',
      workspaceId,
      provider: 'codex',
      terminalProfileId: profileId,
      cols: 100,
      rows: 30
    });
    driftHarness.setWorkspace({
      id: workspaceId,
      canonicalPath: '/work/replaced',
      displayName: 'Lumora',
      available: true
    });
    expect(
      captureLaunchError(() =>
        driftHarness.service.trustWorkspaceForLaunch(driftPreview.launchToken)
      )
    ).toMatchObject({ code: 'WORKSPACE_UNAVAILABLE' });
  });

  it('prepares a launch preview with a realistic large environment', async () => {
    const env = Object.fromEntries(
      Array.from({ length: 86 }, (_, index) => [
        `LUMORA_TEST_${index}`,
        `value-${index}`
      ])
    );
    const { service } = harness({ env });

    const preview = await service.prepare({
      strategy: 'new',
      workspaceId,
      provider: 'codex',
      terminalProfileId: profileId,
      cols: 100,
      rows: 30
    });

    expect(preview.environmentNames).toHaveLength(87);
    expect(preview.environmentNames).toContain('LUMORA_TEST_85');
    expect(preview.environmentNames).toContain('SHELL');
  });

  it('captures a provider command in the immutable preview and launch hash', async () => {
    const nativePreview = await harness().service.prepare({
      strategy: 'new',
      workspaceId,
      provider: 'codex',
      terminalProfileId: profileId,
      cols: 100,
      rows: 30
    });
    const commandPreview = await harness({ command: 'codexp' }).service.prepare({
      strategy: 'new',
      workspaceId,
      provider: 'codex',
      terminalProfileId: profileId,
      cols: 100,
      rows: 30
    });

    expect(commandPreview).toMatchObject({ command: 'codexp' });
    expect(commandPreview.launchHash).not.toBe(nativePreview.launchHash);
  });

  it('consumes a launch token exactly once', async () => {
    const { service } = harness({ trusted: true });
    const preview = await service.prepare({
      strategy: 'new',
      workspaceId,
      provider: 'codex',
      terminalProfileId: profileId,
      cols: 80,
      rows: 24
    });

    await expect(service.consume(preview.launchToken)).resolves.toMatchObject({
      provider: 'codex',
      executablePath: '/usr/local/bin/codex',
      cols: 80,
      rows: 24
    });
    await expect(service.consume(preview.launchToken)).rejects.toMatchObject({
      code: 'LAUNCH_TOKEN_INVALID'
    });
  });

  it('expires prepared launches after five minutes', async () => {
    const { service, setNow } = harness();
    const preview = await service.prepare({
      strategy: 'new',
      workspaceId,
      provider: 'codex',
      terminalProfileId: profileId,
      cols: 80,
      rows: 24
    });
    setNow('2026-07-11T04:05:00.001Z');

    await expect(service.consume(preview.launchToken)).rejects.toMatchObject({
      code: 'LAUNCH_TOKEN_EXPIRED'
    });
  });

  it('rejects unavailable workspaces, profiles, and providers', async () => {
    const unavailableWorkspace = harness({
      workspace: {
        id: workspaceId,
        canonicalPath: '/work/lumora',
        displayName: 'Lumora',
        available: false
      }
    }).service;
    await expect(
      unavailableWorkspace.prepare({
        strategy: 'new',
        workspaceId,
        provider: 'codex',
        terminalProfileId: profileId,
        cols: 80,
        rows: 24
      })
    ).rejects.toBeInstanceOf(TerminalLaunchError);

    const unavailableProfile = harness({
      profile: { ...profile, available: false }
    }).service;
    await expect(
      unavailableProfile.prepare({
        strategy: 'new',
        workspaceId,
        provider: 'codex',
        terminalProfileId: profileId,
        cols: 80,
        rows: 24
      })
    ).rejects.toMatchObject({ code: 'TERMINAL_PROFILE_UNAVAILABLE' });

    const missingProviderScan: ProviderScanResult = {
      ...scan,
      providers: scan.providers.map((item) =>
        item.provider === 'codex'
          ? {
              provider: 'codex' as const,
              displayName: 'Codex',
              state: 'not_found' as const,
              executablePath: null,
              version: null,
              issue: {
                code: 'PROVIDER_NOT_FOUND' as const,
                message: 'Missing',
                recovery: 'Install Codex',
                retryable: true
              }
            }
          : item
      ) as ProviderScanResult['providers']
    };
    const unavailableProvider = harness({ scan: missingProviderScan }).service;
    await expect(
      unavailableProvider.prepare({
        strategy: 'new',
        workspaceId,
        provider: 'codex',
        terminalProfileId: profileId,
        cols: 80,
        rows: 24
      })
    ).rejects.toMatchObject({ code: 'PROVIDER_UNAVAILABLE' });
  });
});
