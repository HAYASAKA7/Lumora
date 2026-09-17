import { DatabaseSync } from 'node:sqlite';

import { afterEach, describe, expect, it } from 'vitest';

import { CATALOG_MIGRATIONS, runMigrations } from './migrations';

const TIMESTAMP = '2026-09-15T10:00:00.000Z';
const WORKSPACE_ID = 'a'.repeat(64);

describe('workspace change migration', () => {
  let database: DatabaseSync | null = null;

  afterEach(() => {
    database?.close();
    database = null;
  });

  /** A database as it stood before change tracking, holding one local workspace. */
  function existingDatabase(): DatabaseSync {
    const opened = new DatabaseSync(':memory:');
    database = opened;
    runMigrations(opened, CATALOG_MIGRATIONS.filter(({ version }) => version <= 21));
    opened.prepare(
      `INSERT INTO workspace (
        execution_target_id, id, identity_key, canonical_path, display_name,
        available, origin, created_at, updated_at
      ) VALUES ('local', ?, 'workspace-key', '/work/lumora', 'Lumora', 1, 'manual', ?, ?)`
    ).run(WORKSPACE_ID, TIMESTAMP, TIMESTAMP);
    return opened;
  }

  const tables = (opened: DatabaseSync): string[] => opened.prepare(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'workspace_change%' ORDER BY name"
  ).all().map((row) => String(row.name));

  const insertSegment = (opened: DatabaseSync, id: string, workspaceId: string): void => {
    opened.prepare(
      `INSERT INTO workspace_change_segment (
        id, execution_target_id, workspace_id, owner_kind, owner_id,
        catalog_session_id, snapshot_kind, baseline_tree, baseline_head,
        baseline_late, state, unavailable_reason, created_at, ended_at
      ) VALUES (?, 'local', ?, 'terminal', ?, NULL, 'repository', ?, NULL, 0, 'ready', NULL, ?, NULL)`
    ).run(id, workspaceId, `owner-${id}`, 'b'.repeat(40), TIMESTAMP);
  };

  it('adds change tracking to a database that already holds workspaces', () => {
    const opened = existingDatabase();
    expect(tables(opened)).toEqual([]);

    runMigrations(opened, CATALOG_MIGRATIONS);

    expect(tables(opened)).toEqual(['workspace_change_review', 'workspace_change_segment']);
    expect(
      opened.prepare('SELECT id FROM workspace').all()
    ).toEqual([{ id: WORKSPACE_ID }]);
  });

  it('keeps a segment against its own target and workspace', () => {
    const opened = existingDatabase();
    runMigrations(opened, CATALOG_MIGRATIONS);

    expect(() => insertSegment(opened, 'segment-1', WORKSPACE_ID)).not.toThrow();
    expect(() => insertSegment(opened, 'segment-2', 'b'.repeat(64))).toThrow(/FOREIGN KEY/i);

    opened.prepare(
      `INSERT INTO workspace_change_review (id, segment_id, from_tree, to_tree, file_count, reviewed_at)
       VALUES ('review-1', 'segment-1', ?, ?, 2, ?)`
    ).run('b'.repeat(40), 'c'.repeat(40), TIMESTAMP);

    opened.prepare('DELETE FROM workspace_change_segment WHERE id = ?').run('segment-1');
    expect(opened.prepare('SELECT id FROM workspace_change_review').all()).toEqual([]);
  });

  it('clears the tables a removed feature left in a database that ran its migration', () => {
    const opened = existingDatabase();
    runMigrations(opened, CATALOG_MIGRATIONS);
    // A database that ran the version which created these tables keeps them until now.
    opened.exec(`CREATE TABLE workspace_change_place (
      id TEXT PRIMARY KEY, execution_target_id TEXT NOT NULL, workspace_id TEXT NOT NULL,
      path TEXT NOT NULL, created_at TEXT NOT NULL
    ) STRICT`);
    opened.exec(`CREATE TABLE workspace_change_segment_root (
      segment_id TEXT NOT NULL, place_id TEXT NOT NULL, state TEXT NOT NULL,
      PRIMARY KEY (segment_id, place_id)
    ) STRICT`);

    runMigrations(opened, CATALOG_MIGRATIONS);

    expect(tables(opened)).toEqual(['workspace_change_review', 'workspace_change_segment']);
  });

  it('leaves an already migrated database alone and rebuilds a schema that went missing', () => {
    const opened = existingDatabase();
    runMigrations(opened, CATALOG_MIGRATIONS);
    insertSegment(opened, 'segment-1', WORKSPACE_ID);

    runMigrations(opened, CATALOG_MIGRATIONS);

    expect(opened.prepare('SELECT id FROM workspace_change_segment').all()).toEqual([{ id: 'segment-1' }]);

    opened.exec('DROP TABLE workspace_change_review');
    opened.exec('DROP TABLE workspace_change_segment');
    expect(tables(opened)).toEqual([]);

    runMigrations(opened, CATALOG_MIGRATIONS);

    expect(tables(opened)).toEqual(['workspace_change_review', 'workspace_change_segment']);
    expect(() => insertSegment(opened, 'segment-2', WORKSPACE_ID)).not.toThrow();
  });
});
