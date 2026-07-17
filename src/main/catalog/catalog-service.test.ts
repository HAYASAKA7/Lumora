import { describe, expect, it, vi } from 'vitest';

import type {
  CatalogDiagnostic,
  CatalogProviderId,
  CatalogProviderStatus,
  CatalogQuery,
  ProviderInstallation,
  ProviderScanResult
} from '../../shared/contracts';
import type { CanonicalWorkspacePath } from '../platform/workspace-path';
import type {
  ProviderSessionDiscoveryResult,
  ProviderSessionRecord
} from '../providers/session-discovery';
import { CatalogService } from './catalog-service';

function ready(provider: CatalogProviderId): ProviderInstallation {
  return {
    provider,
    displayName: provider === 'codex' ? 'Codex' : 'Claude Code',
    state: 'ready',
    executablePath: `/tools/${provider}`,
    version: `${provider} 1.0.0`,
    issue: null
  };
}

function missing(provider: CatalogProviderId): ProviderInstallation {
  const displayName = provider === 'codex' ? 'Codex' : 'Claude Code';
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
  codex: ProviderInstallation = ready('codex'),
  claude: ProviderInstallation = ready('claude')
): ProviderScanResult {
  return {
    scannedAt: '2026-07-11T03:00:00.000Z',
    providers: [codex, claude]
  };
}

function record(
  provider: CatalogProviderId,
  nativeId: string,
  workspacePath = `/work/${provider}`
): ProviderSessionRecord {
  return {
    provider,
    nativeId,
    workspacePath,
    title: `${provider} session`,
    createdAt: '2026-07-11T01:00:00.000Z',
    updatedAt: '2026-07-11T02:00:00.000Z',
    source: { key: `${provider}:${nativeId}`, fingerprint: null }
  };
}

function discovery(
  provider: CatalogProviderId,
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

function canonicalWorkspace(path: string): CanonicalWorkspacePath {
  const character = path.includes('claude') ? 'b' : 'a';
  return {
    id: character.repeat(64),
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
    getSnapshot: vi.fn(
      ({
        query,
        refreshedAt,
        providerStatus,
        diagnostics
      }: {
        query: CatalogQuery;
        refreshedAt: string;
        providerStatus: readonly [
          CatalogProviderStatus,
          CatalogProviderStatus
        ];
        diagnostics: readonly CatalogDiagnostic[];
      }) => ({
        refreshedAt,
        workspaces: [],
        sessions: [],
        providerStatus: [...providerStatus],
        diagnostics: [...diagnostics],
        querySeenByTest: query
      })
    )
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

describe('CatalogService', () => {
  it('discovers providers concurrently and commits them in stable order', async () => {
    const repository = createRepository();
    const codexResult = deferred<ProviderSessionDiscoveryResult>();
    const claudeResult = deferred<ProviderSessionDiscoveryResult>();
    const discoverCodex = vi.fn(async () => codexResult.promise);
    const discoverClaude = vi.fn(async () => claudeResult.promise);
    const service = new CatalogService({
      scanProviders: async () => scan(),
      discoverCodex,
      discoverClaude,
      canonicalizeWorkspace: async (path) => canonicalWorkspace(path),
      repository,
      clock: () => new Date('2026-07-11T03:00:00.000Z'),
      createScanId: vi
        .fn()
        .mockReturnValueOnce('scan-codex')
        .mockReturnValueOnce('scan-claude')
    });

    const refresh = service.refreshCatalog({ text: '', provider: null });
    await vi.waitFor(() => {
      expect(discoverCodex).toHaveBeenCalledOnce();
      expect(discoverClaude).toHaveBeenCalledOnce();
    });
    claudeResult.resolve(discovery('claude', [record('claude', 'claude-1')]));
    codexResult.resolve(discovery('codex', [record('codex', 'codex-1')]));
    const result = await refresh;

    expect(repository.applyProviderScan.mock.calls.map((call) => call[0].provider)).toEqual([
      'codex',
      'claude'
    ]);
    expect(repository.applyProviderScan.mock.calls[0]![0]).toEqual({
      provider: 'codex',
      scanId: 'scan-codex',
      scannedAt: '2026-07-11T03:00:00.000Z',
      candidates: [
        expect.objectContaining({
          provider: 'codex',
          nativeId: 'codex-1',
          workspace: canonicalWorkspace('/work/codex')
        })
      ]
    });
    expect(result.providerStatus).toEqual([
      {
        provider: 'codex',
        state: 'ready',
        discoveredCount: 1,
        unchangedCount: 0,
        invalidCount: 0
      },
      {
        provider: 'claude',
        state: 'ready',
        discoveredCount: 1,
        unchangedCount: 0,
        invalidCount: 0
      }
    ]);
  });

  it('does not scan or overwrite unavailable provider data', async () => {
    const repository = createRepository();
    const discoverCodex = vi.fn();
    const service = new CatalogService({
      scanProviders: async () => scan(missing('codex'), ready('claude')),
      discoverCodex,
      discoverClaude: async () => discovery('claude', []),
      canonicalizeWorkspace: async (path) => canonicalWorkspace(path),
      repository,
      clock: () => new Date('2026-07-11T03:00:00.000Z'),
      createScanId: () => 'scan-1'
    });

    const result = await service.refreshCatalog();

    expect(discoverCodex).not.toHaveBeenCalled();
    expect(repository.applyProviderScan).toHaveBeenCalledTimes(1);
    expect(repository.applyProviderScan.mock.calls[0]![0].provider).toBe('claude');
    expect(result.providerStatus[0]!.state).toBe('unavailable');
    expect(result.diagnostics).toEqual([
      expect.objectContaining({
        code: 'CATALOG_PROVIDER_UNAVAILABLE',
        provider: 'codex'
      })
    ]);
  });

  it('isolates discovery and database failures while preserving other providers', async () => {
    const repository = createRepository();
    repository.applyProviderScan.mockImplementation(({ provider }) => {
      if (provider === 'claude') {
        throw new Error('database detail must stay private');
      }
    });
    const service = new CatalogService({
      scanProviders: async () => scan(),
      discoverCodex: async () => {
        throw new Error('protocol detail must stay private');
      },
      discoverClaude: async () =>
        discovery('claude', [record('claude', 'claude-1')]),
      canonicalizeWorkspace: async (path) => canonicalWorkspace(path),
      repository,
      clock: () => new Date('2026-07-11T03:00:00.000Z'),
      createScanId: () => 'scan-1'
    });

    const result = await service.refreshCatalog();

    expect(repository.applyProviderScan).toHaveBeenCalledTimes(1);
    expect(result.providerStatus.map((status) => status.state)).toEqual([
      'failed',
      'failed'
    ]);
    expect(result.diagnostics).toEqual([
      expect.objectContaining({
        code: 'CATALOG_PROTOCOL_FAILED',
        provider: 'codex'
      }),
      expect.objectContaining({
        code: 'CATALOG_DATABASE_FAILED',
        provider: 'claude'
      })
    ]);
    expect(JSON.stringify(result)).not.toContain('detail must stay private');
  });

  it('isolates invalid records and canonicalization failures within one provider', async () => {
    const repository = createRepository();
    const service = new CatalogService({
      scanProviders: async () => scan(),
      discoverCodex: async () =>
        discovery(
          'codex',
          [
            record('codex', 'valid'),
            record('codex', 'moved', '/missing/workspace')
          ],
          2
        ),
      discoverClaude: async () => discovery('claude', []),
      canonicalizeWorkspace: async (path) => {
        if (path.startsWith('/missing')) {
          throw new Error('unusable path');
        }
        return canonicalWorkspace(path);
      },
      repository,
      clock: () => new Date('2026-07-11T03:00:00.000Z'),
      createScanId: () => 'scan-1'
    });

    const result = await service.refreshCatalog();

    expect(repository.applyProviderScan.mock.calls[0]![0].candidates).toHaveLength(1);
    expect(result.providerStatus[0]).toMatchObject({
      state: 'ready',
      discoveredCount: 1,
      invalidCount: 3
    });
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: 'CATALOG_SOURCE_INVALID',
        provider: 'codex',
        affectedCount: 3
      })
    );
  });

  it('registers only canonical manual workspaces without scanning providers', async () => {
    const repository = createRepository();
    const scanProviders = vi.fn();
    const service = new CatalogService({
      scanProviders,
      discoverCodex: vi.fn(),
      discoverClaude: vi.fn(),
      canonicalizeWorkspace: async (path) => canonicalWorkspace(path),
      repository,
      clock: () => new Date('2026-07-11T03:00:00.000Z'),
      createScanId: () => 'scan-1'
    });

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
    const service = new CatalogService({
      scanProviders: async () => scan(),
      discoverCodex: async () => discovery('codex', []),
      discoverClaude: async () => discovery('claude', []),
      canonicalizeWorkspace: async (path) => canonicalWorkspace(path),
      repository,
      clock: () => new Date('2026-07-11T03:00:00.000Z'),
      createScanId: () => 'scan-1'
    });

    service.getCatalog({ text: '  storage  ', provider: 'claude' });

    expect(repository.getSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({
        query: { text: 'storage', provider: 'claude' }
      })
    );
    expect(() =>
      service.getCatalog({ text: 'x'.repeat(121), provider: null })
    ).toThrow();
  });
});
