import { DatabaseSync } from 'node:sqlite';

import { afterEach, describe, expect, it } from 'vitest';

import { CATALOG_MIGRATIONS, runMigrations } from './migrations';

const TIMESTAMP = '2026-09-17T10:00:00.000Z';
const WORKSPACE_ID = 'a'.repeat(64);

/**
 * A database that ran the version which added watched places, as a machine that
 * tried the feature has. The tables and the column it added must go, or every
 * write to a review fails against a foreign key whose table is no longer there.
 */
describe('rolling back watched places', () => {
  let database: DatabaseSync | null = null;

  afterEach(() => {
    database?.close();
    database = null;
  });

  function databaseWithPlaces(): DatabaseSync {
    const opened = new DatabaseSync(':memory:');
    database = opened;
    runMigrations(opened, CATALOG_MIGRATIONS.filter(({ version }) => version <= 22));
    opened.prepare(
      `INSERT INTO workspace (
        execution_target_id, id, identity_key, canonical_path, display_name,
        available, origin, created_at, updated_at
      ) VALUES ('local', ?, 'workspace-key', '/work/lumora', 'Lumora', 1, 'manual', ?, ?)`
    ).run(WORKSPACE_ID, TIMESTAMP, TIMESTAMP);
    opened.exec(`CREATE TABLE workspace_change_place (
      id TEXT PRIMARY KEY,
      execution_target_id TEXT NOT NULL REFERENCES execution_target(id) ON DELETE CASCADE,
      workspace_id TEXT NOT NULL,
      path TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (execution_target_id, workspace_id)
        REFERENCES workspace(execution_target_id, id) ON DELETE CASCADE,
      UNIQUE (execution_target_id, workspace_id, path)
    ) STRICT`);
    opened.exec(`CREATE TABLE workspace_change_segment_root (
      segment_id TEXT NOT NULL REFERENCES workspace_change_segment(id) ON DELETE CASCADE,
      place_id TEXT NOT NULL REFERENCES workspace_change_place(id) ON DELETE CASCADE,
      snapshot_kind TEXT,
      baseline_tree TEXT,
      baseline_head TEXT,
      baseline_late INTEGER NOT NULL DEFAULT 0,
      state TEXT NOT NULL,
      unavailable_reason TEXT,
      PRIMARY KEY (segment_id, place_id)
    ) STRICT`);
    opened.exec(`ALTER TABLE workspace_change_review ADD COLUMN place_id TEXT
      REFERENCES workspace_change_place(id) ON DELETE CASCADE`);
    opened.prepare(
      'INSERT INTO schema_migration (version, applied_at) VALUES (23, ?)'
    ).run(TIMESTAMP);
    return opened;
  }

  const tables = (opened: DatabaseSync): string[] => opened.prepare(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'workspace_change%' ORDER BY name"
  ).all().map((row) => String(row.name));

  const insertSegment = (opened: DatabaseSync): void => {
    opened.prepare(
      `INSERT INTO workspace_change_segment (
        id, execution_target_id, workspace_id, owner_kind, owner_id,
        catalog_session_id, snapshot_kind, baseline_tree, baseline_head,
        baseline_late, state, unavailable_reason, created_at, ended_at
      ) VALUES ('segment-1', 'local', ?, 'terminal', 'owner-1', NULL, 'repository', ?, NULL, 0, 'ready', NULL, ?, NULL)`
    ).run(WORKSPACE_ID, 'b'.repeat(40), TIMESTAMP);
  };

  it('clears the tables and the column, and keeps what was already recorded', () => {
    const opened = databaseWithPlaces();
    insertSegment(opened);
    opened.prepare(
      `INSERT INTO workspace_change_review (id, segment_id, from_tree, to_tree, file_count, reviewed_at)
       VALUES ('review-1', 'segment-1', ?, ?, 2, ?)`
    ).run('b'.repeat(40), 'c'.repeat(40), TIMESTAMP);

    runMigrations(opened, CATALOG_MIGRATIONS);

    expect(tables(opened)).toEqual(['workspace_change_review', 'workspace_change_segment']);
    expect(opened.prepare('SELECT id FROM workspace_change_review').all())
      .toEqual([{ id: 'review-1' }]);
  });

  it('clears a database that watched a place and reviewed a file in it', () => {
    const opened = databaseWithPlaces();
    insertSegment(opened);
    opened.prepare(
      `INSERT INTO workspace_change_place (id, execution_target_id, workspace_id, path, created_at)
       VALUES ('place-1', 'local', ?, '/work/lib', ?)`
    ).run(WORKSPACE_ID, TIMESTAMP);
    opened.prepare(
      `INSERT INTO workspace_change_segment_root (segment_id, place_id, state)
       VALUES ('segment-1', 'place-1', 'ready')`
    ).run();
    opened.prepare(
      `INSERT INTO workspace_change_review (id, segment_id, place_id, from_tree, to_tree, file_count, reviewed_at)
       VALUES ('review-1', 'segment-1', 'place-1', ?, ?, 1, ?)`
    ).run('b'.repeat(40), 'c'.repeat(40), TIMESTAMP);

    expect(() => runMigrations(opened, CATALOG_MIGRATIONS)).not.toThrow();

    expect(tables(opened)).toEqual(['workspace_change_review', 'workspace_change_segment']);
  });

  it('repairs a database whose tables went but whose column stayed', () => {
    const opened = databaseWithPlaces();
    insertSegment(opened);
    // The state a half-finished rollback leaves: no tables, column still there.
    opened.exec('DROP TABLE workspace_change_segment_root');
    opened.exec('DROP TABLE workspace_change_place');

    runMigrations(opened, CATALOG_MIGRATIONS);

    expect(
      opened.prepare('PRAGMA table_info(workspace_change_review)')
        .all().map((row) => String((row as { name: unknown }).name))
    ).not.toContain('place_id');
    // Pruning a segment cascades into reviews, which is what startup does first.
    expect(() => opened.prepare(
      `DELETE FROM workspace_change_segment
       WHERE execution_target_id = 'local' AND ended_at IS NULL RETURNING id`
    ).all()).not.toThrow();
  });

  it('records a review again once the places are gone', () => {
    const opened = databaseWithPlaces();
    runMigrations(opened, CATALOG_MIGRATIONS);
    insertSegment(opened);

    expect(() => opened.prepare(
      `INSERT INTO workspace_change_review (id, segment_id, from_tree, to_tree, file_count, reviewed_at)
       VALUES ('review-2', 'segment-1', ?, ?, 1, ?)`
    ).run('b'.repeat(40), 'c'.repeat(40), TIMESTAMP)).not.toThrow();
  });
});
