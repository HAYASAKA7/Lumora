import type { DatabaseSync } from 'node:sqlite';

export interface CatalogMigration {
  version: number;
  statements: readonly string[];
}

const CATALOG_MIGRATIONS: readonly CatalogMigration[] = [
  {
    version: 1,
    statements: [
      `CREATE TABLE workspace (
        id TEXT PRIMARY KEY,
        identity_key TEXT NOT NULL UNIQUE,
        canonical_path TEXT NOT NULL,
        display_name TEXT NOT NULL,
        available INTEGER NOT NULL CHECK (available IN (0, 1)),
        origin TEXT NOT NULL CHECK (origin IN ('manual', 'discovered')),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT`,
      `CREATE TABLE session (
        id TEXT PRIMARY KEY,
        provider TEXT NOT NULL CHECK (provider IN ('codex', 'claude')),
        native_id TEXT NOT NULL,
        workspace_id TEXT NOT NULL REFERENCES workspace(id),
        title TEXT NOT NULL,
        normalized_title TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        lifecycle TEXT NOT NULL,
        source_freshness TEXT NOT NULL CHECK (source_freshness IN ('current', 'stale')),
        UNIQUE (provider, native_id)
      ) STRICT`,
      `CREATE TABLE session_source (
        provider TEXT NOT NULL CHECK (provider IN ('codex', 'claude')),
        source_key TEXT NOT NULL,
        session_id TEXT NOT NULL REFERENCES session(id) ON DELETE CASCADE,
        size INTEGER,
        modified_at_ms INTEGER,
        last_seen_scan_id TEXT NOT NULL,
        stale INTEGER NOT NULL DEFAULT 0 CHECK (stale IN (0, 1)),
        PRIMARY KEY (provider, source_key),
        CHECK ((size IS NULL) = (modified_at_ms IS NULL))
      ) STRICT`,
      `CREATE TABLE scan_error (
        id INTEGER PRIMARY KEY,
        provider TEXT CHECK (provider IS NULL OR provider IN ('codex', 'claude')),
        code TEXT NOT NULL,
        affected_count INTEGER NOT NULL,
        message TEXT NOT NULL,
        recovery TEXT NOT NULL,
        retryable INTEGER NOT NULL CHECK (retryable IN (0, 1)),
        scanned_at TEXT NOT NULL
      ) STRICT`,
      'CREATE INDEX session_workspace_idx ON session (workspace_id)',
      'CREATE INDEX session_provider_idx ON session (provider)',
      'CREATE INDEX session_updated_idx ON session (updated_at DESC)',
      'CREATE INDEX session_title_idx ON session (normalized_title)',
      'CREATE INDEX session_source_session_idx ON session_source (session_id)'
    ]
  }
];

export function runMigrations(
  database: DatabaseSync,
  migrations: readonly CatalogMigration[]
): void {
  database.exec('PRAGMA foreign_keys = ON');
  database.exec(`CREATE TABLE IF NOT EXISTS schema_migration (
    version INTEGER PRIMARY KEY,
    applied_at TEXT NOT NULL
  ) STRICT`);

  const applied = database.prepare(
    'SELECT 1 FROM schema_migration WHERE version = ?'
  );
  const record = database.prepare(
    'INSERT INTO schema_migration (version, applied_at) VALUES (?, ?)'
  );

  for (const migration of [...migrations].sort(
    (left, right) => left.version - right.version
  )) {
    if (applied.get(migration.version) !== undefined) {
      continue;
    }

    database.exec('BEGIN IMMEDIATE');
    try {
      for (const statement of migration.statements) {
        database.exec(statement);
      }
      record.run(migration.version, new Date().toISOString());
      database.exec('COMMIT');
    } catch (error) {
      database.exec('ROLLBACK');
      throw error;
    }
  }
}

export function migrateCatalogDatabase(database: DatabaseSync): void {
  runMigrations(database, CATALOG_MIGRATIONS);
}
