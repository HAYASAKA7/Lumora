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
  },
  {
    version: 2,
    statements: [
      `CREATE TABLE terminal_profile (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL CHECK (kind IN ('detected', 'custom')),
        name TEXT NOT NULL,
        shell_family TEXT NOT NULL CHECK (
          shell_family IN ('pwsh', 'powershell', 'cmd', 'zsh', 'bash', 'fish', 'other')
        ),
        executable_path TEXT NOT NULL,
        args_json TEXT NOT NULL,
        available INTEGER NOT NULL CHECK (available IN (0, 1)),
        recommended INTEGER NOT NULL CHECK (recommended IN (0, 1)),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT`,
      `CREATE TABLE runtime_instance (
        id TEXT PRIMARY KEY,
        provider TEXT NOT NULL CHECK (provider IN ('codex', 'claude')),
        workspace_id TEXT NOT NULL REFERENCES workspace(id),
        terminal_profile_id TEXT NOT NULL REFERENCES terminal_profile(id),
        launch_hash TEXT NOT NULL,
        state TEXT NOT NULL CHECK (
          state IN ('launching', 'running', 'completed', 'failed', 'runtime_lost', 'launch_failed')
        ),
        pid INTEGER,
        created_at TEXT NOT NULL,
        started_at TEXT,
        ended_at TEXT,
        exit_code INTEGER,
        error_code TEXT CHECK (
          error_code IS NULL OR error_code IN (
            'PTY_SPAWN_FAILED', 'PTY_RUNTIME_FAILED', 'PTY_RUNTIME_LOST'
          )
        )
      ) STRICT`,
      'CREATE INDEX terminal_profile_kind_idx ON terminal_profile (kind)',
      'CREATE INDEX runtime_instance_state_idx ON runtime_instance (state)',
      'CREATE INDEX runtime_instance_workspace_idx ON runtime_instance (workspace_id)',
      'CREATE INDEX runtime_instance_created_idx ON runtime_instance (created_at DESC)'
    ]
  },
  {
    version: 3,
    statements: [
      `CREATE TABLE provider_launch_config (
        provider TEXT PRIMARY KEY CHECK (provider IN ('codex', 'claude')),
        command TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT`
    ]
  },
  {
    version: 4,
    statements: [
      `ALTER TABLE runtime_instance ADD COLUMN strategy TEXT NOT NULL
        DEFAULT 'new' CHECK (strategy IN ('new', 'resume'))`,
      `ALTER TABLE runtime_instance ADD COLUMN session_id TEXT
        REFERENCES session(id) ON DELETE SET NULL`,
      'ALTER TABLE runtime_instance ADD COLUMN native_session_id TEXT',
      'CREATE INDEX runtime_instance_session_idx ON runtime_instance (session_id)'
    ]
  },
  {
    version: 5,
    statements: [
      `ALTER TABLE runtime_instance ADD COLUMN reconciliation_state TEXT NOT NULL
        DEFAULT 'unresolved' CHECK (reconciliation_state IN (
          'not_required', 'pending', 'linked', 'ambiguous', 'unresolved'
        ))`,
      `UPDATE runtime_instance SET reconciliation_state = CASE
        WHEN strategy = 'resume' THEN 'not_required'
        WHEN native_session_id IS NOT NULL THEN 'linked'
        ELSE 'unresolved'
      END`,
      `CREATE TABLE runtime_reconciliation (
        runtime_id TEXT PRIMARY KEY REFERENCES runtime_instance(id) ON DELETE CASCADE,
        baseline_native_ids_json TEXT NOT NULL CHECK (
          json_valid(baseline_native_ids_json)
        )
      ) STRICT`
    ]
  },
  {
    version: 6,
    statements: [
      `CREATE TABLE config_layer (
        scope TEXT NOT NULL CHECK (
          scope IN ('global', 'provider', 'workspace', 'session')
        ),
        target_id TEXT NOT NULL,
        settings_json TEXT NOT NULL CHECK (json_valid(settings_json)),
        updated_at TEXT NOT NULL,
        PRIMARY KEY (scope, target_id)
      ) STRICT`,
      `INSERT INTO config_layer (
        scope, target_id, settings_json, updated_at
      )
      SELECT 'provider', provider,
        json_object(
          'providerCommands',
          json_object(provider, command)
        ),
        updated_at
      FROM provider_launch_config`
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
