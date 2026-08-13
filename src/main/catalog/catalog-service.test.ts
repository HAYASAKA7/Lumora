import { describe, expect, it, vi } from 'vitest';

import type {
  CatalogDiagnostic,
  CatalogProviderStatus,
  CatalogQuery,
  ProviderId,
  ProviderInstallation,
  ProviderScanResult
} from '../../shared/contracts';
import {
  SESSION_PROVIDER_IDS,
  providerDefinition
} from '../../shared/provider-definitions';
import type { CanonicalWorkspacePath } from '../platform/workspace-path';
import type { CatalogTransferSession } from '../storage/catalog-repository';
import {
  createSessionCatalogRegistry,
  type SessionCatalogAdapter
} from '../providers/session-catalog-adapter';
import type {
  ProviderSessionDiscoveryResult,
  ProviderSessionRecord
} from '../providers/session-discovery';
import { CatalogService } from './catalog-service';

function ready(provider: ProviderId): ProviderInstallation {
  const definition = providerDefinition(provider);
  return {
    provider,
    displayName: definition.displayName,
    state: 'ready',
    executablePath: `/tools/${provider}`,
    version: `${provider} 1.0.0`,
    issue: null
  };
}

function missing(provider: ProviderId): ProviderInstallation {
  const displayName = providerDefinition(provider).displayName;
  return {
    provider,
    displayName,
    state: 'not_found',
    executablePath: null,
    version: null,
    issue: {
      code: 'PROVIDER_NOT_FOUND',
      message: `${displayName} was not found.`,
      recovery: `Install ${displayName}, then refresh.`,
      retryable: true
    }
  };
}

function scan(
  providers: readonly ProviderInstallation[] = SESSION_PROVIDER_IDS.map(ready)
): ProviderScanResult {
  return {
    scannedAt: '2026-07-11T03:00:00.000Z',
    providers: [...providers]
  };
}

function record(
  provider: ProviderId,
  nativeId: string,
  workspacePath = `/work/${provider}`,
  lifetimeTokens: number | null = null
): ProviderSessionRecord {
  return {
    provider,
    nativeId,
    workspacePath,
    title: `${provider} session`,
    createdAt: '2026-07-11T01:00:00.000Z',
    updatedAt: '2026-07-11T02:00:00.000Z',
    lifetimeTokens,
    source: { key: `${provider}:${nativeId}`, fingerprint: null }
  };
}

function discovery(
  provider: ProviderId,
  sessions: readonly ProviderSessionRecord[],
  invalidCount = 0,
  unchangedCount = 0
): ProviderSessionDiscoveryResult {
  return {
    provider,
    sessions,
    discoveredCount: sessions.length,
    unchangedCount,
    invalidCount
  };
}

function adapter(
  provider: ProviderId,
  discover: SessionCatalogAdapter['discover'] = vi.fn(async () =>
    discovery(provider, [])
  ),
  validateCompatibility: SessionCatalogAdapter['validateCompatibility'] = () => ({
    compatible: true
  })
): SessionCatalogAdapter {
  return {
    provider,
    discover,
    validateCompatibility,
    buildResumeArguments: (nativeId) => [nativeId],
    snapshotHandoff: vi.fn()
  };
}

function registry(
  overrides: Partial<Record<ProviderId, SessionCatalogAdapter['discover']>> = {}
) {
  return createSessionCatalogRegistry(
    SESSION_PROVIDER_IDS.map((provider) =>
      adapter(provider, overrides[provider] as SessionCatalogAdapter['discover'])
    )
  );
}

function canonicalWorkspace(path: string): CanonicalWorkspacePath {
  const index = Math.max(
    0,
    SESSION_PROVIDER_IDS.findIndex((provider) => path.includes(provider))
  );
  return {
    id: String.fromCharCode(97 + index).repeat(64),
    canonicalPath: path,
    identityKey: path,
    displayName: path.split('/').at(-1) ?? path,
    available: true
  };
}

function createRepository() {
  return {
    applyProviderScan: vi.fn(),
    registerWorkspace: vi.fn(),
    getTransferSession: vi.fn<
      (sessionId: string) => CatalogTransferSession | null
    >(() => null),
    getTransferSessionProvider: vi.fn<
      (sessionId: string) => ProviderId | null
    >(() => null),
    hasNativeSession: vi.fn(() => false),
    getSnapshot: vi.fn(
      ({
        query,
        refreshedAt,
        providerStatus,
        availableProviders,
        diagnostics
      }: {
        query: CatalogQuery;
        refreshedAt: string;
        providerStatus: readonly CatalogProviderStatus[];
        availableProviders: readonly ProviderId[];
        diagnostics: readonly CatalogDiagnostic[];
      }) => ({
        refreshedAt,
        workspaces: [],
        sessions: [],
        providerStatus: [...providerStatus],
        providerFacets: [],
        diagnostics: [...diagnostics],
        querySeenByTest: query,
        availableProvidersSeenByTest: availableProviders
      })
    )
  };
}

function dependencies(overrides: Record<string, unknown> = {}) {
  return {
    scanProviders: async () => scan(),
    enabledProviders: () => SESSION_PROVIDER_IDS,
    registry: registry(),
    canonicalizeWorkspace: async (path: string) => canonicalWorkspace(path),
    repository: createRepository(),
    clock: () => new Date('2026-07-11T03:00:00.000Z'),
    createScanId: vi.fn((provider: ProviderId) => `scan-${provider}`),
    ...overrides
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

describe('CatalogService', () => {
  it('bounds concurrent provider session discovery', async () => {
    const providers = ['codex', 'claude', 'gemini', 'opencode', 'copilot'] as const;
    const gates = providers.map(() => {
      let resolve!: () => void;
      const promise = new Promise<void>((done) => { resolve = done; });
      return { promise, resolve };
    });
    let active = 0;
    let maximumActive = 0;
    const discoveryOverrides = Object.fromEntries(
      providers.map((provider, index) => [provider, async () => {
        active += 1;
        maximumActive = Math.max(maximumActive, active);
        await gates[index]!.promise;
        active -= 1;
        return discovery(provider, []);
      }])
    ) as Partial<Record<ProviderId, SessionCatalogAdapter['discover']>>;
    const adapters = registry(discoveryOverrides);
    const service = new CatalogService(dependencies({
      enabledProviders: () => providers,
      scanProviders: async () => scan(providers.map(ready)),
      registry: adapters,
      discoveryConcurrency: 2
    }));

    const pending = service.refreshCatalog();
    await Promise.resolve();
    await Promise.resolve();
    expect(maximumActive).toBe(2);
    gates[0]!.resolve();
    gates[1]!.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(maximumActive).toBe(2);
    gates.slice(2).forEach(({ resolve }) => resolve());

    await pending;
    expect(maximumActive).toBe(2);
  });

  it('discovers and exposes only enabled providers without touching disabled scans', async () => {
    let enabledProviders: readonly ProviderId[] = ['codex'];
    const repository = createRepository();
    const adapters = registry();
    const service = new CatalogService(
      dependencies({
        repository,
        registry: adapters,
        enabledProviders: () => enabledProviders,
        scanProviders: async () => scan([ready('codex'), ready('claude')])
      })
    );

    const codexSnapshot = await service.refreshCatalog();

    expect(adapters.get('codex')!.discover).toHaveBeenCalledOnce();
    expect(adapters.get('claude')!.discover).not.toHaveBeenCalled();
    expect(repository.applyProviderScan.mock.calls.map(([value]) => value.provider))
      .toEqual(['codex']);
    expect(codexSnapshot.providerStatus.map(({ provider }) => provider))
      .toEqual(['codex']);
    expect(repository.getSnapshot).toHaveBeenLastCalledWith(
      expect.objectContaining({ availableProviders: ['codex'] })
    );

    enabledProviders = ['claude'];
    service.getCatalog();
    expect(repository.getSnapshot).toHaveBeenLastCalledWith(
      expect.objectContaining({
        providerStatus: [],
        availableProviders: []
      })
    );

    await service.refreshCatalog();
    expect(adapters.get('claude')!.discover).toHaveBeenCalledOnce();
    expect(repository.applyProviderScan.mock.calls.map(([value]) => value.provider))
      .toEqual(['codex', 'claude']);
    expect(repository.getSnapshot).toHaveBeenLastCalledWith(
      expect.objectContaining({ availableProviders: ['claude'] })
    );
  });

  it('coalesces concurrent scans while preserving each caller query', async () => {
    const repository = createRepository();
    const pendingScan = deferred<ProviderScanResult>();
    const scanProviders = vi.fn(() => pendingScan.promise);
    const service = new CatalogService(
      dependencies({ repository, scanProviders })
    );

    const codex = service.refreshCatalog({
      text: 'codex',
      provider: 'codex'
    });
    const claude = service.refreshCatalog({
      text: 'claude',
      provider: 'claude'
    });

    expect(scanProviders).toHaveBeenCalledOnce();
    pendingScan.resolve(scan());
    const [codexSnapshot, claudeSnapshot] = await Promise.all([
      codex,
      claude
    ]);

    expect(scanProviders).toHaveBeenCalledOnce();
    expect(codexSnapshot).toMatchObject({
      querySeenByTest: { text: 'codex', provider: 'codex' }
    });
    expect(claudeSnapshot).toMatchObject({
      querySeenByTest: { text: 'claude', provider: 'claude' }
    });
  });

  it('queues a fresh scan when enabled providers change during an in-flight refresh', async () => {
    let enabledProviders: readonly ProviderId[] = ['codex'];
    const firstScan = deferred<ProviderScanResult>();
    const scanProviders = vi
      .fn()
      .mockImplementationOnce(() => firstScan.promise)
      .mockResolvedValueOnce(scan([ready('codex'), ready('claude')]));
    const adapters = registry();
    const service = new CatalogService(
      dependencies({
        enabledProviders: () => enabledProviders,
        registry: adapters,
        scanProviders
      })
    );

    const codexRefresh = service.refreshCatalog();
    enabledProviders = ['codex', 'claude'];
    const expandedRefresh = service.refreshCatalog();

    expect(scanProviders).toHaveBeenCalledOnce();
    firstScan.resolve(scan([ready('codex')]));
    await codexRefresh;
    await expandedRefresh;

    expect(scanProviders).toHaveBeenCalledTimes(2);
    expect(adapters.get('claude')!.discover).toHaveBeenCalledOnce();
    expect(
      service.getCatalog().providerStatus.map(({ provider }) => provider)
    ).toEqual(['codex', 'claude']);
  });

  it('starts a fresh scan after a coalesced scan rejects', async () => {
    const scanProviders = vi
      .fn()
      .mockRejectedValueOnce(new Error('scan unavailable'))
      .mockResolvedValueOnce(scan());
    const service = new CatalogService(dependencies({ scanProviders }));

    await expect(service.refreshCatalog()).rejects.toThrow('scan unavailable');
    await expect(service.refreshCatalog()).resolves.toMatchObject({
      providerStatus: expect.any(Array)
    });

    expect(scanProviders).toHaveBeenCalledTimes(2);
  });

  it('discovers complete providers in bounded batches and commits in definition order', async () => {
    const repository = createRepository();
    const pending = new Map(
      SESSION_PROVIDER_IDS.map((provider) => [
        provider,
        deferred<ProviderSessionDiscoveryResult>()
      ])
    );
    const adapters = registry(
      Object.fromEntries(
        SESSION_PROVIDER_IDS.map((provider) => [
          provider,
          vi.fn(async () => pending.get(provider)!.promise)
        ])
      )
    );
    const service = new CatalogService(
      dependencies({ repository, registry: adapters })
    );

    const refresh = service.refreshCatalog();
    for (let offset = 0; offset < SESSION_PROVIDER_IDS.length; offset += 3) {
      const batch = SESSION_PROVIDER_IDS.slice(offset, offset + 3);
      await vi.waitFor(() => {
        for (const provider of batch) {
          expect(adapters.get(provider)!.discover).toHaveBeenCalledOnce();
        }
      });
      for (const provider of [...batch].reverse()) {
        pending
          .get(provider)!
          .resolve(discovery(provider, [record(provider, `${provider}-1`)]));
      }
    }
    const result = await refresh;

    expect(
      repository.applyProviderScan.mock.calls.map((call) => call[0].provider)
    ).toEqual(SESSION_PROVIDER_IDS);
    expect(result.providerStatus.map(({ provider, state }) => ({ provider, state })))
      .toEqual(
        SESSION_PROVIDER_IDS.map((provider) => ({ provider, state: 'ready' }))
      );
    expect(repository.getSnapshot).toHaveBeenLastCalledWith(
      expect.objectContaining({ availableProviders: SESSION_PROVIDER_IDS })
    );
    expect(adapters.get('aider')).toBeNull();
  });

  it('copies provider lifetime token totals into catalog candidates', async () => {
    const repository = createRepository();
    const adapters = registry({
      codex: vi.fn(async () =>
        discovery('codex', [
          record('codex', 'codex-usage', '/work/codex', 42_000)
        ])
      )
    });
    const service = new CatalogService(
      dependencies({
        repository,
        registry: adapters,
        scanProviders: async () => scan([ready('codex')])
      })
    );

    await service.refreshCatalog();

    expect(repository.applyProviderScan).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'codex',
        candidates: [expect.objectContaining({ lifetimeTokens: 42_000 })]
      })
    );
  });

  it('canonicalizes each unique workspace path once per refresh', async () => {
    const repository = createRepository();
    const canonicalizeWorkspace = vi.fn(async (path: string) =>
      canonicalWorkspace(path)
    );
    const adapters = registry({
      codex: vi.fn(async () =>
        discovery('codex', [
          record('codex', 'codex-1', '/work/shared'),
          record('codex', 'codex-2', '/work/shared'),
          record('codex', 'codex-3', '/work/other'),
          record('codex', 'codex-4', '/work/shared')
        ])
      )
    });
    const service = new CatalogService(
      dependencies({
        repository,
        registry: adapters,
        canonicalizeWorkspace,
        scanProviders: async () => scan([ready('codex')])
      })
    );

    await service.refreshCatalog();

    expect(canonicalizeWorkspace).toHaveBeenCalledTimes(2);
    expect(canonicalizeWorkspace.mock.calls.map(([path]) => path)).toEqual([
      '/work/shared',
      '/work/other'
    ]);
    expect(repository.applyProviderScan).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'codex',
        candidates: expect.arrayContaining([
          expect.objectContaining({ nativeId: 'codex-1' }),
          expect.objectContaining({ nativeId: 'codex-4' })
        ])
      })
    );
    expect(
      repository.applyProviderScan.mock.calls[0]![0].candidates
    ).toHaveLength(4);
  });

  it('does not scan unavailable or launch-only providers', async () => {
    const repository = createRepository();
    const adapters = registry();
    const service = new CatalogService(
      dependencies({
        repository,
        registry: adapters,
        scanProviders: async () =>
          scan([missing('codex'), ready('claude'), missing('aider')])
      })
    );

    const result = await service.refreshCatalog();

    expect(adapters.get('codex')!.discover).not.toHaveBeenCalled();
    expect(adapters.get('claude')!.discover).toHaveBeenCalledOnce();
    expect(repository.applyProviderScan).toHaveBeenCalledTimes(1);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: 'CATALOG_PROVIDER_UNAVAILABLE',
        provider: 'codex'
      })
    );
    expect(result.diagnostics.some(({ provider }) => provider === 'aider')).toBe(
      false
    );
    expect(repository.getSnapshot).toHaveBeenLastCalledWith(
      expect.objectContaining({ availableProviders: ['claude'] })
    );
  });

  it('isolates discovery and database failures while preserving other providers', async () => {
    const repository = createRepository();
    repository.applyProviderScan.mockImplementation(({ provider }) => {
      if (provider === 'claude') {
        throw new Error('database detail must stay private');
      }
    });
    const adapters = registry({
      codex: vi.fn(async () => {
        throw new Error('protocol detail must stay private');
      }),
      claude: vi.fn(async () =>
        discovery('claude', [record('claude', 'claude-1')])
      )
    });
    const service = new CatalogService(
      dependencies({ repository, registry: adapters })
    );

    const result = await service.refreshCatalog();

    expect(result.providerStatus.slice(0, 2).map(({ state }) => state)).toEqual([
      'failed',
      'failed'
    ]);
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'CATALOG_PROTOCOL_FAILED',
          provider: 'codex'
        }),
        expect.objectContaining({
          code: 'CATALOG_DATABASE_FAILED',
          provider: 'claude'
        })
      ])
    );
    expect(JSON.stringify(result)).not.toContain('detail must stay private');
  });

  it('hides an incompatible installed provider without running discovery', async () => {
    const repository = createRepository();
    const incompatibleDiscovery = vi.fn(async () => discovery('qwen', []));
    const adapters = createSessionCatalogRegistry(
      SESSION_PROVIDER_IDS.map((provider) =>
        provider === 'qwen'
          ? adapter(provider, incompatibleDiscovery, () => ({
              compatible: false,
              recovery: 'Update Qwen Code and refresh.'
            }))
          : adapter(provider)
      )
    );
    const service = new CatalogService(
      dependencies({ repository, registry: adapters })
    );

    const result = await service.refreshCatalog();

    expect(incompatibleDiscovery).not.toHaveBeenCalled();
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: 'CATALOG_PROVIDER_INCOMPATIBLE',
        provider: 'qwen',
        recovery: 'Update Qwen Code and refresh.'
      })
    );
    expect(repository.getSnapshot).toHaveBeenLastCalledWith(
      expect.objectContaining({
        availableProviders: expect.not.arrayContaining(['qwen'])
      })
    );
  });

  it('isolates invalid records and canonicalization failures within one provider', async () => {
    const repository = createRepository();
    const adapters = registry({
      codex: vi.fn(async () =>
        discovery(
          'codex',
          [record('codex', 'valid'), record('codex', 'moved', '/missing/workspace')],
          2
        )
      )
    });
    const service = new CatalogService(
      dependencies({
        repository,
        registry: adapters,
        canonicalizeWorkspace: async (path: string) => {
          if (path.startsWith('/missing')) throw new Error('unusable path');
          return canonicalWorkspace(path);
        }
      })
    );

    const result = await service.refreshCatalog();

    expect(repository.applyProviderScan.mock.calls[0]![0].candidates).toHaveLength(1);
    expect(repository.applyProviderScan.mock.calls[0]![0]).toMatchObject({
      preserveMissingSources: true
    });
    expect(result.providerStatus[0]).toMatchObject({
      provider: 'codex',
      state: 'ready',
      discoveredCount: 1,
      invalidCount: 3
    });
  });

  it('registers canonical manual workspaces without scanning providers', async () => {
    const repository = createRepository();
    const scanProviders = vi.fn();
    const service = new CatalogService(
      dependencies({ repository, scanProviders })
    );

    await service.registerWorkspace('/work/manual');

    expect(repository.registerWorkspace).toHaveBeenCalledWith(
      canonicalWorkspace('/work/manual'),
      'manual',
      '2026-07-11T03:00:00.000Z'
    );
    expect(scanProviders).not.toHaveBeenCalled();
  });

  it('validates and forwards catalog queries to the repository', () => {
    const repository = createRepository();
    const service = new CatalogService(dependencies({ repository }));

    service.getCatalog({ text: '  storage  ', provider: 'gemini' });

    expect(repository.getSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({
        query: { text: 'storage', provider: 'gemini' },
        availableProviders: []
      })
    );
    expect(() =>
      service.getCatalog({ text: 'x'.repeat(121), provider: null })
    ).toThrow();
  });

  it('exposes narrow transfer-safe catalog lookups', () => {
    const transferSession = {
      id: 'a'.repeat(64),
      provider: 'opencode' as const,
      nativeId: 'ses_transfer',
      title: 'Transfer session',
      workspaceId: 'b'.repeat(64),
      workspacePath: '/work/transfer',
      sourceKeys: ['opencode:ses_transfer']
    };
    const repository = createRepository();
    repository.getTransferSession.mockReturnValue(transferSession);
    repository.getTransferSessionProvider.mockReturnValue('opencode');
    repository.hasNativeSession.mockReturnValue(true);
    const service = new CatalogService(dependencies({ repository }));

    expect(service.getTransferSession(transferSession.id)).toEqual(
      transferSession
    );
    expect(service.getTransferSessionProvider(transferSession.id)).toBe('opencode');
    expect(service.hasNativeSession('opencode', 'ses_transfer')).toBe(true);
    expect(repository.getTransferSession).toHaveBeenCalledWith(
      transferSession.id
    );
    expect(repository.getTransferSessionProvider).toHaveBeenCalledWith(
      transferSession.id
    );
    expect(repository.hasNativeSession).toHaveBeenCalledWith(
      'opencode',
      'ses_transfer'
    );
  });
});
