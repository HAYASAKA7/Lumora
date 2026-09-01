import type { DatabaseSync } from 'node:sqlite';

import { EXECUTION_TARGET_MIGRATION_STATEMENTS } from './execution-target-migration';

export interface CatalogMigration {
  version: number;
  statements: readonly string[];
  isSchemaPresent?: (database: DatabaseSync) => boolean;
}

function hasTable(database: DatabaseSync, table: string): boolean {
  return database.prepare(
    "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?"
  ).get(table) !== undefined;
}

export const CATALOG_MIGRATIONS: readonly CatalogMigration[] = [
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
  },
  {
    version: 7,
    statements: [
      `CREATE TABLE trust_decision (
        workspace_id TEXT PRIMARY KEY REFERENCES workspace(id) ON DELETE CASCADE,
        canonical_path TEXT NOT NULL,
        trusted_at TEXT NOT NULL
      ) STRICT`
    ]
  },
  {
    version: 8,
    statements: [
      `ALTER TABLE runtime_instance ADD COLUMN display_name TEXT NOT NULL
        DEFAULT 'New Codex session'`,
      `UPDATE runtime_instance
       SET display_name = 'New Claude Code session'
      WHERE provider = 'claude'`
    ]
  },
  {
    version: 9,
    statements: [
      `CREATE TABLE app_preference (
        key TEXT PRIMARY KEY,
        value_json TEXT NOT NULL CHECK (json_valid(value_json)),
        updated_at TEXT NOT NULL
      ) STRICT`
    ]
  },
  {
    version: 10,
    statements: [
      `CREATE TEMP TABLE runtime_reconciliation_backup (
        runtime_id TEXT PRIMARY KEY,
        baseline_native_ids_json TEXT NOT NULL
      ) STRICT`,
      `INSERT INTO runtime_reconciliation_backup (
        runtime_id, baseline_native_ids_json
      ) SELECT runtime_id, baseline_native_ids_json FROM runtime_reconciliation`,
      'DROP TABLE runtime_reconciliation',
      `CREATE TABLE runtime_instance_wide (
        id TEXT PRIMARY KEY,
        provider TEXT NOT NULL,
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
        ),
        strategy TEXT NOT NULL DEFAULT 'new' CHECK (strategy IN ('new', 'resume')),
        session_id TEXT REFERENCES session(id) ON DELETE SET NULL,
        native_session_id TEXT,
        reconciliation_state TEXT NOT NULL DEFAULT 'unresolved' CHECK (
          reconciliation_state IN (
            'not_required', 'pending', 'linked', 'ambiguous', 'unresolved'
          )
        ),
        display_name TEXT NOT NULL DEFAULT 'New Codex session'
      ) STRICT`,
      `INSERT INTO runtime_instance_wide (
        id, provider, workspace_id, terminal_profile_id, launch_hash, state,
        pid, created_at, started_at, ended_at, exit_code, error_code,
        strategy, session_id, native_session_id, reconciliation_state,
        display_name
      ) SELECT
        id, provider, workspace_id, terminal_profile_id, launch_hash, state,
        pid, created_at, started_at, ended_at, exit_code, error_code,
        strategy, session_id, native_session_id, reconciliation_state,
        display_name
      FROM runtime_instance`,
      'DROP TABLE runtime_instance',
      'ALTER TABLE runtime_instance_wide RENAME TO runtime_instance',
      'CREATE INDEX runtime_instance_state_idx ON runtime_instance (state)',
      'CREATE INDEX runtime_instance_workspace_idx ON runtime_instance (workspace_id)',
      'CREATE INDEX runtime_instance_created_idx ON runtime_instance (created_at DESC)',
      'CREATE INDEX runtime_instance_session_idx ON runtime_instance (session_id)',
      `CREATE TABLE runtime_reconciliation (
        runtime_id TEXT PRIMARY KEY REFERENCES runtime_instance(id) ON DELETE CASCADE,
        baseline_native_ids_json TEXT NOT NULL CHECK (
          json_valid(baseline_native_ids_json)
        )
      ) STRICT`,
      `INSERT INTO runtime_reconciliation (
        runtime_id, baseline_native_ids_json
      ) SELECT runtime_id, baseline_native_ids_json
      FROM runtime_reconciliation_backup`,
      'DROP TABLE runtime_reconciliation_backup',
      `CREATE TABLE provider_launch_config_wide (
        provider TEXT PRIMARY KEY,
        command TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT`,
      `INSERT INTO provider_launch_config_wide (
        provider, command, updated_at
      ) SELECT provider, command, updated_at FROM provider_launch_config`,
      'DROP TABLE provider_launch_config',
      'ALTER TABLE provider_launch_config_wide RENAME TO provider_launch_config'
    ]
  },
  {
    version: 11,
    statements: [
      'PRAGMA defer_foreign_keys = ON',
      `CREATE TABLE session_wide (
        id TEXT PRIMARY KEY,
        provider TEXT NOT NULL,
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
      `INSERT INTO session_wide (
        id, provider, native_id, workspace_id, title, normalized_title,
        created_at, updated_at, lifecycle, source_freshness
      ) SELECT
        id, provider, native_id, workspace_id, title, normalized_title,
        created_at, updated_at, lifecycle, source_freshness
      FROM session`,
      `CREATE TABLE session_source_wide (
        provider TEXT NOT NULL,
        source_key TEXT NOT NULL,
        session_id TEXT NOT NULL REFERENCES session_wide(id) ON DELETE CASCADE,
        size INTEGER,
        modified_at_ms INTEGER,
        last_seen_scan_id TEXT NOT NULL,
        stale INTEGER NOT NULL DEFAULT 0 CHECK (stale IN (0, 1)),
        PRIMARY KEY (provider, source_key),
        CHECK ((size IS NULL) = (modified_at_ms IS NULL))
      ) STRICT`,
      `INSERT INTO session_source_wide (
        provider, source_key, session_id, size, modified_at_ms,
        last_seen_scan_id, stale
      ) SELECT
        provider, source_key, session_id, size, modified_at_ms,
        last_seen_scan_id, stale
      FROM session_source`,
      `CREATE TABLE scan_error_wide (
        id INTEGER PRIMARY KEY,
        provider TEXT,
        code TEXT NOT NULL,
        affected_count INTEGER NOT NULL,
        message TEXT NOT NULL,
        recovery TEXT NOT NULL,
        retryable INTEGER NOT NULL CHECK (retryable IN (0, 1)),
        scanned_at TEXT NOT NULL
      ) STRICT`,
      `INSERT INTO scan_error_wide (
        id, provider, code, affected_count, message, recovery,
        retryable, scanned_at
      ) SELECT
        id, provider, code, affected_count, message, recovery,
        retryable, scanned_at
      FROM scan_error`,
      `CREATE TEMP TABLE runtime_session_backup (
        runtime_id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL
      ) STRICT`,
      `INSERT INTO runtime_session_backup (runtime_id, session_id)
       SELECT id, session_id FROM runtime_instance WHERE session_id IS NOT NULL`,
      'DROP TABLE session_source',
      'DROP TABLE session',
      'DROP TABLE scan_error',
      'ALTER TABLE session_wide RENAME TO session',
      'ALTER TABLE session_source_wide RENAME TO session_source',
      'ALTER TABLE scan_error_wide RENAME TO scan_error',
      `UPDATE runtime_instance
       SET session_id = (
         SELECT backup.session_id FROM runtime_session_backup backup
         WHERE backup.runtime_id = runtime_instance.id
       )
       WHERE id IN (SELECT runtime_id FROM runtime_session_backup)`,
      'DROP TABLE runtime_session_backup',
      'CREATE INDEX session_workspace_idx ON session (workspace_id)',
      'CREATE INDEX session_provider_idx ON session (provider)',
      'CREATE INDEX session_updated_idx ON session (updated_at DESC)',
      'CREATE INDEX session_title_idx ON session (normalized_title)',
      'CREATE INDEX session_source_session_idx ON session_source (session_id)'
    ]
  },
  {
    version: 12,
    statements: [
      `ALTER TABLE session ADD COLUMN lifetime_tokens INTEGER
        CHECK (
          lifetime_tokens IS NULL OR
          (lifetime_tokens >= 0 AND lifetime_tokens <= 9007199254740991)
        )`
    ]
  },
  {
    version: 13,
    statements: [
      `UPDATE session
       SET lifetime_tokens = NULL
       WHERE provider = 'codex'`,
      `UPDATE session_source
       SET size = NULL, modified_at_ms = NULL
      WHERE provider = 'codex'`
    ]
  },
  {
    version: 14,
    statements: [
      `UPDATE session
       SET lifetime_tokens = NULL
       WHERE provider IN ('claude', 'gemini', 'qwen', 'copilot')`,
      `UPDATE session_source
       SET size = NULL, modified_at_ms = NULL
       WHERE provider IN ('claude', 'gemini', 'qwen', 'copilot')`
    ]
  },
  {
    version: 15,
    statements: [
      'PRAGMA defer_foreign_keys = ON',
      `CREATE TEMP TABLE runtime_reconciliation_fork_backup (
        runtime_id TEXT PRIMARY KEY,
        baseline_native_ids_json TEXT NOT NULL
      ) STRICT`,
      `INSERT INTO runtime_reconciliation_fork_backup (
        runtime_id, baseline_native_ids_json
      ) SELECT runtime_id, baseline_native_ids_json FROM runtime_reconciliation`,
      'DROP TABLE runtime_reconciliation',
      `CREATE TABLE runtime_instance_fork (
        id TEXT PRIMARY KEY,
        provider TEXT NOT NULL,
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
        ),
        strategy TEXT NOT NULL DEFAULT 'new' CHECK (
          strategy IN ('new', 'resume', 'fork')
        ),
        session_id TEXT REFERENCES session(id) ON DELETE SET NULL,
        native_session_id TEXT,
        reconciliation_state TEXT NOT NULL DEFAULT 'unresolved' CHECK (
          reconciliation_state IN (
            'not_required', 'pending', 'linked', 'ambiguous', 'unresolved'
          )
        ),
        display_name TEXT NOT NULL DEFAULT 'New Codex session'
      ) STRICT`,
      `INSERT INTO runtime_instance_fork (
        id, provider, workspace_id, terminal_profile_id, launch_hash, state,
        pid, created_at, started_at, ended_at, exit_code, error_code,
        strategy, session_id, native_session_id, reconciliation_state,
        display_name
      ) SELECT
        id, provider, workspace_id, terminal_profile_id, launch_hash, state,
        pid, created_at, started_at, ended_at, exit_code, error_code,
        strategy, session_id, native_session_id, reconciliation_state,
        display_name
      FROM runtime_instance`,
      'DROP TABLE runtime_instance',
      'ALTER TABLE runtime_instance_fork RENAME TO runtime_instance',
      'CREATE INDEX runtime_instance_state_idx ON runtime_instance (state)',
      'CREATE INDEX runtime_instance_workspace_idx ON runtime_instance (workspace_id)',
      'CREATE INDEX runtime_instance_created_idx ON runtime_instance (created_at DESC)',
      'CREATE INDEX runtime_instance_session_idx ON runtime_instance (session_id)',
      `CREATE TABLE runtime_reconciliation (
        runtime_id TEXT PRIMARY KEY REFERENCES runtime_instance(id) ON DELETE CASCADE,
        baseline_native_ids_json TEXT NOT NULL CHECK (
          json_valid(baseline_native_ids_json)
        )
      ) STRICT`,
      `INSERT INTO runtime_reconciliation (
        runtime_id, baseline_native_ids_json
      ) SELECT runtime_id, baseline_native_ids_json
      FROM runtime_reconciliation_fork_backup`,
      'DROP TABLE runtime_reconciliation_fork_backup'
    ]
  },
  {
    version: 16,
    statements: EXECUTION_TARGET_MIGRATION_STATEMENTS,
    isSchemaPresent: (database) => hasTable(database, 'execution_target')
  },
  {
    version: 17,
    isSchemaPresent: (database) =>
      hasTable(database, 'remote_connection_profile'),
    statements: [
      `CREATE TABLE remote_connection_profile (
        execution_target_id TEXT PRIMARY KEY
          REFERENCES execution_target(id) ON DELETE CASCADE,
        route TEXT NOT NULL CHECK (route IN ('direct', 'ssh-config')),
        host TEXT,
        port INTEGER CHECK (port IS NULL OR (port >= 1 AND port <= 65535)),
        username TEXT,
        ssh_config_host TEXT,
        authentication_method TEXT NOT NULL CHECK (
          authentication_method IN ('password', 'private-key', 'agent')
        ),
        private_key_path TEXT,
        verified_host_fingerprint TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        CHECK (
          (route = 'direct' AND host IS NOT NULL AND port IS NOT NULL
            AND username IS NOT NULL AND ssh_config_host IS NULL) OR
          (route = 'ssh-config' AND host IS NULL AND port IS NULL
            AND username IS NULL AND ssh_config_host IS NOT NULL)
        ),
        CHECK (
          (authentication_method = 'private-key' AND private_key_path IS NOT NULL) OR
          (authentication_method <> 'private-key' AND private_key_path IS NULL)
        )
      ) STRICT`
    ]
  },
  {
    version: 18,
    statements: [
      `ALTER TABLE remote_connection_profile
       ADD COLUMN auto_connect INTEGER NOT NULL DEFAULT 0
       CHECK (auto_connect IN (0, 1))`,
      `CREATE TABLE remote_connection_credential (
        execution_target_id TEXT PRIMARY KEY
          REFERENCES remote_connection_profile(execution_target_id) ON DELETE CASCADE,
        secret_kind TEXT NOT NULL CHECK (
          secret_kind IN ('password', 'private-key-passphrase')
        ),
        encrypted_secret BLOB NOT NULL CHECK (length(encrypted_secret) > 0),
        encryption_version INTEGER NOT NULL CHECK (encryption_version >= 1),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT`
    ]
  },
  {
    version: 19,
    statements: [
      `CREATE TABLE workspace_visibility_policy (
        execution_target_id TEXT NOT NULL
          REFERENCES execution_target(id) ON DELETE CASCADE,
        workspace_id TEXT NOT NULL,
        mode TEXT NOT NULL CHECK (
          mode IN ('workspace_only', 'workspace_and_sessions')
        ),
        updated_at TEXT NOT NULL,
        PRIMARY KEY (execution_target_id, workspace_id),
        FOREIGN KEY (execution_target_id, workspace_id)
          REFERENCES workspace(execution_target_id, id) ON DELETE CASCADE
      ) STRICT`,
      `CREATE INDEX workspace_visibility_policy_updated_idx
       ON workspace_visibility_policy (execution_target_id, updated_at DESC)`
    ]
  },
  {
    version: 20,
    statements: [
      `CREATE TABLE structured_provider_preference (
        execution_target_id TEXT NOT NULL
          REFERENCES execution_target(id) ON DELETE CASCADE,
        provider_id TEXT NOT NULL CHECK (provider_id IN ('codex', 'claude', 'gemini')),
        use_unified_when_available INTEGER NOT NULL DEFAULT 1
          CHECK (use_unified_when_available IN (0, 1)),
        executable_path_override TEXT,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (execution_target_id, provider_id)
      ) STRICT`
    ]
  },
  {
    version: 21,
    statements: [
      `CREATE TABLE structured_provider_preference_next (
        execution_target_id TEXT NOT NULL
          REFERENCES execution_target(id) ON DELETE CASCADE,
        provider_id TEXT NOT NULL CHECK (provider_id IN (
          'codex', 'claude', 'gemini', 'opencode', 'cursor',
          'copilot', 'qwen', 'kimi', 'goose'
        )),
        use_unified_when_available INTEGER NOT NULL DEFAULT 1
          CHECK (use_unified_when_available IN (0, 1)),
        executable_path_override TEXT,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (execution_target_id, provider_id)
      ) STRICT`,
      `INSERT INTO structured_provider_preference_next (
        execution_target_id, provider_id, use_unified_when_available,
        executable_path_override, updated_at
      )
      SELECT execution_target_id, provider_id, use_unified_when_available,
        executable_path_override, updated_at
      FROM structured_provider_preference`,
      'DROP TABLE structured_provider_preference',
      `ALTER TABLE structured_provider_preference_next
       RENAME TO structured_provider_preference`
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
    const hasMigrationRecord = applied.get(migration.version) !== undefined;
    const schemaIsPresent = migration.isSchemaPresent?.(database) ?? true;

    if (hasMigrationRecord && schemaIsPresent) {
      continue;
    }

    const repairingRecordedSchema = hasMigrationRecord && !schemaIsPresent;
    let transactionStarted = false;
    if (repairingRecordedSchema) {
      database.exec('PRAGMA foreign_keys = OFF');
    }
    try {
      database.exec('BEGIN IMMEDIATE');
      transactionStarted = true;
      for (const statement of migration.statements) {
        database.exec(statement);
      }
      if (repairingRecordedSchema) {
        const violation = database.prepare('PRAGMA foreign_key_check').get();
        if (violation !== undefined) {
          throw new Error(
            `Migration ${migration.version} could not repair its schema safely.`
          );
        }
      }
      if (!hasMigrationRecord) {
        record.run(migration.version, new Date().toISOString());
      }
      database.exec('COMMIT');
      transactionStarted = false;
    } catch (error) {
      if (transactionStarted) {
        database.exec('ROLLBACK');
      }
      throw error;
    } finally {
      if (repairingRecordedSchema) {
        database.exec('PRAGMA foreign_keys = ON');
      }
    }
  }
}

export function migrateCatalogDatabase(database: DatabaseSync): void {
  runMigrations(database, CATALOG_MIGRATIONS);
}
