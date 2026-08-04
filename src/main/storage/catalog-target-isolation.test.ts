import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';

import type { CatalogCandidate } from '../catalog/catalog-candidate';
import { CatalogRepository } from './catalog-repository';
import { migrateCatalogDatabase } from './migrations';

const remoteId = '4f632901-1f8d-44c0-8418-aa823f791ca0';
const timestamp = '2026-08-04T01:00:00.000Z';

function candidate(options: {
  workspaceId: string;
  title: string;
}): CatalogCandidate {
  return {
    provider: 'codex',
    nativeId: 'shared-native-id',
    workspace: {
      id: options.workspaceId,
      identityKey: 'path:/work/shared',
      canonicalPath: '/work/shared',
      displayName: 'Shared',
      available: true
    },
    title: options.title,
    createdAt: timestamp,
    updatedAt: timestamp,
    lifetimeTokens: 10,
    source: {
      key: '/sessions/shared.jsonl',
      fingerprint: { size: 10, modifiedAtMs: 20 }
    }
  };
}

function snapshot(repository: CatalogRepository) {
  return repository.getSnapshot({
    query: { text: '', provider: null },
    refreshedAt: timestamp,
    providerStatus: [],
    availableProviders: ['codex'],
    diagnostics: []
  });
}

describe('CatalogRepository execution-target isolation', () => {
  let database: DatabaseSync | null = null;

  afterEach(() => {
    database?.close();
    database = null;
  });

  it('isolates identical provider identities and source keys by target', () => {
    database = new DatabaseSync(':memory:');
    migrateCatalogDatabase(database);
    database.prepare(
      `INSERT INTO execution_target (
        id, kind, display_name, platform, architecture, connection_state,
        helper_version, protocol_version, capabilities_json,
        last_connected_at, last_scanned_at
      ) VALUES (?, 'remote', 'Server', 'linux', 'x64', 'offline',
        NULL, NULL, '[]', NULL, NULL)`
    ).run(remoteId);
    const local = new CatalogRepository(database, 'local');
    const remote = new CatalogRepository(database, remoteId);

    local.applyProviderScan({
      provider: 'codex',
      scanId: 'local-scan',
      scannedAt: timestamp,
      candidates: [candidate({ workspaceId: 'a'.repeat(64), title: 'Local' })]
    });
    remote.applyProviderScan({
      provider: 'codex',
      scanId: 'remote-scan',
      scannedAt: timestamp,
      candidates: [candidate({ workspaceId: 'b'.repeat(64), title: 'Remote' })]
    });

    expect(snapshot(local).sessions.map(({ title }) => title)).toEqual(['Local']);
    expect(snapshot(remote).sessions.map(({ title }) => title)).toEqual(['Remote']);
    expect(local.findSource('codex', '/sessions/shared.jsonl')?.candidate.title)
      .toBe('Local');
    expect(remote.findSource('codex', '/sessions/shared.jsonl')?.candidate.title)
      .toBe('Remote');

    local.applyProviderScan({
      provider: 'codex',
      scanId: 'local-empty',
      scannedAt: timestamp,
      candidates: []
    });

    expect(snapshot(local).sessions).toMatchObject([
      { title: 'Local', sourceFreshness: 'stale' }
    ]);
    expect(snapshot(remote).sessions.map(({ title }) => title)).toEqual(['Remote']);
  });
});

