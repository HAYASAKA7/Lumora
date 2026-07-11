import { describe, expect, it, vi } from 'vitest';

import type { ProviderScanResult, TerminalProfile } from '../../shared/contracts';
import type { SessionLaunchInfo } from '../storage/terminal-repository';
import { LaunchService, TerminalLaunchError } from './launch-service';

const workspaceId = 'a'.repeat(64);
const profileId = 'b'.repeat(64);
const sessionId = 'c'.repeat(64);
const nativeId = 'native-session-123';
const session: SessionLaunchInfo = {
  id: sessionId,
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
  providers: [
    {
      provider: 'codex',
      displayName: 'Codex',
      state: 'ready',
      executablePath: '/usr/local/bin/codex',
      version: '1.0.0',
      issue: null
    },
    {
      provider: 'claude',
      displayName: 'Claude Code',
      state: 'ready',
      executablePath: '/usr/local/bin/claude',
      version: '2.0.0',
      issue: null
    }
  ]
};

function harness(overrides: {
  workspace?: { id: string; canonicalPath: string; displayName: string; available: boolean } | null;
  profile?: TerminalProfile | null;
  session?: SessionLaunchInfo | null;
  scan?: ProviderScanResult;
  now?: Date;
  env?: Readonly<Record<string, string | undefined>>;
  command?: string | null;
} = {}) {
  let now = overrides.now ?? new Date('2026-07-11T04:00:00.000Z');
  let currentSession = overrides.session === undefined ? session : overrides.session;
  const repository = {
    getWorkspace: vi.fn(() =>
      overrides.workspace === undefined
        ? {
            id: workspaceId,
            canonicalPath: '/work/lumora',
            displayName: 'Lumora',
            available: true
          }
        : overrides.workspace
    ),
    getProfile: vi.fn(() =>
      overrides.profile === undefined ? profile : overrides.profile
    ),
    getSession: vi.fn(() => currentSession),
    getProviderLaunchCommand: vi.fn(() => overrides.command ?? null)
  };
  const service = new LaunchService({
    repository,
    scanProviders: vi.fn(async () => overrides.scan ?? scan),
    isExecutablePath: vi.fn(async () => true),
    platform: 'linux',
    env: overrides.env ?? { PATH: '/usr/local/bin:/usr/bin' },
    clock: () => now,
    createToken: () => '0198f8b6-18f3-7ca0-9f0f-123456789abc'
  });
  return {
    service,
    setNow(value: string) {
      now = new Date(value);
    },
    setSession(value: SessionLaunchInfo | null) {
      currentSession = value;
    }
  };
}

describe('LaunchService', () => {
  it.each([
    ['codex', ['resume', nativeId]],
    ['claude', ['--resume', nativeId]]
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
    const { service, setSession } = harness();
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
        environmentNames: ['PATH', 'SHELL'],
        terminalProfile: profile,
        warnings: []
      });
      expect(preview.launchHash).toMatch(/^[a-f0-9]{64}$/);
      expect(JSON.stringify(preview)).not.toContain('/secret');
    }
  );

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
    const { service } = harness();
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
