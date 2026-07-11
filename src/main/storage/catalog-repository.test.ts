import { DatabaseSync } from 'node:sqlite';

import { afterEach, describe, expect, it } from 'vitest';

import type {
  CatalogDiagnostic,
  CatalogProviderStatus,
  CatalogQuery,
  ProviderId
} from '../../shared/contracts';
import type { CanonicalWorkspacePath } from '../platform/workspace-path';
import type { CatalogCandidate } from '../catalog/catalog-candidate';
import { CatalogRepository } from './catalog-repository';
import {
  migrateCatalogDatabase,
  runMigrations,
  type CatalogMigration
} from './migrations';

const databases: DatabaseSync[] = [];

function createDatabase(): DatabaseSync {
  const database = new DatabaseSync(':memory:');
  databases.push(database);
  return database;
}

afterEach(() => {
  while (databases.length > 0) {
    databases.pop()?.close();
  }
});

function workspace(
  idCharacter: string,
  canonicalPath = '/work/lumora'
): CanonicalWorkspacePath {
  return {
    id: idCharacter.repeat(64),
    canonicalPath,
    identityKey: canonicalPath,
    displayName: canonicalPath.split('/').at(-1) || canonicalPath,
    available: true
  };
}

function candidate(overrides: Partial<CatalogCandidate> = {}): CatalogCandidate {
  return {
    provider: 'codex',
    nativeId: 'codex-session-1',
    workspace: workspace('a'),
    title: 'Catalog implementation',
    createdAt: '2026-07-11T01:00:00.000Z',
    updatedAt: '2026-07-11T02:00:00.000Z',
    source: {
      key: 'thread:codex-session-1',
      fingerprint: null
    },
    ...overrides
  };
}

const providerStatus: readonly [CatalogProviderStatus, CatalogProviderStatus] = [
  {
    provider: 'codex',
    state: 'ready',
    discoveredCount: 0,
    unchangedCount: 0,
    invalidCount: 0
  },
  {
    provider: 'claude',
    state: 'ready',
    discoveredCount: 0,
    unchangedCount: 0,
    invalidCount: 0
  }
];

const emptyQuery: CatalogQuery = { text: '', provider: null };

function snapshot(
  repository: CatalogRepository,
  query: CatalogQuery = emptyQuery,
  diagnostics: readonly CatalogDiagnostic[] = []
) {
  return repository.getSnapshot({
    query,
    refreshedAt: '2026-07-11T03:00:00.000Z',
    providerStatus,
    diagnostics
  });
}

describe('catalog migrations', () => {
  it('applies the catalog schema exactly once', () => {
    const database = createDatabase();

    migrateCatalogDatabase(database);
    migrateCatalogDatabase(database);

    const rows = database
      .prepare('SELECT version FROM schema_migration ORDER BY version')
      .all();
    expect(rows).toEqual([{ version: 1 }, { version: 2 }, { version: 3 }]);
    expect(
      database
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name"
        )
        .all()
        .map((row) => row.name)
    ).toEqual(
      expect.arrayContaining([
        'scan_error',
        'schema_migration',
        'session',
        'session_source',
        'provider_launch_config',
        'workspace'
      ])
    );
  });

  it('rolls back every statement and migration record on failure', () => {
    const database = createDatabase();
    const brokenMigration: CatalogMigration = {
      version: 1,
      statements: [
        'CREATE TABLE should_rollback (id INTEGER PRIMARY KEY)',
        'THIS IS NOT VALID SQL'
      ]
    };

    expect(() => runMigrations(database, [brokenMigration])).toThrow();
    expect(
      database
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'should_rollback'"
        )
        .get()
    ).toBeUndefined();
    expect(
      database.prepare('SELECT COUNT(*) AS count FROM schema_migration').get()
    ).toEqual({ count: 0 });
  });
});

describe('CatalogRepository', () => {
  function createRepository(): CatalogRepository {
    const database = createDatabase();
    migrateCatalogDatabase(database);
    return new CatalogRepository(database);
  }

  it('upgrades discovered workspaces to manual and never downgrades them', () => {
    const repository = createRepository();
    const discovered = workspace('a');

    repository.registerWorkspace(
      discovered,
      'discovered',
      '2026-07-11T01:00:00.000Z'
    );
    repository.registerWorkspace(
      { ...discovered, displayName: 'Lumora manual' },
      'manual',
      '2026-07-11T02:00:00.000Z'
    );
    repository.registerWorkspace(
      { ...discovered, available: false, displayName: 'Lumora moved' },
      'discovered',
      '2026-07-11T03:00:00.000Z'
    );

    expect(snapshot(repository).workspaces).toEqual([
      expect.objectContaining({
        id: discovered.id,
        origin: 'manual',
        displayName: 'Lumora moved',
        available: false
      })
    ]);
  });

  it('upserts provider sessions deterministically by native identity', () => {
    const repository = createRepository();
    const newer = candidate({
      title: 'New metadata',
      updatedAt: '2026-07-11T03:00:00.000Z',
      source: { key: 'thread:new', fingerprint: null }
    });
    const older = candidate({
      title: 'Old metadata',
      updatedAt: '2026-07-11T02:00:00.000Z',
      source: { key: 'thread:old', fingerprint: null }
    });

    repository.applyProviderScan({
      provider: 'codex',
      scanId: 'scan-1',
      scannedAt: '2026-07-11T03:01:00.000Z',
      candidates: [newer, older]
    });

    const result = snapshot(repository);
    expect(result.sessions).toHaveLength(1);
    expect(result.sessions[0]).toMatchObject({
      nativeId: 'codex-session-1',
      provider: 'codex',
      title: 'New metadata',
      updatedAt: '2026-07-11T03:00:00.000Z',
      sourceFreshness: 'current'
    });
    expect(result.workspaces[0]).toMatchObject({
      sessionCount: 1,
      providerCounts: { codex: 1, claude: 0 }
    });
  });

  it('stores and returns source fingerprints with normalized candidates', () => {
    const repository = createRepository();
    const claudeCandidate = candidate({
      provider: 'claude',
      nativeId: 'claude-session-1',
      source: {
        key: '/home/dev/.claude/projects/work/claude-session-1.jsonl',
        fingerprint: { size: 4096, modifiedAtMs: 1_720_000_000_000 }
      }
    });

    repository.applyProviderScan({
      provider: 'claude',
      scanId: 'scan-1',
      scannedAt: '2026-07-11T03:01:00.000Z',
      candidates: [claudeCandidate]
    });

    expect(
      repository.findSource('claude', claudeCandidate.source.key)
    ).toEqual({
      fingerprint: claudeCandidate.source.fingerprint,
      candidate: claudeCandidate
    });
  });

  it('marks missing sources stale without deleting their sessions', () => {
    const repository = createRepository();
    repository.applyProviderScan({
      provider: 'codex',
      scanId: 'scan-1',
      scannedAt: '2026-07-11T02:00:00.000Z',
      candidates: [candidate()]
    });
    repository.applyProviderScan({
      provider: 'codex',
      scanId: 'scan-2',
      scannedAt: '2026-07-11T03:00:00.000Z',
      candidates: []
    });

    expect(snapshot(repository).sessions).toEqual([
      expect.objectContaining({
        nativeId: 'codex-session-1',
        sourceFreshness: 'stale'
      })
    ]);
  });

  it('searches normalized metadata and filters providers with bound values', () => {
    const repository = createRepository();
    const sharedWorkspace = workspace('a', '/work/nebula');
    repository.applyProviderScan({
      provider: 'codex',
      scanId: 'codex-scan',
      scannedAt: '2026-07-11T03:00:00.000Z',
      candidates: [
        candidate({
          workspace: sharedWorkspace,
          title: 'Catalog query',
          updatedAt: '2026-07-11T03:00:00.000Z'
        })
      ]
    });
    repository.applyProviderScan({
      provider: 'claude',
      scanId: 'claude-scan',
      scannedAt: '2026-07-11T03:00:00.000Z',
      candidates: [
        candidate({
          provider: 'claude',
          nativeId: 'claude-session-2',
          workspace: sharedWorkspace,
          title: 'Storage work',
          updatedAt: '2026-07-11T02:00:00.000Z',
          source: { key: 'claude:2', fingerprint: null }
        })
      ]
    });

    expect(
      snapshot(repository, { text: 'catalog', provider: null }).sessions.map(
        (session) => session.provider
      )
    ).toEqual(['codex']);
    expect(
      snapshot(repository, { text: 'nebula', provider: 'claude' }).sessions.map(
        (session) => session.nativeId
      )
    ).toEqual(['claude-session-2']);
    expect(
      snapshot(repository, { text: "' OR 1=1 --", provider: null }).sessions
    ).toEqual([]);
  });

  it('orders equal timestamps by provider and native identity', () => {
    const repository = createRepository();
    const add = (provider: ProviderId, nativeId: string) =>
      repository.applyProviderScan({
        provider,
        scanId: `${provider}-${nativeId}`,
        scannedAt: '2026-07-11T03:00:00.000Z',
        candidates: [
          candidate({
            provider,
            nativeId,
            source: { key: `${provider}:${nativeId}`, fingerprint: null }
          })
        ]
      });

    add('claude', 'z-session');
    add('codex', 'b-session');
    add('codex', 'a-session');

    expect(
      snapshot(repository).sessions.map(
        (session) => `${session.provider}:${session.nativeId}`
      )
    ).toEqual(['claude:z-session', 'codex:a-session', 'codex:b-session']);
  });
});
