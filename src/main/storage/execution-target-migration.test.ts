import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';

import {
  CATALOG_MIGRATIONS,
  migrateCatalogDatabase,
  runMigrations
} from './migrations';

const timestamp = '2026-08-04T00:00:00.000Z';
const workspaceId = 'a'.repeat(64);
const sessionId = 'b'.repeat(64);
const profileId = 'c'.repeat(64);
const runtimeId = '0198f8b6-18f3-7ca0-9f0f-123456789abc';

describe('execution-target migration', () => {
  let database: DatabaseSync | null = null;

  afterEach(() => {
    database?.close();
    database = null;
  });

  it('moves every existing target-owned row to local without changing identity', () => {
    database = new DatabaseSync(':memory:');
    runMigrations(
      database,
      CATALOG_MIGRATIONS.filter(({ version }) => version <= 15)
    );
    database.prepare(
      `INSERT INTO workspace (
        id, identity_key, canonical_path, display_name, available, origin,
        created_at, updated_at
      ) VALUES (?, 'path:/work/lumora', '/work/lumora', 'Lumora', 1,
        'manual', ?, ?)`
    ).run(workspaceId, timestamp, timestamp);
    database.prepare(
      `INSERT INTO session (
        id, provider, native_id, workspace_id, title, normalized_title,
        created_at, updated_at, lifetime_tokens, lifecycle, source_freshness
      ) VALUES (?, 'codex', 'native-1', ?, 'Existing', 'existing', ?, ?,
        42, 'saved', 'current')`
    ).run(sessionId, workspaceId, timestamp, timestamp);
    database.prepare(
      `INSERT INTO session_source (
        provider, source_key, session_id, size, modified_at_ms,
        last_seen_scan_id, stale
      ) VALUES ('codex', '/sessions/native-1.jsonl', ?, 10, 20, 'scan-1', 0)`
    ).run(sessionId);
    database.prepare(
      `INSERT INTO scan_error (
        provider, code, affected_count, message, recovery, retryable, scanned_at
      ) VALUES ('codex', 'CATALOG_SOURCE_INVALID', 1, 'message', 'retry', 1, ?)`
    ).run(timestamp);
    database.prepare(
      `INSERT INTO terminal_profile (
        id, kind, name, shell_family, executable_path, args_json,
        available, recommended, created_at, updated_at
      ) VALUES (?, 'detected', 'PowerShell', 'pwsh', 'pwsh.exe', '[]',
        1, 1, ?, ?)`
    ).run(profileId, timestamp, timestamp);
    database.prepare(
      `INSERT INTO provider_launch_config (provider, command, updated_at)
       VALUES ('codex', 'codex', ?)`
    ).run(timestamp);
    database.prepare(
      `INSERT INTO config_layer (scope, target_id, settings_json, updated_at)
       VALUES ('provider', 'codex', '{}', ?)`
    ).run(timestamp);
    database.prepare(
      `INSERT INTO trust_decision (workspace_id, canonical_path, trusted_at)
       VALUES (?, '/work/lumora', ?)`
    ).run(workspaceId, timestamp);
    database.prepare(
      `INSERT INTO runtime_instance (
        id, display_name, strategy, session_id, native_session_id,
        reconciliation_state, provider, workspace_id, terminal_profile_id,
        launch_hash, state, pid, created_at, started_at, ended_at,
        exit_code, error_code
      ) VALUES (?, 'Existing', 'new', NULL, NULL, 'pending', 'codex', ?, ?,
        ?, 'running', 123, ?, ?, NULL, NULL, NULL)`
    ).run(runtimeId, workspaceId, profileId, 'd'.repeat(64), timestamp, timestamp);
    database.prepare(
      `INSERT INTO runtime_reconciliation (
        runtime_id, baseline_native_ids_json
      ) VALUES (?, '["native-before"]')`
    ).run(runtimeId);

    runMigrations(database, CATALOG_MIGRATIONS);

    expect(
      database.prepare(
        'SELECT version FROM schema_migration ORDER BY version DESC LIMIT 1'
      ).get()
    ).toEqual({ version: 17 });
    expect(
      database.prepare('SELECT id, kind, connection_state FROM execution_target').get()
    ).toEqual({ id: 'local', kind: 'local', connection_state: 'local' });

    for (const [table, identityColumn, identity] of [
      ['workspace', 'id', workspaceId],
      ['session', 'id', sessionId],
      ['session_source', 'source_key', '/sessions/native-1.jsonl'],
      ['scan_error', 'id', 1],
      ['terminal_profile', 'id', profileId],
      ['provider_launch_config', 'provider', 'codex'],
      ['config_layer', 'target_id', 'codex'],
      ['trust_decision', 'workspace_id', workspaceId],
      ['runtime_instance', 'id', runtimeId],
      ['runtime_reconciliation', 'runtime_id', runtimeId]
    ] as const) {
      expect(
        database.prepare(
          `SELECT execution_target_id FROM ${table} WHERE ${identityColumn} = ?`
        ).get(identity)
      ).toEqual({ execution_target_id: 'local' });
    }
    expect(
      database.prepare(
        'SELECT baseline_native_ids_json FROM runtime_reconciliation WHERE runtime_id = ?'
      ).get(runtimeId)
    ).toEqual({ baseline_native_ids_json: '["native-before"]' });
  });

  it('creates target-scoped keys for settings and provider configuration', () => {
    database = new DatabaseSync(':memory:');
    runMigrations(database, CATALOG_MIGRATIONS);
    const remoteId = '4f632901-1f8d-44c0-8418-aa823f791ca0';
    database.prepare(
      `INSERT INTO execution_target (
        id, kind, display_name, platform, architecture, connection_state,
        helper_version, protocol_version, capabilities_json,
        last_connected_at, last_scanned_at
      ) VALUES (?, 'remote', 'Server', 'linux', 'x64', 'offline',
        NULL, NULL, '[]', NULL, NULL)`
    ).run(remoteId);

    const insertConfig = database.prepare(
      `INSERT INTO provider_launch_config (
        execution_target_id, provider, command, updated_at
      ) VALUES (?, 'codex', ?, ?)`
    );
    insertConfig.run('local', 'codex', timestamp);
    insertConfig.run(remoteId, '/usr/bin/codex', timestamp);

    expect(database.prepare(
      `SELECT execution_target_id, command FROM provider_launch_config
       ORDER BY execution_target_id`
    ).all()).toEqual([
      { execution_target_id: remoteId, command: '/usr/bin/codex' },
      { execution_target_id: 'local', command: 'codex' }
    ]);
  });

  it('repairs the target schema when a discarded migration already claimed its version', () => {
    database = new DatabaseSync(':memory:');
    runMigrations(
      database,
      CATALOG_MIGRATIONS.filter(({ version }) => version <= 15)
    );
    database.prepare(
      `INSERT INTO workspace (
        id, identity_key, canonical_path, display_name, available, origin,
        created_at, updated_at
      ) VALUES (?, 'path:/work/legacy', '/work/legacy', 'Legacy', 1,
        'manual', ?, ?)`
    ).run(workspaceId, timestamp, timestamp);
    database.prepare(
      `INSERT INTO session (
        id, provider, native_id, workspace_id, title, normalized_title,
        created_at, updated_at, lifetime_tokens, lifecycle, source_freshness
      ) VALUES (?, 'codex', 'legacy-native', ?, 'Legacy session',
        'legacy session', ?, ?, NULL, 'saved', 'current')`
    ).run(sessionId, workspaceId, timestamp, timestamp);
    database.exec(`CREATE TABLE structured_runtime_instance (
      id TEXT PRIMARY KEY,
      session_id TEXT REFERENCES session(id) ON DELETE SET NULL,
      workspace_id TEXT NOT NULL REFERENCES workspace(id)
    ) STRICT`);
    database.prepare(
      `INSERT INTO structured_runtime_instance (id, session_id, workspace_id)
       VALUES ('legacy-runtime', ?, ?)`
    ).run(sessionId, workspaceId);
    database.prepare(
      'INSERT INTO schema_migration (version, applied_at) VALUES (16, ?)'
    ).run('2026-07-28T08:41:36.519Z');
    runMigrations(
      database,
      CATALOG_MIGRATIONS.filter(({ version }) => version === 17)
    );

    migrateCatalogDatabase(database);

    expect(
      database.prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'execution_target'"
      ).get()
    ).toEqual({ name: 'execution_target' });
    expect(
      database.prepare(
        'SELECT id, kind, connection_state FROM execution_target'
      ).get()
    ).toEqual({ id: 'local', kind: 'local', connection_state: 'local' });
    expect(
      database.prepare(
        'SELECT id, session_id, workspace_id FROM structured_runtime_instance'
      ).get()
    ).toEqual({ id: 'legacy-runtime', session_id: sessionId, workspace_id: workspaceId });
    expect(database.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  });
});

