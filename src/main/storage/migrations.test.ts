import { DatabaseSync } from 'node:sqlite';

import { afterEach, describe, expect, it } from 'vitest';

import { CATALOG_MIGRATIONS, runMigrations } from './migrations';

describe('provider lifecycle migration', () => {
  let database: DatabaseSync | null = null;

  afterEach(() => {
    database?.close();
    database = null;
  });

  it('preserves old runtime data and allows wider lifecycle providers', () => {
    database = new DatabaseSync(':memory:');
    runMigrations(
      database,
      CATALOG_MIGRATIONS.filter(({ version }) => version <= 9)
    );
    const timestamp = '2026-07-17T04:00:00.000Z';
    const workspaceId = 'a'.repeat(64);
    const profileId = 'b'.repeat(64);
    database.prepare(
      `INSERT INTO workspace (
        id, identity_key, canonical_path, display_name, available, origin,
        created_at, updated_at
      ) VALUES (?, 'workspace-key', '/work/lumora', 'Lumora', 1, 'manual', ?, ?)`
    ).run(workspaceId, timestamp, timestamp);
    database.prepare(
      `INSERT INTO terminal_profile (
        id, kind, name, shell_family, executable_path, args_json,
        available, recommended, created_at, updated_at
      ) VALUES (?, 'detected', 'Bash', 'bash', '/bin/bash', '[]',
        1, 1, ?, ?)`
    ).run(profileId, timestamp, timestamp);
    database.prepare(
      `INSERT INTO runtime_instance (
        id, display_name, strategy, session_id, native_session_id,
        reconciliation_state, provider, workspace_id, terminal_profile_id,
        launch_hash, state, pid, created_at, started_at, ended_at,
        exit_code, error_code
      ) VALUES (
        '0198f8b6-18f3-7ca0-9f0f-123456789abc', 'Old Codex', 'new',
        NULL, NULL, 'unresolved', 'codex', ?, ?, ?, 'completed', NULL,
        ?, ?, ?, 0, NULL
      )`
    ).run(workspaceId, profileId, 'c'.repeat(64), timestamp, timestamp, timestamp);
    database.prepare(
      `INSERT INTO provider_launch_config (provider, command, updated_at)
       VALUES ('codex', 'codexp', ?)`
    ).run(timestamp);

    runMigrations(database, CATALOG_MIGRATIONS);

    expect(() =>
      database!.prepare(
        `INSERT INTO runtime_instance (
          id, display_name, strategy, session_id, native_session_id,
          reconciliation_state, provider, workspace_id, terminal_profile_id,
          launch_hash, state, pid, created_at, started_at, ended_at,
          exit_code, error_code
        ) VALUES (
          '0198f8b6-18f3-7ca0-9f0f-123456789abd', 'New Gemini CLI session',
          'new', NULL, NULL, 'unresolved', 'gemini', ?, ?, ?, 'launching',
          NULL, ?, NULL, NULL, NULL, NULL
        )`
      ).run(workspaceId, profileId, 'd'.repeat(64), timestamp)
    ).not.toThrow();
    expect(() =>
      database!.prepare(
        `INSERT INTO provider_launch_config (provider, command, updated_at)
         VALUES ('gemini', 'gemini-preview', ?)`
      ).run(timestamp)
    ).not.toThrow();
    expect(
      database.prepare(
        `SELECT provider FROM runtime_instance ORDER BY created_at, id`
      ).all()
    ).toEqual([{ provider: 'codex' }, { provider: 'gemini' }]);
    expect(
      database.prepare(
        `SELECT command FROM provider_launch_config WHERE provider = 'codex'`
      ).get()
    ).toEqual({ command: 'codexp' });
  });

  it('preserves catalog data and allows all registered provider ids', () => {
    database = new DatabaseSync(':memory:');
    runMigrations(
      database,
      CATALOG_MIGRATIONS.filter(({ version }) => version <= 10)
    );
    const timestamp = '2026-07-17T04:00:00.000Z';
    const workspaceId = 'a'.repeat(64);
    const sessionId = 'b'.repeat(64);
    const profileId = 'd'.repeat(64);
    const runtimeId = '0198f8b6-18f3-7ca0-9f0f-123456789abe';
    database.prepare(
      `INSERT INTO workspace (
        id, identity_key, canonical_path, display_name, available, origin,
        created_at, updated_at
      ) VALUES (?, 'workspace-key', '/work/lumora', 'Lumora', 1, 'manual', ?, ?)`
    ).run(workspaceId, timestamp, timestamp);
    database.prepare(
      `INSERT INTO session (
        id, provider, native_id, workspace_id, title, normalized_title,
        created_at, updated_at, lifecycle, source_freshness
      ) VALUES (?, 'codex', 'native-1', ?, 'Existing', 'existing', ?, ?, 'saved', 'current')`
    ).run(sessionId, workspaceId, timestamp, timestamp);
    database.prepare(
      `INSERT INTO session_source (
        provider, source_key, session_id, size, modified_at_ms,
        last_seen_scan_id, stale
      ) VALUES ('codex', 'source-1', ?, NULL, NULL, 'scan-1', 0)`
    ).run(sessionId);
    database.prepare(
      `INSERT INTO scan_error (
        provider, code, affected_count, message, recovery, retryable, scanned_at
      ) VALUES ('claude', 'TEST', 1, 'message', 'retry', 1, ?)`
    ).run(timestamp);
    database.prepare(
      `INSERT INTO terminal_profile (
        id, kind, name, shell_family, executable_path, args_json,
        available, recommended, created_at, updated_at
      ) VALUES (?, 'detected', 'Bash', 'bash', '/bin/bash', '[]',
        1, 1, ?, ?)`
    ).run(profileId, timestamp, timestamp);
    database.prepare(
      `INSERT INTO runtime_instance (
        id, provider, workspace_id, terminal_profile_id, launch_hash, state,
        created_at, session_id
      ) VALUES (?, 'codex', ?, ?, ?, 'completed', ?, ?)`
    ).run(
      runtimeId,
      workspaceId,
      profileId,
      'e'.repeat(64),
      timestamp,
      sessionId
    );

    runMigrations(database, CATALOG_MIGRATIONS);

    expect(() =>
      database!.prepare(
        `INSERT INTO session (
          id, provider, native_id, workspace_id, title, normalized_title,
          created_at, updated_at, lifecycle, source_freshness
        ) VALUES (?, 'gemini', 'native-2', ?, 'Gemini', 'gemini', ?, ?, 'saved', 'current')`
      ).run('c'.repeat(64), workspaceId, timestamp, timestamp)
    ).not.toThrow();
    expect(() =>
      database!.prepare(
        `INSERT INTO session_source (
          provider, source_key, session_id, size, modified_at_ms,
          last_seen_scan_id, stale
        ) VALUES ('opencode', 'source-2', ?, NULL, NULL, 'scan-2', 0)`
      ).run(sessionId)
    ).not.toThrow();
    expect(() =>
      database!.prepare(
        `INSERT INTO scan_error (
          provider, code, affected_count, message, recovery, retryable, scanned_at
        ) VALUES ('qwen', 'TEST', 1, 'message', 'retry', 1, ?)`
      ).run(timestamp)
    ).not.toThrow();
    expect(
      database.prepare(
        `SELECT provider, native_id FROM session ORDER BY native_id`
      ).all()
    ).toEqual([
      { provider: 'codex', native_id: 'native-1' },
      { provider: 'gemini', native_id: 'native-2' }
    ]);
    expect(
      database.prepare(
        'SELECT session_id FROM runtime_instance WHERE id = ?'
      ).get(runtimeId)
    ).toEqual({ session_id: sessionId });
  });

  it('adds a nullable constrained lifetime token total to existing sessions', () => {
    database = new DatabaseSync(':memory:');
    runMigrations(
      database,
      CATALOG_MIGRATIONS.filter(({ version }) => version <= 11)
    );
    const timestamp = '2026-07-22T01:00:00.000Z';
    const workspaceId = 'a'.repeat(64);
    const sessionId = 'b'.repeat(64);
    database.prepare(
      `INSERT INTO workspace (
        id, identity_key, canonical_path, display_name, available, origin,
        created_at, updated_at
      ) VALUES (?, 'workspace-key', '/work/lumora', 'Lumora', 1, 'manual', ?, ?)`
    ).run(workspaceId, timestamp, timestamp);
    database.prepare(
      `INSERT INTO session (
        id, provider, native_id, workspace_id, title, normalized_title,
        created_at, updated_at, lifecycle, source_freshness
      ) VALUES (?, 'codex', 'native-1', ?, 'Existing', 'existing', ?, ?, 'saved', 'current')`
    ).run(sessionId, workspaceId, timestamp, timestamp);

    runMigrations(database, CATALOG_MIGRATIONS);

    expect(
      database.prepare('SELECT lifetime_tokens FROM session WHERE id = ?').get(sessionId)
    ).toEqual({ lifetime_tokens: null });
    expect(() =>
      database!.prepare('UPDATE session SET lifetime_tokens = 128450 WHERE id = ?').run(sessionId)
    ).not.toThrow();
    expect(() =>
      database!.prepare('UPDATE session SET lifetime_tokens = -1 WHERE id = ?').run(sessionId)
    ).toThrow();
    expect(() =>
      database!.prepare(
        'UPDATE session SET lifetime_tokens = 9007199254740992 WHERE id = ?'
      ).run(sessionId)
    ).toThrow();
  });

  it('invalidates Codex totals cached with the raw-token calculation', () => {
    database = new DatabaseSync(':memory:');
    runMigrations(
      database,
      CATALOG_MIGRATIONS.filter(({ version }) => version <= 12)
    );
    const timestamp = '2026-07-22T01:00:00.000Z';
    const workspaceId = 'a'.repeat(64);
    const sessionId = 'b'.repeat(64);
    database.prepare(
      `INSERT INTO workspace (
        id, identity_key, canonical_path, display_name, available, origin,
        created_at, updated_at
      ) VALUES (?, 'workspace-key', '/work/lumora', 'Lumora', 1, 'manual', ?, ?)`
    ).run(workspaceId, timestamp, timestamp);
    database.prepare(
      `INSERT INTO session (
        id, provider, native_id, workspace_id, title, normalized_title,
        created_at, updated_at, lifetime_tokens, lifecycle, source_freshness
      ) VALUES (?, 'codex', 'native-1', ?, 'Existing', 'existing', ?, ?,
        754000000, 'saved', 'current')`
    ).run(sessionId, workspaceId, timestamp, timestamp);
    database.prepare(
      `INSERT INTO session_source (
        provider, source_key, session_id, size, modified_at_ms,
        last_seen_scan_id, stale
      ) VALUES ('codex', '/rollout.jsonl', ?, 4096, 1234, 'scan-1', 0)`
    ).run(sessionId);

    runMigrations(database, CATALOG_MIGRATIONS);

    expect(
      database.prepare('SELECT lifetime_tokens FROM session WHERE id = ?').get(sessionId)
    ).toEqual({ lifetime_tokens: null });
    expect(
      database.prepare(
        `SELECT size, modified_at_ms FROM session_source
         WHERE provider = 'codex' AND source_key = '/rollout.jsonl'`
      ).get()
    ).toEqual({ size: null, modified_at_ms: null });
  });

  it('invalidates cached totals for newly supported provider token parsers', () => {
    database = new DatabaseSync(':memory:');
    runMigrations(
      database,
      CATALOG_MIGRATIONS.filter(({ version }) => version <= 13)
    );
    const timestamp = '2026-07-22T02:00:00.000Z';
    const workspaceId = 'a'.repeat(64);
    database.prepare(
      `INSERT INTO workspace (
        id, identity_key, canonical_path, display_name, available, origin,
        created_at, updated_at
      ) VALUES (?, 'workspace-key', '/work/lumora', 'Lumora', 1, 'manual', ?, ?)`
    ).run(workspaceId, timestamp, timestamp);

    const providers = ['claude', 'gemini', 'qwen', 'copilot', 'codex', 'opencode'];
    providers.forEach((provider, index) => {
      const sessionId = String(index + 1).repeat(64);
      database!.prepare(
        `INSERT INTO session (
          id, provider, native_id, workspace_id, title, normalized_title,
          created_at, updated_at, lifetime_tokens, lifecycle, source_freshness
        ) VALUES (?, ?, ?, ?, 'Existing', 'existing', ?, ?, 123,
          'saved', 'current')`
      ).run(sessionId, provider, `native-${index}`, workspaceId, timestamp, timestamp);
      database!.prepare(
        `INSERT INTO session_source (
          provider, source_key, session_id, size, modified_at_ms,
          last_seen_scan_id, stale
        ) VALUES (?, ?, ?, 4096, 1234, 'scan-1', 0)`
      ).run(provider, `/session-${index}`, sessionId);
    });

    runMigrations(database, CATALOG_MIGRATIONS);

    expect(
      database.prepare(
        `SELECT provider, lifetime_tokens FROM session ORDER BY provider`
      ).all()
    ).toEqual([
      { provider: 'claude', lifetime_tokens: null },
      { provider: 'codex', lifetime_tokens: 123 },
      { provider: 'copilot', lifetime_tokens: null },
      { provider: 'gemini', lifetime_tokens: null },
      { provider: 'opencode', lifetime_tokens: 123 },
      { provider: 'qwen', lifetime_tokens: null }
    ]);
    expect(
      database.prepare(
        `SELECT provider, size, modified_at_ms FROM session_source
         ORDER BY provider`
      ).all()
    ).toEqual([
      { provider: 'claude', size: null, modified_at_ms: null },
      { provider: 'codex', size: 4096, modified_at_ms: 1234 },
      { provider: 'copilot', size: null, modified_at_ms: null },
      { provider: 'gemini', size: null, modified_at_ms: null },
      { provider: 'opencode', size: 4096, modified_at_ms: 1234 },
      { provider: 'qwen', size: null, modified_at_ms: null }
    ]);
  });
});
