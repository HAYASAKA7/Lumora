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
});
