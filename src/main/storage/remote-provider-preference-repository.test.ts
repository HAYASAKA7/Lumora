import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';

import { migrateCatalogDatabase } from './migrations';
import { RemoteProviderPreferenceRepository } from './remote-provider-preference-repository';

const FIRST = '0198f8b6-18f3-7ca0-9f0f-123456789a11';
const SECOND = '0198f8b6-18f3-7ca0-9f0f-123456789a12';

function insertTarget(database: DatabaseSync, id: string): void {
  database.prepare(
    `INSERT INTO execution_target (
      id, kind, display_name, platform, architecture, connection_state,
      helper_version, protocol_version, capabilities_json,
      last_connected_at, last_scanned_at
    ) VALUES (?, 'remote', ?, 'linux', 'x64', 'offline', NULL, NULL, '[]', NULL, NULL)`
  ).run(id, id);
}

describe('RemoteProviderPreferenceRepository', () => {
  let database: DatabaseSync | null = null;

  afterEach(() => database?.close());

  it('defaults to all providers and isolates canonical selections per target', () => {
    database = new DatabaseSync(':memory:');
    migrateCatalogDatabase(database);
    insertTarget(database, FIRST);
    insertTarget(database, SECOND);
    const repository = new RemoteProviderPreferenceRepository(database);

    expect(repository.get(FIRST)).toHaveLength(13);
    expect(repository.save(
      FIRST,
      ['opencode', 'codex'],
      new Date('2026-08-05T04:00:00.000Z')
    )).toEqual(['codex', 'opencode']);
    expect(repository.get(FIRST)).toEqual(['codex', 'opencode']);
    expect(repository.get(SECOND)).toHaveLength(13);
    expect(() => repository.save(FIRST, [], new Date())).toThrow();
  });
});
