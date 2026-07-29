import { describe, expect, it } from 'vitest';

import type { ProviderTransferAdapter } from './transfer-adapter';
import { createTransferAdapterRegistry } from './transfer-adapter-registry';

function fakeAdapter(provider: ProviderTransferAdapter['provider']): ProviderTransferAdapter {
  return {
    provider,
    capabilities: () => ({ export: true, import: true }),
    exportSession: async () => {
      throw new Error('not used');
    },
    inspectImport: async () => {
      throw new Error('not used');
    },
    importSession: async () => {
      throw new Error('not used');
    },
    verifyImportedSession: async () => false,
    rollbackImport: async () => undefined
  };
}

describe('transfer adapter registry', () => {
  it('keeps unverified provider routes visible but unavailable', () => {
    const registry = createTransferAdapterRegistry({
      adapters: [fakeAdapter('opencode')],
      verifiedRoutes: []
    });
    const capabilities = registry.capabilities('win32');

    expect(
      capabilities.find(({ provider }) => provider === 'claude')
    ).toMatchObject({ export: 'route_unverified', import: 'route_unverified' });
    expect(
      capabilities.find(({ provider }) => provider === 'opencode')
    ).toMatchObject({ export: 'route_unverified', import: 'route_unverified' });
  });

  it('rejects duplicate adapter registration', () => {
    expect(() =>
      createTransferAdapterRegistry({
        adapters: [fakeAdapter('opencode'), fakeAdapter('opencode')],
        verifiedRoutes: []
      })
    ).toThrow(/duplicate/i);
  });

  it('enables only an exact evidence-backed platform and provider version route', () => {
    const registry = createTransferAdapterRegistry({
      adapters: [fakeAdapter('opencode')],
      verifiedRoutes: [
        {
          provider: 'opencode',
          sourcePlatform: 'win32',
          destinationPlatform: 'darwin',
          providerVersion: '1.15.7',
          verifiedAt: '2026-07-29T00:00:00.000Z',
          lumoraCommit: 'a'.repeat(40),
          evidenceId: 'b'.repeat(64)
        }
      ],
      providerState: () => ({
        installed: true,
        enabled: true,
        version: '1.15.7'
      })
    });

    expect(registry.capabilities('darwin', 'win32').find(({ provider }) => provider === 'opencode')).toMatchObject({
      export: 'supported',
      import: 'supported'
    });
    expect(registry.capabilities('linux', 'win32').find(({ provider }) => provider === 'opencode')).toMatchObject({
      import: 'route_unverified'
    });
  });

  it('lets installed and enabled state override verified routes', () => {
    const route = {
      provider: 'opencode' as const,
      sourcePlatform: 'win32' as const,
      destinationPlatform: 'win32' as const,
      providerVersion: '1.15.7',
      verifiedAt: '2026-07-29T00:00:00.000Z',
      lumoraCommit: 'a'.repeat(40),
      evidenceId: 'b'.repeat(64)
    };
    const missing = createTransferAdapterRegistry({
      adapters: [fakeAdapter('opencode')],
      verifiedRoutes: [route],
      providerState: () => ({ installed: false, enabled: true, version: null })
    });
    expect(
      missing
        .capabilities('win32')
        .find(({ provider }) => provider === 'opencode')
    ).toMatchObject({
      provider: 'opencode',
      export: 'provider_not_installed',
      import: 'provider_not_installed'
    });
  });
});
