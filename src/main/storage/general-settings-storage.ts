import type { DatabaseSync } from 'node:sqlite';

import {
  DEFAULT_GENERAL_SETTINGS,
  GeneralSettingsSchema,
  LOCAL_EXECUTION_TARGET_ID,
  parseStoredGeneralSettings,
  type ExecutionTargetId,
  type GeneralSettings
} from '../../shared/contracts';

const LEGACY_SETTINGS_KEY = 'generalSettings.v1';
const GLOBAL_SETTINGS_KEY = 'generalSettings.global.v1';
const TARGET_SETTINGS_KEY = 'generalSettings.target.v1';

type GlobalGeneralSettings = Pick<
  GeneralSettings,
  | 'showInformationalNotices'
  | 'startMaximized'
  | 'autoExpandSidebar'
  | 'windowCloseBehavior'
  | 'remoteWindowCloseBehavior'
  | 'appearance'
>;

type TargetGeneralSettings = Pick<
  GeneralSettings,
  | 'showUnavailableWorkspaces'
  | 'showUnusableSessions'
  | 'checkProviderUpdatesAutomatically'
  | 'crossAgentWorkflowEnabled'
  | 'crossAgentHandoffRetentionDays'
  | 'enabledProviders'
>;

function normalizeTimestamp(value: string): string {
  return new Date(value).toISOString();
}

function globalProjection(settings: GeneralSettings): GlobalGeneralSettings {
  return {
    showInformationalNotices: settings.showInformationalNotices,
    startMaximized: settings.startMaximized,
    autoExpandSidebar: settings.autoExpandSidebar,
    windowCloseBehavior: settings.windowCloseBehavior,
    remoteWindowCloseBehavior: settings.remoteWindowCloseBehavior,
    appearance: settings.appearance
  };
}

function targetProjection(settings: GeneralSettings): TargetGeneralSettings {
  return {
    showUnavailableWorkspaces: settings.showUnavailableWorkspaces,
    showUnusableSessions: settings.showUnusableSessions,
    checkProviderUpdatesAutomatically: settings.checkProviderUpdatesAutomatically,
    crossAgentWorkflowEnabled: settings.crossAgentWorkflowEnabled,
    crossAgentHandoffRetentionDays: settings.crossAgentHandoffRetentionDays,
    enabledProviders: settings.enabledProviders
  };
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return undefined;
  }
}

function objectValue(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

export class GeneralSettingsStorage {
  constructor(
    private readonly database: DatabaseSync,
    private readonly executionTargetId: ExecutionTargetId
  ) {}

  get(): GeneralSettings {
    const legacy = this.readLegacy();
    const global = this.readGlobal(legacy);
    const targetFallback = this.executionTargetId === LOCAL_EXECUTION_TARGET_ID
      ? legacy
      : DEFAULT_GENERAL_SETTINGS;
    const target = this.readTarget(targetFallback);
    return GeneralSettingsSchema.parse({
      version: 8,
      ...globalProjection(global),
      ...targetProjection(target)
    });
  }

  save(value: GeneralSettings, timestamp: string): GeneralSettings {
    const settings = GeneralSettingsSchema.parse(value);
    const normalizedTimestamp = normalizeTimestamp(timestamp);
    this.database.exec('BEGIN IMMEDIATE');
    try {
      this.writeGlobal(globalProjection(settings), normalizedTimestamp);
      this.writeTarget(targetProjection(settings), normalizedTimestamp);
      this.database.exec('COMMIT');
      return settings;
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }

  private readLegacy(): GeneralSettings {
    const row = this.database.prepare(
      'SELECT value_json FROM app_preference WHERE key = ?'
    ).get(LEGACY_SETTINGS_KEY) as { value_json: string } | undefined;
    return row === undefined
      ? GeneralSettingsSchema.parse(DEFAULT_GENERAL_SETTINGS)
      : parseStoredGeneralSettings(parseJson(row.value_json));
  }

  private readGlobal(fallback: GeneralSettings): GeneralSettings {
    const row = this.database.prepare(
      'SELECT value_json FROM app_preference WHERE key = ?'
    ).get(GLOBAL_SETTINGS_KEY) as { value_json: string } | undefined;
    const parsed = GeneralSettingsSchema.safeParse({
      ...fallback,
      ...(row === undefined ? {} : objectValue(parseJson(row.value_json))),
      version: 8
    });
    return parsed.success ? parsed.data : fallback;
  }

  private readTarget(fallback: GeneralSettings): GeneralSettings {
    const row = this.database.prepare(
      `SELECT value_json FROM execution_target_preference
       WHERE execution_target_id = ? AND key = ?`
    ).get(this.executionTargetId, TARGET_SETTINGS_KEY) as
      | { value_json: string }
      | undefined;
    if (row === undefined) {
      this.writeTarget(targetProjection(fallback), new Date().toISOString());
      return fallback;
    }
    const parsed = GeneralSettingsSchema.safeParse({
      ...fallback,
      ...objectValue(parseJson(row.value_json)),
      version: 8
    });
    return parsed.success ? parsed.data : fallback;
  }

  private writeGlobal(value: GlobalGeneralSettings, timestamp: string): void {
    this.database.prepare(
      `INSERT INTO app_preference (key, value_json, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET
         value_json = excluded.value_json,
         updated_at = excluded.updated_at`
    ).run(GLOBAL_SETTINGS_KEY, JSON.stringify(value), timestamp);
  }

  private writeTarget(value: TargetGeneralSettings, timestamp: string): void {
    this.database.prepare(
      `INSERT INTO execution_target_preference (
        execution_target_id, key, value_json, updated_at
      ) VALUES (?, ?, ?, ?)
      ON CONFLICT(execution_target_id, key) DO UPDATE SET
        value_json = excluded.value_json,
        updated_at = excluded.updated_at`
    ).run(
      this.executionTargetId,
      TARGET_SETTINGS_KEY,
      JSON.stringify(value),
      timestamp
    );
  }
}
