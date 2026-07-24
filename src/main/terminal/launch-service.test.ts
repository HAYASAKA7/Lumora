import { describe, expect, it, vi } from 'vitest';

import type {
  GeneralSettings,
  LaunchSettingsLayer,
  ProviderScanResult,
  TerminalProfile
} from '../../shared/contracts';
import { DEFAULT_GENERAL_SETTINGS } from '../../shared/contracts';
import type { HandoffPlan } from '../handoff/handoff-service';
import type { SessionLaunchInfo } from '../storage/terminal-repository';
import {
  buildForkArguments,
  buildResumeArguments
} from '../providers/launch-command';
import {
  createSessionCatalogRegistry,
  type SessionCatalogAdapter
} from '../providers/session-catalog-adapter';
import {
  SESSION_PROVIDER_IDS,
  hasNativeForkSupport
} from '../../shared/provider-definitions';
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
    version:
      provider === 'codex'
        ? 'codex-cli 0.145.0'
        : provider === 'claude'
          ? '2.1.212 (Claude Code)'
          : provider === 'opencode'
            ? '1.18.4'
            : '1.0.0',
    issue: null
  }))
};

const sessionCatalogRegistry = createSessionCatalogRegistry(
  SESSION_PROVIDER_IDS.map(
    (provider): SessionCatalogAdapter => ({
      provider,
      discover: vi.fn(),
      validateCompatibility: () => ({ compatible: true }),
      buildResumeArguments: (nativeSessionId) =>
        buildResumeArguments(provider, nativeSessionId),
      ...(hasNativeForkSupport(provider) && {
        buildForkArguments: (nativeSessionId: string, task: string) =>
          buildForkArguments(provider, nativeSessionId, task)
      }),
      snapshotHandoff: vi.fn(async () => ({
        raw: '{"messages":[]}',
        sourceFiles: ['/tmp/source.json']
      }))
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
  sessionCatalogRegistry?: ReturnType<typeof createSessionCatalogRegistry>;
  generalSettings?: GeneralSettings;
  sourceKeys?: readonly string[];
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
    getGeneralSettings: vi.fn(() =>
      overrides.generalSettings ?? DEFAULT_GENERAL_SETTINGS
    ),
    listCurrentSessionSourceKeys: vi.fn(() =>
      [...(overrides.sourceKeys ?? ['/sessions/codex.jsonl'])]
    ),
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
  let currentScan: ProviderScanResult = overrides.scan ?? scan;
  const handoffPlan: HandoffPlan = {
    id: '019c0000-0000-7000-8000-000000000010',
    sourceSessionId: sessionId,
    sourceNativeId: nativeId,
    sourceProvider: 'codex',
    destinationProvider: 'claude',
    retentionDays: 30,
    directory: '/data/handoffs/019c0000-0000-7000-8000-000000000010',
    sourceDirectory: '/data/handoffs/019c0000-0000-7000-8000-000000000010/source',
    contextDirectory: '/data/handoffs/019c0000-0000-7000-8000-000000000010/context',
    manifestPath: '/data/handoffs/019c0000-0000-7000-8000-000000000010/manifest.json',
    prompt: 'Read the managed Lumora handoff context.',
    createdAt: '2026-07-11T04:00:00.000Z',
    expiresAt: '2026-08-10T04:00:00.000Z'
  };
  const handoffService = {
    reserve: vi.fn(() => handoffPlan),
    materialize: vi.fn(async (
      plan: HandoffPlan,
      acquire: (sourceDirectory: string) => Promise<unknown>
    ) => {
      await acquire(plan.sourceDirectory);
      return { manifestPath: plan.manifestPath, contextFiles: [] };
    })
  };
  const service = new LaunchService({
    repository,
    sessionCatalogRegistry: overrides.sessionCatalogRegistry ?? sessionCatalogRegistry,
    scanProviders: vi.fn(async () => currentScan),
    isExecutablePath: vi.fn(async () => true),
    captureSessionBaseline,
    handoffService,
    platform: 'linux',
    env: overrides.env ?? { PATH: '/usr/local/bin:/usr/bin' },
    clock: () => now,
    createToken: () => '0198f8b6-18f3-7ca0-9f0f-123456789abc'
  });
  return {
    service,
    repository,
    captureSessionBaseline,
    handoffService,
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
    },
    setScan(value: ProviderScanResult) {
      currentScan = value;
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

  it('keeps native resume unchanged when its optional provider matches', async () => {
    const { service, handoffService } = harness({ trusted: true });
    const preview = await service.prepare({
      strategy: 'resume',
      sessionId,
      provider: 'codex',
      terminalProfileId: profileId,
      cols: 100,
      rows: 30
    });

    expect(preview).toMatchObject({
      strategy: 'resume',
      sessionId,
      provider: 'codex',
      args: ['resume', nativeId]
    });
    await service.consume(preview.launchToken);
    expect(handoffService.reserve).not.toHaveBeenCalled();
    expect(handoffService.materialize).not.toHaveBeenCalled();
  });

  it('rejects a different resume provider while cross-agent handoff is disabled', async () => {
    await expect(harness().service.prepare({
      strategy: 'resume',
      sessionId,
      provider: 'claude',
      terminalProfileId: profileId,
      cols: 100,
      rows: 30
    })).rejects.toMatchObject({ code: 'CROSS_AGENT_DISABLED' });
  });

  it.each([
    ['codex', ['fork', nativeId, 'Fix the failing tests.']],
    ['claude', ['--resume', nativeId, '--fork-session', 'Fix the failing tests.']],
    ['opencode', ['--session', nativeId, '--fork', '--prompt', 'Fix the failing tests.']]
  ] as const)('prepares and consumes a native %s fork as an unlinked new identity', async (
    provider,
    args
  ) => {
    const {
      service,
      captureSessionBaseline,
      handoffService
    } = harness({
      trusted: true,
      session: { ...session, provider },
      baseline: ['existing-native']
    });
    const preview = await service.prepare({
      strategy: 'fork',
      sessionId,
      task: 'Fix the failing tests.',
      terminalProfileId: profileId,
      cols: 100,
      rows: 30
    });

    expect(preview).toMatchObject({
      strategy: 'fork',
      sessionId: null,
      provider,
      args
    });
    await expect(service.consume(preview.launchToken)).resolves.toMatchObject({
      displayName: 'Fork of Repository cleanup',
      strategy: 'fork',
      sessionId: null,
      nativeSessionId: null,
      reconciliationBaselineNativeIds: ['existing-native'],
      fork: {
        sourceSessionId: sessionId,
        sourceNativeSessionId: nativeId,
        task: 'Fix the failing tests.'
      }
    });
    expect(captureSessionBaseline).toHaveBeenCalledWith(provider, workspaceId);
    expect(handoffService.reserve).not.toHaveBeenCalled();
    expect(handoffService.materialize).not.toHaveBeenCalled();
  });

  it('bounds a native fork title to the runtime contract limit', async () => {
    const { service } = harness({
      trusted: true,
      session: { ...session, title: 'x'.repeat(256) }
    });
    const preview = await service.prepare({
      strategy: 'fork',
      sessionId,
      task: 'Continue safely.',
      terminalProfileId: profileId,
      cols: 100,
      rows: 30
    });

    const spec = await service.consume(preview.launchToken);
    expect(spec.displayName).toHaveLength(256);
    expect(spec.displayName).toBe(`Fork of ${'x'.repeat(248)}`);
  });

  it('uses a configured provider command for a native fork', async () => {
    const { service } = harness({
      command: 'codexp --profile work',
      trusted: true
    });
    const preview = await service.prepare({
      strategy: 'fork',
      sessionId,
      task: 'Fix the failing tests.',
      terminalProfileId: profileId,
      cols: 100,
      rows: 30
    });

    expect(preview).toMatchObject({
      command: 'codexp --profile work',
      args: ['fork', nativeId, 'Fix the failing tests.']
    });
    await expect(service.consume(preview.launchToken)).resolves.toMatchObject({
      command: 'codexp --profile work'
    });
  });

  it('rejects native fork for an installed CLI below the tested minimum', async () => {
    const oldScan: ProviderScanResult = {
      ...scan,
      providers: scan.providers.map((installation) =>
        installation.provider === 'codex' &&
        installation.state === 'ready'
          ? { ...installation, version: 'codex-cli 0.119.9' }
          : installation
      )
    };

    await expect(harness({ scan: oldScan }).service.prepare({
      strategy: 'fork',
      sessionId,
      task: 'Fix the failing tests.',
      terminalProfileId: profileId,
      cols: 100,
      rows: 30
    })).rejects.toMatchObject({ code: 'NATIVE_FORK_UNAVAILABLE' });
  });

  it('rejects a prepared fork when the installed CLI is downgraded', async () => {
    const { service, setScan } = harness({ trusted: true });
    const preview = await service.prepare({
      strategy: 'fork',
      sessionId,
      task: 'Fix the failing tests.',
      terminalProfileId: profileId,
      cols: 100,
      rows: 30
    });
    setScan({
      ...scan,
      providers: scan.providers.map((installation) =>
        installation.provider === 'codex' &&
        installation.state === 'ready'
          ? { ...installation, version: 'codex-cli 0.119.9' }
          : installation
      )
    });

    await expect(service.consume(preview.launchToken)).rejects.toMatchObject({
      code: 'NATIVE_FORK_UNAVAILABLE'
    });
  });

  it('rejects native fork when the provider adapter has no fork capability', async () => {
    await expect(harness({
      session: { ...session, provider: 'gemini' }
    }).service.prepare({
      strategy: 'fork',
      sessionId,
      task: 'Fix the failing tests.',
      terminalProfileId: profileId,
      cols: 100,
      rows: 30
    })).rejects.toMatchObject({ code: 'NATIVE_FORK_UNAVAILABLE' });
  });

  it('invalidates a native fork when the source identity changes after preview', async () => {
    const { service, setSession } = harness({
      trusted: true,
      baseline: ['existing-native']
    });
    const preview = await service.prepare({
      strategy: 'fork',
      sessionId,
      task: 'Fix the failing tests.',
      terminalProfileId: profileId,
      cols: 100,
      rows: 30
    });
    setSession({ ...session, nativeId: 'changed-native' });

    await expect(service.consume(preview.launchToken)).rejects.toMatchObject({
      code: 'LAUNCH_TOKEN_INVALID'
    });
  });

  it('materializes a trusted cross-agent handoff and launches a new destination session', async () => {
    const enabled: GeneralSettings = {
      ...DEFAULT_GENERAL_SETTINGS,
      crossAgentWorkflowEnabled: true
    };
    const { service, handoffService, captureSessionBaseline } = harness({
      trusted: true,
      generalSettings: enabled,
      baseline: ['claude-existing']
    });
    const preview = await service.prepare({
      strategy: 'resume',
      sessionId,
      provider: 'claude',
      terminalProfileId: profileId,
      cols: 100,
      rows: 30
    });

    expect(preview).toMatchObject({
      strategy: 'new',
      sessionId: null,
      provider: 'claude',
      args: ['Read the managed Lumora handoff context.']
    });
    expect(handoffService.materialize).not.toHaveBeenCalled();
    await expect(service.consume(preview.launchToken)).resolves.toMatchObject({
      strategy: 'new',
      sessionId: null,
      nativeSessionId: null,
      provider: 'claude',
      reconciliationBaselineNativeIds: ['claude-existing']
    });
    expect(handoffService.materialize).toHaveBeenCalledTimes(1);
    expect(
      sessionCatalogRegistry.get('codex')?.snapshotHandoff
    ).toHaveBeenCalledWith(expect.objectContaining({
      nativeSessionId: nativeId,
      sourceKeys: ['/sessions/codex.jsonl']
    }));
    expect(captureSessionBaseline).toHaveBeenCalledWith('claude', workspaceId);
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
    await expect(service.consume(preview.launchToken)).rejects.toMatchObject({
      code: 'LAUNCH_TOKEN_INVALID'
    });
  });

  it('revalidates provider identity and adapter compatibility at consumption', async () => {
    const incompatibleRegistry = createSessionCatalogRegistry(
      SESSION_PROVIDER_IDS.map(
        (provider): SessionCatalogAdapter => ({
          provider,
          discover: vi.fn(),
          validateCompatibility: () =>
            provider === 'codex'
              ? { compatible: false, recovery: 'Update Codex.' }
              : { compatible: true },
          buildResumeArguments: (id) => buildResumeArguments(provider, id),
          snapshotHandoff: vi.fn()
        })
      )
    );
    const providerHarness = harness({ trusted: true });
    const providerPreview = await providerHarness.service.prepare({
      strategy: 'new', workspaceId, provider: 'codex', terminalProfileId: profileId,
      cols: 80, rows: 24
    });
    providerHarness.setScan({
      ...scan,
      providers: scan.providers.map((installation) =>
        installation.provider === 'codex' && installation.state === 'ready'
          ? { ...installation, executablePath: '/usr/local/bin/codex-new' }
          : installation
      )
    });
    await expect(providerHarness.service.consume(providerPreview.launchToken))
      .rejects.toMatchObject({ code: 'PROVIDER_UNAVAILABLE' });

    const compatibilityHarness = harness({
      trusted: true,
      sessionCatalogRegistry: incompatibleRegistry
    });
    await expect(compatibilityHarness.service.prepare({
      strategy: 'resume', sessionId, terminalProfileId: profileId,
      cols: 80, rows: 24
    })).rejects.toMatchObject({ code: 'PROVIDER_UNAVAILABLE' });
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
