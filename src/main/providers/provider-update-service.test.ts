import { describe, expect, it, vi } from 'vitest';

import type {
  ProviderInstallation,
  ProviderScanResult
} from '../../shared/contracts';
import { createProviderUpdateService } from './provider-update-service';

const codex: ProviderInstallation = {
  provider: 'codex',
  displayName: 'Codex',
  state: 'ready',
  executablePath: '/usr/bin/codex',
  version: 'codex-cli 1.2.3',
  issue: null
};
const claude: ProviderInstallation = {
  provider: 'claude',
  displayName: 'Claude Code',
  state: 'ready',
  executablePath: '/usr/bin/claude',
  version: '2.0.0 (Claude Code)',
  issue: null
};

function scan(
  providers: ProviderInstallation[] = [codex, claude]
): ProviderScanResult {
  return { scannedAt: '2026-07-17T01:00:00.000Z', providers };
}

describe('ProviderUpdateService.check', () => {
  it('checks only enabled providers and rejects disabled lifecycle actions', async () => {
    const releases = { latestVersion: vi.fn(async () => '2.0.0') };
    const runLifecycle = vi.fn();
    const service = createProviderUpdateService({
      registry: { scan: vi.fn(async () => scan()) },
      enabledProviders: () => ['codex'],
      releases,
      runLifecycle
    });

    await expect(service.check()).resolves.toMatchObject({
      providers: [{ provider: 'codex' }]
    });
    expect(releases.latestVersion).toHaveBeenCalledOnce();
    await expect(service.update('claude')).rejects.toMatchObject({
      code: 'PROVIDER_NOT_READY',
      message: 'Claude Code is disabled in Lumora settings.'
    });
    expect(runLifecycle).not.toHaveBeenCalled();
  });

  it('compares installed and latest versions independently', async () => {
    const service = createProviderUpdateService({
      registry: { scan: vi.fn(async () => scan()) },
      releases: {
        latestVersion: vi.fn(async (provider) =>
          provider === 'codex' ? '1.3.0' : '1.9.9'
        )
      },
      runLifecycle: vi.fn(),
      now: () => new Date('2026-07-17T02:00:00.000Z')
    });

    await expect(service.check()).resolves.toEqual({
      checkedAt: '2026-07-17T02:00:00.000Z',
      providers: [
        {
          provider: 'codex',
          displayName: 'Codex',
          state: 'update_available',
          installedVersion: '1.2.3',
          latestVersion: '1.3.0',
          issue: null
        },
        {
          provider: 'claude',
          displayName: 'Claude Code',
          state: 'up_to_date',
          installedVersion: '2.0.0',
          latestVersion: '1.9.9',
          issue: null
        }
      ]
    });
  });

  it('isolates not-ready, invalid-version, and release failures', async () => {
    const missingClaude: ProviderInstallation = {
      provider: 'claude',
      displayName: 'Claude Code',
      state: 'not_found',
      executablePath: null,
      version: null,
      issue: {
        code: 'PROVIDER_NOT_FOUND',
        message: 'missing',
        recovery: 'install',
        retryable: true
      }
    };
    const releases = { latestVersion: vi.fn(async () => '1.3.0') };
    const notReady = createProviderUpdateService({
      registry: { scan: async () => scan([{ ...codex, version: 'unknown' }, missingClaude]) },
      releases,
      runLifecycle: vi.fn()
    });

    const result = await notReady.check();
    expect(result.providers.map((provider) => [
      provider.provider,
      provider.state,
      provider.issue?.code
    ])).toEqual([
      ['codex', 'unavailable', 'PROVIDER_VERSION_INVALID'],
      ['claude', 'unavailable', 'PROVIDER_NOT_READY']
    ]);
    expect(releases.latestVersion).not.toHaveBeenCalled();

    const releaseFailure = createProviderUpdateService({
      registry: { scan: async () => scan() },
      releases: {
        latestVersion: async (provider) => {
          if (provider === 'codex') throw new Error('offline');
          return '2.0.0';
        }
      },
      runLifecycle: vi.fn()
    });
    const isolated = await releaseFailure.check();
    expect(isolated.providers[0]).toMatchObject({
      provider: 'codex',
      state: 'unavailable',
      issue: { code: 'PROVIDER_RELEASE_UNAVAILABLE' }
    });
    expect(isolated.providers[1]).toMatchObject({
      provider: 'claude',
      state: 'up_to_date'
    });
  });
});

describe('ProviderUpdateService.update', () => {
  it('resolves a fresh executable and returns the post-update scan', async () => {
    const updatedCodex = { ...codex, version: 'codex-cli 1.3.0' };
    const registry = {
      scan: vi.fn().mockResolvedValue(scan()),
      scanFresh: vi.fn().mockResolvedValue(scan([updatedCodex, claude]))
    };
    const runLifecycle = vi.fn(async () => undefined);
    const service = createProviderUpdateService({
      registry,
      releases: { latestVersion: vi.fn() },
      runLifecycle,
      now: () => new Date('2026-07-17T03:00:00.000Z')
    });

    await expect(service.update('codex')).resolves.toEqual({
      provider: 'codex',
      completedAt: '2026-07-17T03:00:00.000Z',
      installation: updatedCodex
    });
    expect(runLifecycle).toHaveBeenCalledWith('codex');
    expect(registry.scan).toHaveBeenCalledOnce();
    expect(registry.scanFresh).toHaveBeenCalledOnce();
  });

  it('rejects unavailable providers before running an updater', async () => {
    const runLifecycle = vi.fn();
    const service = createProviderUpdateService({
      registry: {
        scan: async () => scan([codex, {
          provider: 'claude', displayName: 'Claude Code', state: 'not_found',
          executablePath: null, version: null,
          issue: { code: 'PROVIDER_NOT_FOUND', message: 'missing', recovery: 'install', retryable: true }
        }])
      },
      releases: { latestVersion: vi.fn() },
      runLifecycle
    });

    await expect(service.update('claude')).rejects.toMatchObject({
      code: 'PROVIDER_NOT_READY'
    });
    expect(runLifecycle).not.toHaveBeenCalled();
  });

  it('locks each provider while allowing the other provider to update', async () => {
    let releaseCodex!: () => void;
    const codexPending = new Promise<void>((resolve) => { releaseCodex = resolve; });
    const runLifecycle = vi.fn(async (provider: string) => {
      if (provider === 'codex') await codexPending;
    });
    const service = createProviderUpdateService({
      registry: { scan: async () => scan() },
      releases: { latestVersion: vi.fn() },
      runLifecycle
    });

    const first = service.update('codex');
    await vi.waitFor(() => expect(runLifecycle).toHaveBeenCalledWith('codex'));
    await expect(service.update('codex')).rejects.toMatchObject({
      code: 'PROVIDER_UPDATE_IN_PROGRESS'
    });
    await expect(service.update('claude')).resolves.toMatchObject({
      provider: 'claude'
    });
    releaseCodex();
    await expect(first).resolves.toMatchObject({ provider: 'codex' });
  });

  it('rejects npm updates for guide-only providers', async () => {
    const aider: ProviderInstallation = {
      provider: 'aider',
      displayName: 'Aider',
      state: 'ready',
      executablePath: '/usr/bin/aider',
      version: 'aider 0.82.0',
      issue: null
    };
    const runLifecycle = vi.fn();
    const service = createProviderUpdateService({
      registry: { scan: async () => scan([aider]) },
      releases: { latestVersion: vi.fn() },
      runLifecycle
    });

    await expect(service.update('aider')).rejects.toMatchObject({
      code: 'PROVIDER_UPDATE_GUIDE_REQUIRED'
    });
    expect(runLifecycle).not.toHaveBeenCalled();
  });

  it('directs guide-only providers to their official update instructions', async () => {
    const aider: ProviderInstallation = {
      provider: 'aider',
      displayName: 'Aider',
      state: 'ready',
      executablePath: '/usr/bin/aider',
      version: 'aider 0.82.0',
      issue: null
    };
    const releases = { latestVersion: vi.fn() };
    const service = createProviderUpdateService({
      registry: { scan: async () => scan([aider]) },
      releases,
      runLifecycle: vi.fn()
    });

    await expect(service.check()).resolves.toMatchObject({
      providers: [
        {
          provider: 'aider',
          state: 'unavailable',
          issue: {
            code: 'PROVIDER_RELEASE_UNAVAILABLE',
            recovery: 'Use the official Aider installation guide to check for updates.',
            retryable: false
          }
        }
      ]
    });
    expect(releases.latestVersion).not.toHaveBeenCalled();
  });
});

describe('ProviderUpdateService.install', () => {
  it('installs a missing npm provider and returns its fresh scan', async () => {
    const missingGemini: ProviderInstallation = {
      provider: 'gemini',
      displayName: 'Gemini CLI',
      state: 'not_found',
      executablePath: null,
      version: null,
      issue: {
        code: 'PROVIDER_NOT_FOUND',
        message: 'missing',
        recovery: 'install',
        retryable: true
      }
    };
    const readyGemini: ProviderInstallation = {
      provider: 'gemini',
      displayName: 'Gemini CLI',
      state: 'ready',
      executablePath: '/usr/bin/gemini',
      version: '1.2.3',
      issue: null
    };
    const registry = {
      scan: vi.fn().mockResolvedValue(scan([missingGemini])),
      scanFresh: vi.fn().mockResolvedValue(scan([readyGemini]))
    };
    const runLifecycle = vi.fn(async () => undefined);
    const service = createProviderUpdateService({
      registry,
      releases: { latestVersion: vi.fn() },
      runLifecycle,
      now: () => new Date('2026-07-17T03:10:00.000Z')
    });

    await expect(service.install('gemini')).resolves.toEqual({
      provider: 'gemini',
      completedAt: '2026-07-17T03:10:00.000Z',
      installation: readyGemini
    });
    expect(runLifecycle).toHaveBeenCalledWith('gemini');
    expect(registry.scanFresh).toHaveBeenCalledOnce();
  });

  it('does not reinstall a provider that is already ready', async () => {
    const runLifecycle = vi.fn();
    const service = createProviderUpdateService({
      registry: { scan: async () => scan([codex]) },
      releases: { latestVersion: vi.fn() },
      runLifecycle
    });

    await expect(service.install('codex')).rejects.toMatchObject({
      code: 'PROVIDER_ALREADY_INSTALLED'
    });
    expect(runLifecycle).not.toHaveBeenCalled();
  });
});
