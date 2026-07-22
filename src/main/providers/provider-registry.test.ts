import { describe, expect, it, vi } from 'vitest';

import type { ProviderInstallation } from '../../shared/contracts';
import { PROVIDER_DEFINITIONS } from '../../shared/provider-definitions';
import {
  createProviderAdapters,
  type ProviderAdapter
} from './provider-adapter';
import { ProviderRegistry } from './provider-registry';

const readyCodex: ProviderInstallation = {
  provider: 'codex',
  displayName: 'Codex',
  state: 'ready',
  executablePath: '/tools/codex',
  version: 'codex-cli 1.2.3',
  issue: null
};

describe('provider adapters', () => {
  it('builds every shipped provider adapter in stable UI order', () => {
    const adapters = createProviderAdapters({
      findExecutable: vi.fn(),
      probeVersion: vi.fn()
    });

    expect(adapters.map(({ provider }) => provider)).toEqual(
      PROVIDER_DEFINITIONS.map(({ provider }) => provider)
    );
  });

  it('detects and probes a provider with its fixed version arguments', async () => {
    const findExecutable = vi.fn(async () => '/tools/copilot');
    const probeVersion = vi.fn(async () => 'GitHub Copilot CLI 1.2.3');
    const adapter = createProviderAdapters({
      findExecutable,
      probeVersion
    }).find(({ provider }) => provider === 'copilot')!;

    await expect(adapter.scan()).resolves.toMatchObject({
      provider: 'copilot',
      displayName: 'GitHub Copilot CLI',
      state: 'ready',
      version: 'GitHub Copilot CLI 1.2.3'
    });
    expect(findExecutable).toHaveBeenCalledWith('copilot');
    expect(probeVersion).toHaveBeenCalledWith('/tools/copilot', ['version']);
  });

  it('returns an actionable missing state', async () => {
    const adapter = createProviderAdapters({
      findExecutable: async () => null,
      probeVersion: async () => {
        throw new Error('must not run');
      }
    }).find(({ provider }) => provider === 'gemini')!;

    await expect(adapter.scan()).resolves.toMatchObject({
      provider: 'gemini',
      displayName: 'Gemini CLI',
      state: 'not_found',
      executablePath: null,
      version: null,
      issue: {
        code: 'PROVIDER_NOT_FOUND',
        recovery: 'Install Gemini CLI or add it to PATH, then refresh.'
      }
    });
  });

  it('shows the provider-specific version command after a probe failure', async () => {
    const adapter = createProviderAdapters({
      findExecutable: async () => '/tools/copilot',
      probeVersion: async () => {
        throw new Error('probe failed');
      }
    }).find(({ provider }) => provider === 'copilot')!;

    await expect(adapter.scan()).resolves.toMatchObject({
      provider: 'copilot',
      state: 'probe_failed',
      issue: {
        recovery: 'Run copilot version in a terminal, then refresh.'
      }
    });
  });
});

describe('ProviderRegistry', () => {
  it('scans only requested providers while preserving adapter order', async () => {
    const scanCodex = vi.fn(async () => readyCodex);
    const scanGemini = vi.fn(async () => ({
      provider: 'gemini' as const,
      displayName: 'Gemini CLI',
      state: 'not_found' as const,
      executablePath: null,
      version: null,
      issue: {
        code: 'PROVIDER_NOT_FOUND' as const,
        message: 'missing',
        recovery: 'install',
        retryable: true
      }
    }));
    const registry = new ProviderRegistry([
      { ...identity('codex', 'Codex'), scan: scanCodex },
      { ...identity('gemini', 'Gemini CLI'), scan: scanGemini }
    ]);

    const result = await registry.scan(['gemini']);

    expect(result.providers.map(({ provider }) => provider)).toEqual(['gemini']);
    expect(scanCodex).not.toHaveBeenCalled();
    expect(scanGemini).toHaveBeenCalledOnce();
  });

  it('keeps adapter order when scans resolve out of order', async () => {
    let resolveCodex!: (value: ProviderInstallation) => void;
    const codexResult = new Promise<ProviderInstallation>((resolve) => {
      resolveCodex = resolve;
    });
    const gemini: ProviderInstallation = {
      provider: 'gemini',
      displayName: 'Gemini CLI',
      state: 'not_found',
      executablePath: null,
      version: null,
      issue: {
        code: 'PROVIDER_NOT_FOUND',
        message: 'Gemini CLI was not found on PATH.',
        recovery: 'Install Gemini CLI or add it to PATH, then refresh.',
        retryable: true
      }
    };
    const registry = new ProviderRegistry(
      [
        { ...identity('codex', 'Codex'), scan: () => codexResult },
        { ...identity('gemini', 'Gemini CLI'), scan: async () => gemini }
      ],
      () => new Date('2026-07-11T01:02:03.000Z')
    );

    const scanPromise = registry.scan();
    resolveCodex(readyCodex);

    await expect(scanPromise).resolves.toEqual({
      scannedAt: '2026-07-11T01:02:03.000Z',
      providers: [readyCodex, gemini]
    });
  });

  it('isolates an unexpected adapter failure to that provider', async () => {
    const registry = new ProviderRegistry(
      [
        {
          ...identity('codex', 'Codex'),
          scan: async () => {
            throw new Error('unexpected failure');
          }
        },
        {
          ...identity('gemini', 'Gemini CLI'),
          scan: async () => ({
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
          })
        }
      ],
      () => new Date('2026-07-11T01:02:03.000Z')
    );

    const result = await registry.scan();

    expect(result.providers[0]).toMatchObject({
      provider: 'codex',
      state: 'probe_failed',
      issue: { code: 'PROVIDER_SCAN_FAILED' }
    });
    expect(result.providers[1]?.provider).toBe('gemini');
  });
});

function identity(
  provider: ProviderAdapter['provider'],
  displayName: string
): Pick<ProviderAdapter, 'provider' | 'displayName'> {
  return { provider, displayName };
}
