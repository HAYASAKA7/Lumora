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
  it('compares installed and latest versions independently', async () => {
    const service = createProviderUpdateService({
      registry: { scan: vi.fn(async () => scan()) },
      releases: {
        latestVersion: vi.fn(async (provider) =>
          provider === 'codex' ? '1.3.0' : '1.9.9'
        )
      },
      runUpdate: vi.fn(),
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
      runUpdate: vi.fn()
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
      runUpdate: vi.fn()
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
      scan: vi.fn()
        .mockResolvedValueOnce(scan())
        .mockResolvedValueOnce(scan([updatedCodex, claude]))
    };
    const runUpdate = vi.fn(async () => undefined);
    const service = createProviderUpdateService({
      registry,
      releases: { latestVersion: vi.fn() },
      runUpdate,
      now: () => new Date('2026-07-17T03:00:00.000Z')
    });

    await expect(service.update('codex')).resolves.toEqual({
      provider: 'codex',
      completedAt: '2026-07-17T03:00:00.000Z',
      installation: updatedCodex
    });
    expect(runUpdate).toHaveBeenCalledWith('/usr/bin/codex');
    expect(registry.scan).toHaveBeenCalledTimes(2);
  });

  it('rejects unavailable providers before running an updater', async () => {
    const runUpdate = vi.fn();
    const service = createProviderUpdateService({
      registry: {
        scan: async () => scan([codex, {
          provider: 'claude', displayName: 'Claude Code', state: 'not_found',
          executablePath: null, version: null,
          issue: { code: 'PROVIDER_NOT_FOUND', message: 'missing', recovery: 'install', retryable: true }
        }])
      },
      releases: { latestVersion: vi.fn() },
      runUpdate
    });

    await expect(service.update('claude')).rejects.toMatchObject({
      code: 'PROVIDER_NOT_READY'
    });
    expect(runUpdate).not.toHaveBeenCalled();
  });

  it('locks each provider while allowing the other provider to update', async () => {
    let releaseCodex!: () => void;
    const codexPending = new Promise<void>((resolve) => { releaseCodex = resolve; });
    const runUpdate = vi.fn(async (path: string) => {
      if (path.endsWith('codex')) await codexPending;
    });
    const service = createProviderUpdateService({
      registry: { scan: async () => scan() },
      releases: { latestVersion: vi.fn() },
      runUpdate
    });

    const first = service.update('codex');
    await vi.waitFor(() => expect(runUpdate).toHaveBeenCalledWith('/usr/bin/codex'));
    await expect(service.update('codex')).rejects.toMatchObject({
      code: 'PROVIDER_UPDATE_IN_PROGRESS'
    });
    await expect(service.update('claude')).resolves.toMatchObject({
      provider: 'claude'
    });
    releaseCodex();
    await expect(first).resolves.toMatchObject({ provider: 'codex' });
  });
});
