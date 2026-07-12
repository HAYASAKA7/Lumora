import type { DatabaseSync } from 'node:sqlite';

import {
  ProviderLaunchConfigInputSchema,
  ProviderLaunchConfigListSchema,
  RuntimeSummarySchema,
  TerminalProfileSchema,
  type ProviderId,
  type ProviderLaunchConfig,
  type ProviderLaunchConfigInput,
  type RuntimeReconciliationState,
  type RuntimeSummary,
  type SessionSummary,
  type TerminalProfile
} from '../../shared/contracts';

interface ProviderLaunchConfigRow {
  provider: ProviderId;
  command: string;
}

interface TerminalProfileRow {
  id: string;
  kind: TerminalProfile['kind'];
  name: string;
  shell_family: TerminalProfile['shellFamily'];
  executable_path: string;
  args_json: string;
  available: number;
  recommended: number;
}

interface WorkspaceLaunchRow {
  id: string;
  canonical_path: string;
  display_name: string;
  available: number;
}

interface SessionLaunchRow {
  id: string;
  native_id: string;
  provider: SessionSummary['provider'];
  workspace_id: string;
  source_freshness: SessionSummary['sourceFreshness'];
}

interface RuntimeRow {
  id: string;
  strategy: RuntimeSummary['strategy'];
  session_id: string | null;
  native_session_id: string | null;
  reconciliation_state: RuntimeReconciliationState;
  provider: RuntimeSummary['provider'];
  workspace_id: string;
  terminal_profile_id: string;
  launch_hash: string;
  state: RuntimeSummary['state'];
  pid: number | null;
  created_at: string;
  started_at: string | null;
  ended_at: string | null;
  exit_code: number | null;
  error_code: RuntimeSummary['errorCode'];
}

export interface SessionIdentity {
  id: string;
  nativeId: string;
}

export type RuntimeReconciliationResult =
  | {
      state: 'linked';
      sessionId: string;
      nativeSessionId: string;
    }
  | { state: 'ambiguous' | 'unresolved' };

export interface WorkspaceLaunchInfo {
  id: string;
  canonicalPath: string;
  displayName: string;
  available: boolean;
}

export interface SessionLaunchInfo {
  id: string;
  nativeId: string;
  provider: SessionSummary['provider'];
  workspaceId: string;
  sourceFreshness: SessionSummary['sourceFreshness'];
}

function normalizeTimestamp(value: string): string {
  return new Date(value).toISOString();
}

function rowToProfile(row: TerminalProfileRow): TerminalProfile {
  return TerminalProfileSchema.parse({
    id: row.id,
    kind: row.kind,
    name: row.name,
    shellFamily: row.shell_family,
    executablePath: row.executable_path,
    args: JSON.parse(row.args_json) as unknown,
    available: row.available === 1,
    recommended: row.recommended === 1
  });
}

function rowToRuntime(row: RuntimeRow): RuntimeSummary {
  return RuntimeSummarySchema.parse({
    id: row.id,
    strategy: row.strategy,
    sessionId: row.session_id,
    nativeSessionId: row.native_session_id,
    reconciliationState: row.reconciliation_state,
    provider: row.provider,
    workspaceId: row.workspace_id,
    terminalProfileId: row.terminal_profile_id,
    launchHash: row.launch_hash,
    state: row.state,
    pid: row.pid,
    createdAt: row.created_at,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    exitCode: row.exit_code,
    errorCode: row.error_code
  });
}

export class TerminalRepository {
  constructor(private readonly database: DatabaseSync) {}

  reconcileDetectedProfiles(
    values: readonly TerminalProfile[],
    timestamp: string
  ): void {
    const profiles = values.map((value) => {
      const parsed = TerminalProfileSchema.parse(value);
      if (parsed.kind !== 'detected') {
        throw new Error('Detected profile reconciliation accepts detections only.');
      }
      return parsed;
    });
    const normalizedTimestamp = normalizeTimestamp(timestamp);
    const upsert = this.database.prepare(
      `INSERT INTO terminal_profile (
        id, kind, name, shell_family, executable_path, args_json,
        available, recommended, created_at, updated_at
      ) VALUES (?, 'detected', ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        shell_family = excluded.shell_family,
        executable_path = excluded.executable_path,
        args_json = excluded.args_json,
        available = excluded.available,
        recommended = excluded.recommended,
        updated_at = excluded.updated_at
      WHERE terminal_profile.kind = 'detected'`
    );

    this.database.exec('BEGIN IMMEDIATE');
    try {
      this.database
        .prepare(
          `UPDATE terminal_profile
           SET available = 0, recommended = 0, updated_at = ?
           WHERE kind = 'detected'`
        )
        .run(normalizedTimestamp);
      for (const profile of profiles) {
        upsert.run(
          profile.id,
          profile.name,
          profile.shellFamily,
          profile.executablePath,
          JSON.stringify(profile.args),
          profile.available ? 1 : 0,
          profile.recommended ? 1 : 0,
          normalizedTimestamp,
          normalizedTimestamp
        );
      }
      this.database.exec('COMMIT');
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }

  saveCustomProfile(value: TerminalProfile, timestamp: string): void {
    const profile = TerminalProfileSchema.parse(value);
    if (profile.kind !== 'custom') {
      throw new Error('Custom profile storage accepts custom profiles only.');
    }
    const normalizedTimestamp = normalizeTimestamp(timestamp);
    this.database
      .prepare(
        `INSERT INTO terminal_profile (
          id, kind, name, shell_family, executable_path, args_json,
          available, recommended, created_at, updated_at
        ) VALUES (?, 'custom', ?, ?, ?, ?, ?, 0, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          name = excluded.name,
          shell_family = excluded.shell_family,
          executable_path = excluded.executable_path,
          args_json = excluded.args_json,
          available = excluded.available,
          recommended = 0,
          updated_at = excluded.updated_at
        WHERE terminal_profile.kind = 'custom'`
      )
      .run(
        profile.id,
        profile.name,
        profile.shellFamily,
        profile.executablePath,
        JSON.stringify(profile.args),
        profile.available ? 1 : 0,
        normalizedTimestamp,
        normalizedTimestamp
      );
  }

  deleteCustomProfile(profileId: string): boolean {
    const result = this.database
      .prepare("DELETE FROM terminal_profile WHERE id = ? AND kind = 'custom'")
      .run(profileId);
    return result.changes === 1;
  }

  listProfiles(): TerminalProfile[] {
    const rows = this.database
      .prepare(
        `SELECT id, kind, name, shell_family, executable_path, args_json,
          available, recommended
         FROM terminal_profile
         ORDER BY recommended DESC, available DESC,
          CASE kind WHEN 'detected' THEN 0 ELSE 1 END,
          name COLLATE NOCASE, id`
      )
      .all() as unknown as TerminalProfileRow[];
    return rows.map(rowToProfile);
  }

  getProfile(profileId: string): TerminalProfile | null {
    const row = this.database
      .prepare(
        `SELECT id, kind, name, shell_family, executable_path, args_json,
          available, recommended
         FROM terminal_profile WHERE id = ?`
      )
      .get(profileId) as TerminalProfileRow | undefined;
    return row === undefined ? null : rowToProfile(row);
  }

  getWorkspace(workspaceId: string): WorkspaceLaunchInfo | null {
    const row = this.database
      .prepare(
        `SELECT id, canonical_path, display_name, available
         FROM workspace WHERE id = ?`
      )
      .get(workspaceId) as WorkspaceLaunchRow | undefined;
    return row === undefined
      ? null
      : {
          id: row.id,
          canonicalPath: row.canonical_path,
          displayName: row.display_name,
          available: row.available === 1
        };
  }

  getSession(sessionId: string): SessionLaunchInfo | null {
    const row = this.database
      .prepare(
        `SELECT id, native_id, provider, workspace_id, source_freshness
         FROM session WHERE id = ?`
      )
      .get(sessionId) as SessionLaunchRow | undefined;
    return row === undefined
      ? null
      : {
          id: row.id,
          nativeId: row.native_id,
          provider: row.provider,
          workspaceId: row.workspace_id,
          sourceFreshness: row.source_freshness
        };
  }

  listCurrentSessionIdentities(
    provider: ProviderId,
    workspaceId: string
  ): SessionIdentity[] {
    return (
      this.database
        .prepare(
          `SELECT id, native_id
           FROM session
           WHERE provider = ? AND workspace_id = ? AND source_freshness = 'current'
           ORDER BY native_id, id`
        )
        .all(provider, workspaceId) as unknown as Array<{
        id: string;
        native_id: string;
      }>
    ).map((row) => ({ id: row.id, nativeId: row.native_id }));
  }

  listProviderLaunchConfigs(): ProviderLaunchConfig[] {
    const rows = this.database
      .prepare(
        `SELECT provider, command
         FROM provider_launch_config ORDER BY provider`
      )
      .all() as unknown as ProviderLaunchConfigRow[];
    const commands = new Map(rows.map((row) => [row.provider, row.command]));
    return ProviderLaunchConfigListSchema.parse([
      { provider: 'codex', command: commands.get('codex') ?? null },
      { provider: 'claude', command: commands.get('claude') ?? null }
    ]);
  }

  saveProviderLaunchConfig(
    value: ProviderLaunchConfigInput,
    timestamp: string
  ): ProviderLaunchConfig[] {
    const input = ProviderLaunchConfigInputSchema.parse(value);
    if (input.command === null) {
      this.database
        .prepare('DELETE FROM provider_launch_config WHERE provider = ?')
        .run(input.provider);
    } else {
      this.database
        .prepare(
          `INSERT INTO provider_launch_config (provider, command, updated_at)
           VALUES (?, ?, ?)
           ON CONFLICT(provider) DO UPDATE SET
            command = excluded.command,
            updated_at = excluded.updated_at`
        )
        .run(input.provider, input.command, normalizeTimestamp(timestamp));
    }
    return this.listProviderLaunchConfigs();
  }

  getProviderLaunchCommand(provider: ProviderId): string | null {
    const row = this.database
      .prepare(
        'SELECT provider, command FROM provider_launch_config WHERE provider = ?'
      )
      .get(provider) as ProviderLaunchConfigRow | undefined;
    return row?.command ?? null;
  }

  saveRuntime(
    value: RuntimeSummary,
    baselineNativeSessionIds?: readonly string[]
  ): void {
    const runtime = RuntimeSummarySchema.parse(value);
    let baseline: string[] | undefined;
    if (baselineNativeSessionIds !== undefined) {
      if (
        runtime.strategy !== 'new' ||
        runtime.reconciliationState !== 'pending'
      ) {
        throw new Error('Only pending new runtimes can persist a baseline.');
      }
      if (baselineNativeSessionIds.length > 25_000) {
        throw new Error('Runtime reconciliation baselines are too large.');
      }
      const normalized = baselineNativeSessionIds.map((id) => id.trim());
      if (normalized.some((id) => id.length === 0 || id.length > 256)) {
        throw new Error('Runtime reconciliation baselines contain an invalid ID.');
      }
      baseline = [...new Set(normalized)].sort();
    }
    const save = this.database.prepare(
      `INSERT INTO runtime_instance (
          id, strategy, session_id, native_session_id, reconciliation_state,
          provider, workspace_id, terminal_profile_id, launch_hash, state, pid,
          created_at, started_at, ended_at, exit_code, error_code
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          state = excluded.state,
          pid = excluded.pid,
          started_at = excluded.started_at,
          ended_at = excluded.ended_at,
          exit_code = excluded.exit_code,
          error_code = excluded.error_code`
    );
    const runSave = () =>
      save.run(
        runtime.id,
        runtime.strategy,
        runtime.sessionId,
        runtime.nativeSessionId,
        runtime.reconciliationState,
        runtime.provider,
        runtime.workspaceId,
        runtime.terminalProfileId,
        runtime.launchHash,
        runtime.state,
        runtime.pid,
        runtime.createdAt,
        runtime.startedAt,
        runtime.endedAt,
        runtime.exitCode,
        runtime.errorCode
      );
    if (baseline === undefined) {
      runSave();
      return;
    }

    this.database.exec('BEGIN IMMEDIATE');
    try {
      runSave();
      this.database
        .prepare(
          `INSERT INTO runtime_reconciliation (
            runtime_id, baseline_native_ids_json
          ) VALUES (?, ?)
          ON CONFLICT(runtime_id) DO NOTHING`
        )
        .run(runtime.id, JSON.stringify(baseline));
      this.database.exec('COMMIT');
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }

  applyRuntimeReconciliation(
    runtimeId: string,
    result: RuntimeReconciliationResult
  ): RuntimeSummary | null {
    this.database.exec('BEGIN IMMEDIATE');
    try {
      const current = this.database
        .prepare(
          `SELECT id, strategy, session_id, native_session_id,
            reconciliation_state, provider, workspace_id, terminal_profile_id,
            launch_hash, state, pid, created_at, started_at, ended_at,
            exit_code, error_code
           FROM runtime_instance WHERE id = ?`
        )
        .get(runtimeId) as RuntimeRow | undefined;
      if (
        current === undefined ||
        current.strategy !== 'new' ||
        current.reconciliation_state !== 'pending'
      ) {
        this.database.exec('ROLLBACK');
        return null;
      }

      let sessionId: string | null = null;
      let nativeSessionId: string | null = null;
      if (result.state === 'linked') {
        const session = this.getSession(result.sessionId);
        if (
          session === null ||
          session.sourceFreshness !== 'current' ||
          session.provider !== current.provider ||
          session.workspaceId !== current.workspace_id ||
          session.nativeId !== result.nativeSessionId
        ) {
          this.database.exec('ROLLBACK');
          return null;
        }
        sessionId = result.sessionId;
        nativeSessionId = result.nativeSessionId;
      }

      const update = this.database
        .prepare(
          `UPDATE runtime_instance
           SET reconciliation_state = ?, session_id = ?, native_session_id = ?
           WHERE id = ? AND strategy = 'new' AND reconciliation_state = 'pending'`
        )
        .run(result.state, sessionId, nativeSessionId, runtimeId);
      if (update.changes !== 1) {
        this.database.exec('ROLLBACK');
        return null;
      }
      const updated = this.database
        .prepare(
          `SELECT id, strategy, session_id, native_session_id,
            reconciliation_state, provider, workspace_id, terminal_profile_id,
            launch_hash, state, pid, created_at, started_at, ended_at,
            exit_code, error_code
           FROM runtime_instance WHERE id = ?`
        )
        .get(runtimeId) as unknown as RuntimeRow;
      this.database.exec('COMMIT');
      return rowToRuntime(updated);
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }

  listRuntimes(): RuntimeSummary[] {
    const rows = this.database
      .prepare(
        `SELECT id, strategy, session_id, native_session_id,
          reconciliation_state, provider, workspace_id, terminal_profile_id,
          launch_hash, state, pid,
          created_at, started_at, ended_at, exit_code, error_code
         FROM runtime_instance ORDER BY created_at DESC, id`
      )
      .all() as unknown as RuntimeRow[];
    return rows.map(rowToRuntime);
  }

  markLiveRuntimesLost(timestamp: string): void {
    this.database.exec('BEGIN IMMEDIATE');
    try {
      this.database
        .prepare(
        `UPDATE runtime_instance
         SET state = 'runtime_lost', pid = NULL, ended_at = ?,
          error_code = 'PTY_RUNTIME_LOST'
         WHERE state IN ('launching', 'running')`
        )
        .run(normalizeTimestamp(timestamp));
      this.database
        .prepare(
          `UPDATE runtime_instance
           SET reconciliation_state = 'unresolved'
           WHERE reconciliation_state = 'pending'`
        )
        .run();
      this.database.exec('COMMIT');
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }
}
