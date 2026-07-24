import type { DatabaseSync } from 'node:sqlite';

import {
  DEFAULT_GENERAL_SETTINGS,
  DEFAULT_KEYBOARD_SETTINGS,
  GeneralSettingsSchema,
  KeyboardSettingsSchema,
  LaunchSettingsLayerInputSchema,
  LaunchSettingsLayerListSchema,
  LaunchSettingsLayerSchema,
  LaunchSettingsValueSchema,
  ProviderLaunchConfigInputSchema,
  ProviderLaunchConfigListSchema,
  RuntimeSummarySchema,
  TerminalProfileSchema,
  WorkspaceTrustDecisionListSchema,
  WorkspaceTrustDecisionSchema,
  parseStoredGeneralSettings,
  type GeneralSettings,
  type LaunchSettingsLayer,
  type LaunchSettingsLayerInput,
  type KeyboardSettings,
  type ProviderId,
  type ProviderLaunchConfig,
  type ProviderLaunchConfigInput,
  type RuntimeReconciliationState,
  type RuntimeSummary,
  type SessionSummary,
  type TerminalProfile,
  type WorkspaceTrustDecision
} from '../../shared/contracts';
import { PROVIDER_DEFINITIONS } from '../../shared/provider-definitions';
import { resolveRuntimeSessionMatches } from '../terminal/runtime-session-matcher';

const KEYBOARD_SETTINGS_PREFERENCE_KEY = 'keyboardShortcuts.v1';
const GENERAL_SETTINGS_PREFERENCE_KEY = 'generalSettings.v1';

interface LaunchSettingsLayerRow {
  scope: LaunchSettingsLayer['scope'];
  target_id: string;
  settings_json: string;
  updated_at: string;
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

interface WorkspaceTrustDecisionRow {
  workspace_id: string;
  canonical_path: string;
  trusted_at: string;
}

interface SessionLaunchRow {
  id: string;
  title: string;
  native_id: string;
  provider: SessionSummary['provider'];
  workspace_id: string;
  source_freshness: SessionSummary['sourceFreshness'];
}

interface RuntimeRow {
  id: string;
  display_name: string;
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
  title: string;
  nativeId: string;
  provider: SessionSummary['provider'];
  workspaceId: string;
  sourceFreshness: SessionSummary['sourceFreshness'];
}

function normalizeTimestamp(value: string): string {
  return new Date(value).toISOString();
}

function sessionScopeKey(provider: ProviderId, workspaceId: string): string {
  return `${provider}\u0000${workspaceId}`;
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
    displayName: row.display_name,
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

  getGeneralSettings(): GeneralSettings {
    const row = this.database.prepare(
      'SELECT value_json FROM app_preference WHERE key = ?'
    ).get(GENERAL_SETTINGS_PREFERENCE_KEY) as
      | { value_json: string }
      | undefined;
    if (row === undefined) {
      return parseStoredGeneralSettings(DEFAULT_GENERAL_SETTINGS);
    }

    try {
      return parseStoredGeneralSettings(JSON.parse(row.value_json));
    } catch {
      return parseStoredGeneralSettings(DEFAULT_GENERAL_SETTINGS);
    }
  }

  saveGeneralSettings(
    value: GeneralSettings,
    timestamp: string
  ): GeneralSettings {
    const settings = GeneralSettingsSchema.parse(value);
    this.database.prepare(
      `INSERT INTO app_preference (key, value_json, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET
         value_json = excluded.value_json,
         updated_at = excluded.updated_at`
    ).run(
      GENERAL_SETTINGS_PREFERENCE_KEY,
      JSON.stringify(settings),
      normalizeTimestamp(timestamp)
    );
    return settings;
  }

  getKeyboardSettings(): KeyboardSettings {
    const row = this.database.prepare(
      'SELECT value_json FROM app_preference WHERE key = ?'
    ).get(KEYBOARD_SETTINGS_PREFERENCE_KEY) as
      | { value_json: string }
      | undefined;
    if (row === undefined) {
      return KeyboardSettingsSchema.parse(DEFAULT_KEYBOARD_SETTINGS);
    }

    try {
      const parsed = KeyboardSettingsSchema.safeParse(JSON.parse(row.value_json));
      return parsed.success
        ? parsed.data
        : KeyboardSettingsSchema.parse(DEFAULT_KEYBOARD_SETTINGS);
    } catch {
      return KeyboardSettingsSchema.parse(DEFAULT_KEYBOARD_SETTINGS);
    }
  }

  saveKeyboardSettings(
    value: KeyboardSettings,
    timestamp: string
  ): KeyboardSettings {
    const settings = KeyboardSettingsSchema.parse(value);
    this.database.prepare(
      `INSERT INTO app_preference (key, value_json, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET
         value_json = excluded.value_json,
         updated_at = excluded.updated_at`
    ).run(
      KEYBOARD_SETTINGS_PREFERENCE_KEY,
      JSON.stringify(settings),
      normalizeTimestamp(timestamp)
    );
    return settings;
  }

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

  listWorkspaceTrustDecisions(): WorkspaceTrustDecision[] {
    const rows = this.database
      .prepare(
        `SELECT workspace_id, canonical_path, trusted_at
         FROM trust_decision
         ORDER BY trusted_at DESC, workspace_id`
      )
      .all() as unknown as WorkspaceTrustDecisionRow[];
    return WorkspaceTrustDecisionListSchema.parse(
      rows.map((row) =>
        WorkspaceTrustDecisionSchema.parse({
          workspaceId: row.workspace_id,
          canonicalPath: row.canonical_path,
          trustedAt: row.trusted_at
        })
      )
    );
  }

  isWorkspaceTrusted(workspaceId: string, canonicalPath: string): boolean {
    return (
      this.database
        .prepare(
          `SELECT 1
           FROM trust_decision
           WHERE workspace_id = ? AND canonical_path = ?`
        )
        .get(workspaceId, canonicalPath) !== undefined
    );
  }

  trustWorkspace(
    workspaceId: string,
    canonicalPath: string,
    timestamp: string
  ): WorkspaceTrustDecision {
    const workspace = this.getWorkspace(workspaceId);
    if (workspace === null) {
      throw new Error('The workspace does not exist.');
    }
    if (!workspace.available) {
      throw new Error('The workspace is not available.');
    }
    if (workspace.canonicalPath !== canonicalPath) {
      throw new Error('The workspace canonical path does not match.');
    }

    const decision = WorkspaceTrustDecisionSchema.parse({
      workspaceId,
      canonicalPath,
      trustedAt: normalizeTimestamp(timestamp)
    });
    this.database
      .prepare(
        `INSERT INTO trust_decision (
          workspace_id, canonical_path, trusted_at
        ) VALUES (?, ?, ?)
        ON CONFLICT(workspace_id) DO UPDATE SET
          canonical_path = excluded.canonical_path,
          trusted_at = excluded.trusted_at`
      )
      .run(decision.workspaceId, decision.canonicalPath, decision.trustedAt);
    return decision;
  }

  revokeWorkspaceTrust(workspaceId: string): WorkspaceTrustDecision[] {
    this.database
      .prepare('DELETE FROM trust_decision WHERE workspace_id = ?')
      .run(workspaceId);
    return this.listWorkspaceTrustDecisions();
  }

  getSession(sessionId: string): SessionLaunchInfo | null {
    const row = this.database
      .prepare(
        `SELECT id, title, native_id, provider, workspace_id, source_freshness
         FROM session WHERE id = ?`
      )
      .get(sessionId) as SessionLaunchRow | undefined;
    return row === undefined
      ? null
      : {
          id: row.id,
          title: row.title,
          nativeId: row.native_id,
          provider: row.provider,
          workspaceId: row.workspace_id,
          sourceFreshness: row.source_freshness
        };
  }

  listCurrentSessionSourceKeys(sessionId: string): string[] {
    return (
      this.database.prepare(
        `SELECT source.source_key
         FROM session_source source
         JOIN session ON session.id = source.session_id
         WHERE source.session_id = ?
           AND source.stale = 0
           AND session.source_freshness = 'current'
         ORDER BY source.source_key`
      ).all(sessionId) as unknown as Array<{ source_key: string }>
    ).map((row) => row.source_key);
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
    const layers = this.listLaunchSettingsLayers().filter(
      (layer) => layer.scope === 'provider'
    );
    const commands = new Map(
      layers.map((layer) => [
        layer.targetId,
        layer.settings.providerCommands?.[layer.targetId]
      ])
    );
    return ProviderLaunchConfigListSchema.parse(
      PROVIDER_DEFINITIONS.map(({ provider }) => ({
        provider,
        command: commands.get(provider) ?? null
      }))
    );
  }

  saveProviderLaunchConfig(
    value: ProviderLaunchConfigInput,
    timestamp: string
  ): ProviderLaunchConfig[] {
    const input = ProviderLaunchConfigInputSchema.parse(value);
    const existing = this.listLaunchSettingsLayers().find(
      (layer) =>
        layer.scope === 'provider' && layer.targetId === input.provider
    );
    this.saveLaunchSettingsLayer(
      {
        scope: 'provider',
        targetId: input.provider,
        settings: {
          ...existing?.settings,
          providerCommands: { [input.provider]: input.command }
        }
      },
      timestamp
    );
    return this.listProviderLaunchConfigs();
  }

  getProviderLaunchCommand(provider: ProviderId): string | null {
    const layer = this.listLaunchSettingsLayers().find(
      (candidate) =>
        candidate.scope === 'provider' && candidate.targetId === provider
    );
    return layer?.settings.providerCommands?.[provider] ?? null;
  }

  listLaunchSettingsLayers(): LaunchSettingsLayer[] {
    const rows = this.database
      .prepare(
        `SELECT scope, target_id, settings_json, updated_at
         FROM config_layer
         ORDER BY CASE scope
          WHEN 'global' THEN 0
          WHEN 'provider' THEN 1
          WHEN 'workspace' THEN 2
          ELSE 3 END,
          target_id`
      )
      .all() as unknown as LaunchSettingsLayerRow[];
    return LaunchSettingsLayerListSchema.parse(
      rows.map((row) =>
        LaunchSettingsLayerSchema.parse({
          scope: row.scope,
          targetId: row.target_id,
          settings: LaunchSettingsValueSchema.parse(
            JSON.parse(row.settings_json) as unknown
          ),
          updatedAt: row.updated_at
        })
      )
    );
  }

  saveLaunchSettingsLayer(
    value: LaunchSettingsLayerInput,
    timestamp: string
  ): LaunchSettingsLayer[] {
    const input = LaunchSettingsLayerInputSchema.parse(value);
    if (
      input.scope === 'workspace' &&
      this.getWorkspace(input.targetId) === null
    ) {
      throw new Error('The launch settings workspace does not exist.');
    }
    if (input.scope === 'session') {
      const session = this.getSession(input.targetId);
      if (session === null) {
        throw new Error('The launch settings session does not exist.');
      }
      const commands = input.settings.providerCommands;
      if (
        commands !== undefined &&
        Object.keys(commands).some((provider) => provider !== session.provider)
      ) {
        throw new Error(
          'Session launch settings can only configure their session provider.'
        );
      }
    }

    const empty =
      input.settings.terminalProfileId === undefined &&
      (input.settings.providerCommands === undefined ||
        Object.keys(input.settings.providerCommands).length === 0);
    if (empty) {
      this.database
        .prepare('DELETE FROM config_layer WHERE scope = ? AND target_id = ?')
        .run(input.scope, input.targetId);
    } else {
      this.database
        .prepare(
          `INSERT INTO config_layer (
            scope, target_id, settings_json, updated_at
          ) VALUES (?, ?, ?, ?)
          ON CONFLICT(scope, target_id) DO UPDATE SET
            settings_json = excluded.settings_json,
            updated_at = excluded.updated_at`
        )
        .run(
          input.scope,
          input.targetId,
          JSON.stringify(input.settings),
          normalizeTimestamp(timestamp)
        );
    }
    return this.listLaunchSettingsLayers();
  }

  saveRuntime(
    value: RuntimeSummary,
    baselineNativeSessionIds?: readonly string[]
  ): void {
    const runtime = RuntimeSummarySchema.parse(value);
    let baseline: string[] | undefined;
    if (baselineNativeSessionIds !== undefined) {
      if (
        runtime.strategy === 'resume' ||
        runtime.reconciliationState !== 'pending'
      ) {
        throw new Error(
          'Only pending new or fork runtimes can persist a baseline.'
        );
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
          id, display_name, strategy, session_id, native_session_id, reconciliation_state,
          provider, workspace_id, terminal_profile_id, launch_hash, state, pid,
          created_at, started_at, ended_at, exit_code, error_code
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          display_name = excluded.display_name,
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
        runtime.displayName,
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
          `SELECT id, display_name, strategy, session_id, native_session_id,
            reconciliation_state, provider, workspace_id, terminal_profile_id,
            launch_hash, state, pid, created_at, started_at, ended_at,
            exit_code, error_code
           FROM runtime_instance WHERE id = ?`
        )
        .get(runtimeId) as RuntimeRow | undefined;
      if (
        current === undefined ||
        current.strategy === 'resume' ||
        current.reconciliation_state !== 'pending'
      ) {
        this.database.exec('ROLLBACK');
        return null;
      }

      let sessionId: string | null = null;
      let nativeSessionId: string | null = null;
      let displayName = current.display_name;
      if (result.state === 'linked') {
        const session = this.getSession(result.sessionId);
        const claimed = this.database
          .prepare(
            `SELECT 1 FROM runtime_instance
             WHERE id <> ? AND session_id = ?
               AND state IN ('launching', 'running')
             LIMIT 1`
          )
          .get(runtimeId, result.sessionId);
        if (
          session === null ||
          claimed !== undefined ||
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
        displayName = session.title;
      }

      const update = this.database
        .prepare(
          `UPDATE runtime_instance
           SET reconciliation_state = ?, session_id = ?, native_session_id = ?,
             display_name = ?
           WHERE id = ? AND strategy IN ('new', 'fork') AND reconciliation_state = 'pending'`
        )
        .run(result.state, sessionId, nativeSessionId, displayName, runtimeId);
      if (update.changes !== 1) {
        this.database.exec('ROLLBACK');
        return null;
      }
      const updated = this.database
        .prepare(
          `SELECT id, display_name, strategy, session_id, native_session_id,
            reconciliation_state, provider, workspace_id, terminal_profile_id,
            launch_hash, state, pid, created_at, started_at, ended_at,
            exit_code, error_code
           FROM runtime_instance WHERE id = ?`
        )
        .get(runtimeId) as unknown as RuntimeRow;
      const runtime = rowToRuntime(updated);
      this.database.exec('COMMIT');
      return runtime;
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }

  synchronizeRuntimeSessions(): RuntimeSummary[] {
    this.database.exec('BEGIN IMMEDIATE');
    try {
      const changedRuntimeIds = new Set<string>();
      const renamed = this.database
        .prepare(
          `SELECT runtime.id, session.title
           FROM runtime_instance runtime
           JOIN session ON session.id = runtime.session_id
           WHERE session.source_freshness = 'current'
             AND runtime.state IN ('launching', 'running')
             AND runtime.display_name <> session.title`
        )
        .all() as unknown as Array<{ id: string; title: string }>;
      const updateTitle = this.database.prepare(
        'UPDATE runtime_instance SET display_name = ? WHERE id = ?'
      );
      for (const runtime of renamed) {
        updateTitle.run(runtime.title, runtime.id);
        changedRuntimeIds.add(runtime.id);
      }

      const retryable = this.database
        .prepare(
          `SELECT runtime.id, runtime.provider, runtime.workspace_id,
             runtime.reconciliation_state, reconciliation.baseline_native_ids_json
           FROM runtime_instance runtime
           JOIN runtime_reconciliation reconciliation
             ON reconciliation.runtime_id = runtime.id
           WHERE runtime.strategy IN ('new', 'fork')
             AND runtime.session_id IS NULL
             AND runtime.state IN ('launching', 'running')
             AND runtime.reconciliation_state IN ('unresolved', 'ambiguous')
           ORDER BY runtime.created_at, runtime.id`
        )
        .all() as unknown as Array<{
        id: string;
        provider: ProviderId;
        workspace_id: string;
        reconciliation_state: 'unresolved' | 'ambiguous';
        baseline_native_ids_json: string;
      }>;
      const claimedSessionIds = new Set(
        (
          this.database
            .prepare(
              `SELECT session_id FROM runtime_instance
               WHERE session_id IS NOT NULL
                 AND state IN ('launching', 'running')`
            )
            .all() as unknown as Array<{ session_id: string }>
        ).map((row) => row.session_id)
      );
      const currentSessions = this.database
        .prepare(
          `SELECT id, native_id, provider, workspace_id, title
           FROM session
           WHERE source_freshness = 'current'
           ORDER BY native_id, id`
        )
        .all() as unknown as Array<{
        id: string;
        native_id: string;
        provider: ProviderId;
        workspace_id: string;
        title: string;
      }>;
      const sessionsByScope = new Map<string, typeof currentSessions>();
      for (const session of currentSessions) {
        const key = sessionScopeKey(session.provider, session.workspace_id);
        const sessions = sessionsByScope.get(key) ?? [];
        sessions.push(session);
        sessionsByScope.set(key, sessions);
      }
      const candidatesByRuntime = new Map(
        retryable.map((runtime) => {
          const baseline = new Set(
            JSON.parse(runtime.baseline_native_ids_json) as string[]
          );
          const candidates = (
            sessionsByScope.get(
              sessionScopeKey(runtime.provider, runtime.workspace_id)
            ) ?? []
          )
            .filter(
              (session) =>
                !baseline.has(session.native_id) &&
                !claimedSessionIds.has(session.id)
            )
            .map((session) => ({
              sessionId: session.id,
              nativeSessionId: session.native_id
            }));
          return [runtime.id, candidates] as const;
        })
      );
      const matches = resolveRuntimeSessionMatches(
        retryable.map((runtime) => ({
          runtimeId: runtime.id,
          candidates: candidatesByRuntime.get(runtime.id) ?? []
        }))
      );
      const matchedRuntimeIds = new Set(matches.map((match) => match.runtimeId));
      const assignedSessionIds = new Set(matches.map((match) => match.sessionId));
      const sessionsById = new Map(
        currentSessions.map((session) => [session.id, session])
      );
      const linkRuntime = this.database.prepare(
        `UPDATE runtime_instance
         SET reconciliation_state = 'linked', session_id = ?,
           native_session_id = ?, display_name = ?
         WHERE id = ? AND strategy IN ('new', 'fork') AND session_id IS NULL
           AND state IN ('launching', 'running')
           AND reconciliation_state IN ('unresolved', 'ambiguous')
           AND NOT EXISTS (
             SELECT 1 FROM runtime_instance claimed
             WHERE claimed.id <> runtime_instance.id
               AND claimed.session_id = ?
               AND claimed.state IN ('launching', 'running')
           )`
      );
      for (const match of matches) {
        const session = sessionsById.get(match.sessionId);
        if (session === undefined) continue;
        const update = linkRuntime.run(
          match.sessionId,
          match.nativeSessionId,
          session.title,
          match.runtimeId,
          match.sessionId
        );
        if (update.changes === 1) {
          changedRuntimeIds.add(match.runtimeId);
        }
      }

      const updateReconciliationState = this.database.prepare(
        `UPDATE runtime_instance SET reconciliation_state = ?
         WHERE id = ? AND reconciliation_state <> ?`
      );
      for (const runtime of retryable) {
        if (matchedRuntimeIds.has(runtime.id)) continue;
        const candidates = (candidatesByRuntime.get(runtime.id) ?? []).filter(
          (candidate) => !assignedSessionIds.has(candidate.sessionId)
        );
        const nextState = candidates.length === 0 ? 'unresolved' : 'ambiguous';
        const update = updateReconciliationState.run(
          nextState,
          runtime.id,
          nextState
        );
        if (update.changes === 1) {
          changedRuntimeIds.add(runtime.id);
        }
      }

      const placeholders = [...changedRuntimeIds].map(() => '?').join(', ');
      const changed = changedRuntimeIds.size === 0
        ? []
        : (
            this.database
              .prepare(
                `SELECT id, display_name, strategy, session_id, native_session_id,
                  reconciliation_state, provider, workspace_id,
                  terminal_profile_id, launch_hash, state, pid, created_at,
                  started_at, ended_at, exit_code, error_code
                 FROM runtime_instance
                 WHERE id IN (${placeholders})
                 ORDER BY created_at DESC, id`
              )
              .all(...changedRuntimeIds) as unknown as RuntimeRow[]
          ).map(rowToRuntime);
      this.database.exec('COMMIT');
      return changed;
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }

  listRuntimes(): RuntimeSummary[] {
    const rows = this.database
      .prepare(
        `SELECT id, display_name, strategy, session_id, native_session_id,
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
