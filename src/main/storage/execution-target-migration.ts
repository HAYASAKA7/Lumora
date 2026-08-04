export const EXECUTION_TARGET_MIGRATION_STATEMENTS = [
  'PRAGMA defer_foreign_keys = ON',
  `CREATE TABLE execution_target (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL CHECK (kind IN ('local', 'remote')),
    display_name TEXT NOT NULL,
    platform TEXT NOT NULL CHECK (platform IN ('win32', 'darwin', 'linux', 'unknown')),
    architecture TEXT NOT NULL,
    connection_state TEXT NOT NULL CHECK (connection_state IN (
      'local', 'offline', 'connecting', 'authenticating', 'helper-missing',
      'helper-incompatible', 'ready', 'reconnecting', 'error'
    )),
    helper_version TEXT,
    protocol_version INTEGER CHECK (protocol_version IS NULL OR protocol_version >= 0),
    capabilities_json TEXT NOT NULL CHECK (json_valid(capabilities_json)),
    last_connected_at TEXT,
    last_scanned_at TEXT,
    CHECK (
      (id = 'local' AND kind = 'local' AND connection_state = 'local') OR
      (id <> 'local' AND kind = 'remote' AND connection_state <> 'local')
    )
  ) STRICT`,
  `INSERT INTO execution_target (
    id, kind, display_name, platform, architecture, connection_state,
    helper_version, protocol_version, capabilities_json,
    last_connected_at, last_scanned_at
  ) VALUES (
    'local', 'local', 'This computer', 'unknown', 'unknown', 'local',
    NULL, NULL, '["provider-scan","session-scan","pty"]', NULL, NULL
  )`,
  `CREATE TRIGGER execution_target_local_delete_guard
   BEFORE DELETE ON execution_target
   WHEN OLD.id = 'local'
   BEGIN
     SELECT RAISE(ABORT, 'The local execution target is permanent.');
   END`,
  `CREATE TABLE execution_target_preference (
    execution_target_id TEXT NOT NULL DEFAULT 'local' REFERENCES execution_target(id) ON DELETE CASCADE,
    key TEXT NOT NULL,
    value_json TEXT NOT NULL CHECK (json_valid(value_json)),
    updated_at TEXT NOT NULL,
    PRIMARY KEY (execution_target_id, key)
  ) STRICT`,
  `CREATE TABLE workspace_target (
    execution_target_id TEXT NOT NULL DEFAULT 'local' REFERENCES execution_target(id) ON DELETE RESTRICT,
    id TEXT PRIMARY KEY,
    identity_key TEXT NOT NULL,
    canonical_path TEXT NOT NULL,
    display_name TEXT NOT NULL,
    available INTEGER NOT NULL CHECK (available IN (0, 1)),
    origin TEXT NOT NULL CHECK (origin IN ('manual', 'discovered')),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE (execution_target_id, id),
    UNIQUE (execution_target_id, identity_key)
  ) STRICT`,
  `INSERT INTO workspace_target (
    execution_target_id, id, identity_key, canonical_path, display_name,
    available, origin, created_at, updated_at
  ) SELECT 'local', id, identity_key, canonical_path, display_name,
    available, origin, created_at, updated_at FROM workspace`,
  `CREATE TABLE session_target (
    execution_target_id TEXT NOT NULL DEFAULT 'local' REFERENCES execution_target(id) ON DELETE RESTRICT,
    id TEXT PRIMARY KEY,
    provider TEXT NOT NULL,
    native_id TEXT NOT NULL,
    workspace_id TEXT NOT NULL,
    title TEXT NOT NULL,
    normalized_title TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    lifetime_tokens INTEGER CHECK (
      lifetime_tokens IS NULL OR
      (lifetime_tokens >= 0 AND lifetime_tokens <= 9007199254740991)
    ),
    lifecycle TEXT NOT NULL,
    source_freshness TEXT NOT NULL CHECK (source_freshness IN ('current', 'stale')),
    UNIQUE (execution_target_id, id),
    UNIQUE (execution_target_id, provider, native_id),
    FOREIGN KEY (execution_target_id, workspace_id)
      REFERENCES workspace_target(execution_target_id, id)
  ) STRICT`,
  `INSERT INTO session_target (
    execution_target_id, id, provider, native_id, workspace_id, title,
    normalized_title, created_at, updated_at, lifetime_tokens, lifecycle,
    source_freshness
  ) SELECT 'local', id, provider, native_id, workspace_id, title,
    normalized_title, created_at, updated_at, lifetime_tokens, lifecycle,
    source_freshness FROM session`,
  `CREATE TABLE session_source_target (
    execution_target_id TEXT NOT NULL DEFAULT 'local' REFERENCES execution_target(id) ON DELETE RESTRICT,
    provider TEXT NOT NULL,
    source_key TEXT NOT NULL,
    session_id TEXT NOT NULL,
    size INTEGER,
    modified_at_ms INTEGER,
    last_seen_scan_id TEXT NOT NULL,
    stale INTEGER NOT NULL DEFAULT 0 CHECK (stale IN (0, 1)),
    PRIMARY KEY (execution_target_id, provider, source_key),
    FOREIGN KEY (execution_target_id, session_id)
      REFERENCES session_target(execution_target_id, id) ON DELETE CASCADE,
    CHECK ((size IS NULL) = (modified_at_ms IS NULL))
  ) STRICT`,
  `INSERT INTO session_source_target (
    execution_target_id, provider, source_key, session_id, size,
    modified_at_ms, last_seen_scan_id, stale
  ) SELECT 'local', provider, source_key, session_id, size,
    modified_at_ms, last_seen_scan_id, stale FROM session_source`,
  `CREATE TABLE scan_error_target (
    id INTEGER PRIMARY KEY,
    execution_target_id TEXT NOT NULL DEFAULT 'local' REFERENCES execution_target(id) ON DELETE CASCADE,
    provider TEXT,
    code TEXT NOT NULL,
    affected_count INTEGER NOT NULL,
    message TEXT NOT NULL,
    recovery TEXT NOT NULL,
    retryable INTEGER NOT NULL CHECK (retryable IN (0, 1)),
    scanned_at TEXT NOT NULL
  ) STRICT`,
  `INSERT INTO scan_error_target (
    id, execution_target_id, provider, code, affected_count, message,
    recovery, retryable, scanned_at
  ) SELECT id, 'local', provider, code, affected_count, message,
    recovery, retryable, scanned_at FROM scan_error`,
  `CREATE TABLE terminal_profile_target (
    execution_target_id TEXT NOT NULL DEFAULT 'local' REFERENCES execution_target(id) ON DELETE RESTRICT,
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
    updated_at TEXT NOT NULL,
    UNIQUE (execution_target_id, id)
  ) STRICT`,
  `INSERT INTO terminal_profile_target (
    execution_target_id, id, kind, name, shell_family, executable_path,
    args_json, available, recommended, created_at, updated_at
  ) SELECT 'local', id, kind, name, shell_family, executable_path,
    args_json, available, recommended, created_at, updated_at
    FROM terminal_profile`,
  `CREATE TABLE provider_launch_config_target (
    execution_target_id TEXT NOT NULL DEFAULT 'local' REFERENCES execution_target(id) ON DELETE CASCADE,
    provider TEXT NOT NULL,
    command TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (execution_target_id, provider)
  ) STRICT`,
  `INSERT INTO provider_launch_config_target (
    execution_target_id, provider, command, updated_at
  ) SELECT 'local', provider, command, updated_at FROM provider_launch_config`,
  `CREATE TABLE config_layer_target (
    execution_target_id TEXT NOT NULL DEFAULT 'local' REFERENCES execution_target(id) ON DELETE CASCADE,
    scope TEXT NOT NULL CHECK (scope IN ('global', 'provider', 'workspace', 'session')),
    target_id TEXT NOT NULL,
    settings_json TEXT NOT NULL CHECK (json_valid(settings_json)),
    updated_at TEXT NOT NULL,
    PRIMARY KEY (execution_target_id, scope, target_id)
  ) STRICT`,
  `INSERT INTO config_layer_target (
    execution_target_id, scope, target_id, settings_json, updated_at
  ) SELECT 'local', scope, target_id, settings_json, updated_at FROM config_layer`,
  `CREATE TABLE trust_decision_target (
    execution_target_id TEXT NOT NULL DEFAULT 'local' REFERENCES execution_target(id) ON DELETE CASCADE,
    workspace_id TEXT NOT NULL,
    canonical_path TEXT NOT NULL,
    trusted_at TEXT NOT NULL,
    PRIMARY KEY (execution_target_id, workspace_id),
    FOREIGN KEY (execution_target_id, workspace_id)
      REFERENCES workspace_target(execution_target_id, id) ON DELETE CASCADE
  ) STRICT`,
  `INSERT INTO trust_decision_target (
    execution_target_id, workspace_id, canonical_path, trusted_at
  ) SELECT 'local', workspace_id, canonical_path, trusted_at FROM trust_decision`,
  `CREATE TABLE runtime_instance_target (
    execution_target_id TEXT NOT NULL DEFAULT 'local' REFERENCES execution_target(id) ON DELETE RESTRICT,
    id TEXT PRIMARY KEY,
    display_name TEXT NOT NULL DEFAULT 'New Codex session',
    strategy TEXT NOT NULL DEFAULT 'new' CHECK (strategy IN ('new', 'resume', 'fork')),
    session_id TEXT,
    native_session_id TEXT,
    reconciliation_state TEXT NOT NULL DEFAULT 'unresolved' CHECK (
      reconciliation_state IN ('not_required', 'pending', 'linked', 'ambiguous', 'unresolved')
    ),
    provider TEXT NOT NULL,
    workspace_id TEXT NOT NULL,
    terminal_profile_id TEXT NOT NULL,
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
    UNIQUE (execution_target_id, id),
    FOREIGN KEY (execution_target_id, workspace_id)
      REFERENCES workspace_target(execution_target_id, id),
    FOREIGN KEY (execution_target_id, terminal_profile_id)
      REFERENCES terminal_profile_target(execution_target_id, id),
    FOREIGN KEY (execution_target_id, session_id)
      REFERENCES session_target(execution_target_id, id) ON DELETE SET NULL
  ) STRICT`,
  `INSERT INTO runtime_instance_target (
    execution_target_id, id, display_name, strategy, session_id,
    native_session_id, reconciliation_state, provider, workspace_id,
    terminal_profile_id, launch_hash, state, pid, created_at, started_at,
    ended_at, exit_code, error_code
  ) SELECT 'local', id, display_name, strategy, session_id,
    native_session_id, reconciliation_state, provider, workspace_id,
    terminal_profile_id, launch_hash, state, pid, created_at, started_at,
    ended_at, exit_code, error_code FROM runtime_instance`,
  `CREATE TABLE runtime_reconciliation_target (
    execution_target_id TEXT NOT NULL DEFAULT 'local' REFERENCES execution_target(id) ON DELETE CASCADE,
    runtime_id TEXT NOT NULL,
    baseline_native_ids_json TEXT NOT NULL CHECK (json_valid(baseline_native_ids_json)),
    PRIMARY KEY (execution_target_id, runtime_id),
    FOREIGN KEY (execution_target_id, runtime_id)
      REFERENCES runtime_instance_target(execution_target_id, id) ON DELETE CASCADE
  ) STRICT`,
  `INSERT INTO runtime_reconciliation_target (
    execution_target_id, runtime_id, baseline_native_ids_json
  ) SELECT 'local', runtime_id, baseline_native_ids_json FROM runtime_reconciliation`,
  'DROP TABLE runtime_reconciliation',
  'DROP TABLE trust_decision',
  'DROP TABLE config_layer',
  'DROP TABLE provider_launch_config',
  'DROP TABLE runtime_instance',
  'DROP TABLE terminal_profile',
  'DROP TABLE session_source',
  'DROP TABLE session',
  'DROP TABLE scan_error',
  'DROP TABLE workspace',
  'ALTER TABLE workspace_target RENAME TO workspace',
  'ALTER TABLE session_target RENAME TO session',
  'ALTER TABLE session_source_target RENAME TO session_source',
  'ALTER TABLE scan_error_target RENAME TO scan_error',
  'ALTER TABLE terminal_profile_target RENAME TO terminal_profile',
  'ALTER TABLE provider_launch_config_target RENAME TO provider_launch_config',
  'ALTER TABLE config_layer_target RENAME TO config_layer',
  'ALTER TABLE trust_decision_target RENAME TO trust_decision',
  'ALTER TABLE runtime_instance_target RENAME TO runtime_instance',
  'ALTER TABLE runtime_reconciliation_target RENAME TO runtime_reconciliation',
  'CREATE INDEX workspace_target_idx ON workspace (execution_target_id)',
  'CREATE INDEX session_workspace_idx ON session (execution_target_id, workspace_id)',
  'CREATE INDEX session_provider_idx ON session (execution_target_id, provider)',
  'CREATE INDEX session_updated_idx ON session (execution_target_id, updated_at DESC)',
  'CREATE INDEX session_title_idx ON session (execution_target_id, normalized_title)',
  'CREATE INDEX session_source_session_idx ON session_source (execution_target_id, session_id)',
  'CREATE INDEX scan_error_target_idx ON scan_error (execution_target_id, scanned_at DESC)',
  'CREATE INDEX terminal_profile_kind_idx ON terminal_profile (execution_target_id, kind)',
  'CREATE INDEX runtime_instance_state_idx ON runtime_instance (execution_target_id, state)',
  'CREATE INDEX runtime_instance_workspace_idx ON runtime_instance (execution_target_id, workspace_id)',
  'CREATE INDEX runtime_instance_created_idx ON runtime_instance (execution_target_id, created_at DESC)',
  'CREATE INDEX runtime_instance_session_idx ON runtime_instance (execution_target_id, session_id)'
] as const;

