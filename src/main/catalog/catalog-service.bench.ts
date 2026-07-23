import { afterAll, bench, describe } from 'vitest';

import type {
  CatalogQuery,
  CatalogSnapshot,
  ProviderId
} from '../../shared/contracts';
import { CatalogService } from './catalog-service';

const SESSION_COUNT = 150;
const WORKSPACE_COUNT = 30;
let lastCanonicalizationCount = 0;

const sessions = Array.from({ length: SESSION_COUNT }, (_, index) => ({
  provider: 'codex' as const,
  nativeId: `benchmark-session-${index}`,
  workspacePath: `/benchmark/workspace-${index % WORKSPACE_COUNT}`,
  title: `Benchmark session ${index}`,
  createdAt: '2026-07-23T07:00:00.000Z',
  updatedAt: '2026-07-23T07:30:00.000Z',
  lifetimeTokens: index * 1_000,
  source: {
    key: `thread:benchmark-session-${index}`,
    fingerprint: null
  }
}));

function snapshot(options: {
  query: CatalogQuery;
  refreshedAt: string;
  providerStatus: CatalogSnapshot['providerStatus'];
  availableProviders: readonly ProviderId[];
  diagnostics: CatalogSnapshot['diagnostics'];
}): CatalogSnapshot {
  return {
    refreshedAt: options.refreshedAt,
    workspaces: [],
    sessions: [],
    providerStatus: [...options.providerStatus],
    providerFacets: [],
    diagnostics: [...options.diagnostics]
  };
}

describe('catalog refresh', () => {
  bench('150 sessions across 30 workspaces', async () => {
    let canonicalizationCount = 0;
    const service = new CatalogService({
      scanProviders: async () => ({
        scannedAt: '2026-07-23T07:30:00.000Z',
        providers: [
          {
            provider: 'codex',
            displayName: 'Codex',
            state: 'ready',
            executablePath: '/benchmark/codex',
            version: 'codex 1.0.0',
            issue: null
          }
        ]
      }),
      enabledProviders: () => ['codex'],
      registry: {
        providers: () => ['codex'],
        get: (provider) =>
          provider === 'codex'
            ? {
                provider: 'codex',
                validateCompatibility: () => ({ compatible: true }),
                discover: async () => ({
                  provider: 'codex',
                  sessions,
                  discoveredCount: sessions.length,
                  unchangedCount: sessions.length,
                  invalidCount: 0
                }),
                buildResumeArguments: () => [],
                snapshotHandoff: async () => ({
                  raw: '',
                  sourceFiles: []
                })
              }
            : null
      },
      canonicalizeWorkspace: async (path) => {
        canonicalizationCount += 1;
        const index = Number.parseInt(path.split('-').at(-1) ?? '0', 10);
        return {
          id: index.toString(16).padStart(64, '0'),
          identityKey: path,
          canonicalPath: path,
          displayName: path.split('/').at(-1) ?? path,
          available: true
        };
      },
      repository: {
        applyProviderScan: () => undefined,
        registerWorkspace: () => undefined,
        getSnapshot: snapshot
      },
      clock: () => new Date('2026-07-23T07:30:00.000Z'),
      createScanId: () => 'benchmark-scan'
    });

    await service.refreshCatalog();
    lastCanonicalizationCount = canonicalizationCount;
  });
});

afterAll(() => {
  console.info(
    `Catalog benchmark operation count: ${lastCanonicalizationCount} canonicalizations for ${SESSION_COUNT} sessions in ${WORKSPACE_COUNT} workspaces.`
  );
});
