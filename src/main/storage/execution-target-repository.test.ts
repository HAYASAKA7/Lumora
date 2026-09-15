import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';

import { migrateCatalogDatabase } from './migrations';
import { ExecutionTargetRepository } from './execution-target-repository';

describe('ExecutionTargetRepository', () => {
  let database: DatabaseSync | null = null;

  afterEach(() => {
    database?.close();
    database = null;
  });

  it('hydrates the permanent local target with current platform facts', () => {
    database = new DatabaseSync(':memory:');
    migrateCatalogDatabase(database);
    const repository = new ExecutionTargetRepository(database);

    expect(repository.ensureLocalTarget({
      platform: 'win32',
      architecture: 'x64'
    })).toEqual({
      id: 'local',
      kind: 'local',
      displayName: 'This computer',
      platform: 'win32',
      architecture: 'x64',
      connectionState: 'local',
      helperVersion: null,
      protocolVersion: null,
      capabilities: ['provider-scan', 'session-scan', 'pty'],
      lastConnectedAt: null,
      lastScannedAt: null
    });
    expect(repository.list()).toEqual([repository.get('local')]);
  });

  it('does not allow the permanent local target to be deleted', () => {
    database = new DatabaseSync(':memory:');
    migrateCatalogDatabase(database);

    expect(() => database!.prepare(
      "DELETE FROM execution_target WHERE id = 'local'"
    ).run()).toThrow('permanent');
  });

  it('deletes a remote target together with everything it discovered, and leaves other targets alone', () => {
    database = new DatabaseSync(':memory:');
    migrateCatalogDatabase(database);
    const repository = new ExecutionTargetRepository(database);
    repository.ensureLocalTarget({ platform: 'win32', architecture: 'x64' });
    const removed = '2abb0a0d-0a65-4027-8919-ff8cc9b9aefb';
    const kept = '75b74315-5722-4fc3-a732-08a829f14238';
    repository.createRemote({ id: removed, displayName: 'Build server' });
    repository.createRemote({ id: kept, displayName: 'Test server' });
    for (const target of ['local', removed, kept]) {
      seedDiscoveredData(database, target);
    }

    // A target that was ever connected holds a catalog, which once blocked its deletion.
    repository.deleteRemote(removed);

    expect(repository.get(removed)).toBeNull();
    for (const table of CATALOG_TABLES) {
      const counts = database.prepare(
        `SELECT execution_target_id AS target, count(*) AS rows FROM ${table} GROUP BY execution_target_id`
      ).all().map(({ target, rows }) => [target, rows]);
      expect(counts, table).toEqual(expect.arrayContaining([['local', 1], [kept, 1]]));
      expect(counts.map(([target]) => target), table).not.toContain(removed);
    }
  });

  it('keeps a remote target and its catalog when part of the deletion fails', () => {
    database = new DatabaseSync(':memory:');
    migrateCatalogDatabase(database);
    const repository = new ExecutionTargetRepository(database);
    const target = '2abb0a0d-0a65-4027-8919-ff8cc9b9aefb';
    repository.createRemote({ id: target, displayName: 'Build server' });
    seedDiscoveredData(database, target);
    database.exec(`CREATE TRIGGER refuse_target_delete BEFORE DELETE ON execution_target
      BEGIN SELECT RAISE(ABORT, 'refused'); END`);

    expect(() => repository.deleteRemote(target)).toThrow('refused');

    expect(repository.get(target)).not.toBeNull();
    expect(database.prepare('SELECT count(*) AS rows FROM session WHERE execution_target_id = ?')
      .get(target)).toEqual(expect.objectContaining({ rows: 1 }));
  });
});

const CATALOG_TABLES = [
  'workspace',
  'session',
  'session_source',
  'terminal_profile',
  'runtime_instance',
  'runtime_reconciliation',
  'trust_decision',
  'workspace_visibility_policy'
] as const;

/** One of each row a connected target leaves behind, linked the way a scan and a launch link them. */
function seedDiscoveredData(database: DatabaseSync, target: string): void {
  const now = '2026-09-15T00:00:00.000Z';
  const workspace = `workspace-${target}`;
  const session = `session-${target}`;
  const runtime = `runtime-${target}`;
  database.prepare(
    `INSERT INTO workspace (execution_target_id, id, identity_key, canonical_path, display_name,
      available, origin, created_at, updated_at)
     VALUES (?, ?, '/work', '/work', 'work', 1, 'discovered', ?, ?)`
  ).run(target, workspace, now, now);
  database.prepare(
    `INSERT INTO session (execution_target_id, id, provider, native_id, workspace_id, title,
      normalized_title, created_at, updated_at, lifecycle, source_freshness)
     VALUES (?, ?, 'codex', 'native-1', ?, 'Title', 'title', ?, ?, 'saved', 'current')`
  ).run(target, session, workspace, now, now);
  database.prepare(
    `INSERT INTO session_source (execution_target_id, provider, source_key, session_id, last_seen_scan_id)
     VALUES (?, 'codex', 'source-1', ?, 'scan-1')`
  ).run(target, session);
  database.prepare(
    `INSERT INTO terminal_profile (execution_target_id, id, kind, name, shell_family, executable_path,
      args_json, available, recommended, created_at, updated_at)
     VALUES (?, 'profile-1', 'detected', 'bash', 'bash', '/bin/bash', '[]', 1, 1, ?, ?)`
  ).run(target, now, now);
  database.prepare(
    `INSERT INTO runtime_instance (execution_target_id, id, session_id, provider, workspace_id,
      terminal_profile_id, launch_hash, state, created_at)
     VALUES (?, ?, ?, 'codex', ?, 'profile-1', 'hash', 'completed', ?)`
  ).run(target, runtime, session, workspace, now);
  database.prepare(
    `INSERT INTO runtime_reconciliation (execution_target_id, runtime_id, baseline_native_ids_json)
     VALUES (?, ?, '[]')`
  ).run(target, runtime);
  database.prepare(
    `INSERT INTO trust_decision (execution_target_id, workspace_id, canonical_path, trusted_at)
     VALUES (?, ?, '/work', ?)`
  ).run(target, workspace, now);
  database.prepare(
    `INSERT INTO workspace_visibility_policy (execution_target_id, workspace_id, mode, updated_at)
     VALUES (?, ?, 'workspace_only', ?)`
  ).run(target, workspace, now);
}

