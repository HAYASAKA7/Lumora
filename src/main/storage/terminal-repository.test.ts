import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  DEFAULT_GENERAL_SETTINGS,
  DEFAULT_KEYBOARD_SETTINGS,
  type GeneralSettings,
  type KeyboardSettings,
  type RuntimeSummary,
  type TerminalProfile
} from '../../shared/contracts';
import {
  CATALOG_MIGRATIONS,
  migrateCatalogDatabase,
  runMigrations
} from './migrations';
import { TerminalRepository } from './terminal-repository';

const timestamp = '2026-07-11T04:00:00.000Z';
const workspaceId = 'a'.repeat(64);

function profile(
  id: string,
  overrides: Partial<TerminalProfile> = {}
): TerminalProfile {
  return {
    id,
    kind: 'detected',
    name: 'PowerShell 7',
    shellFamily: 'pwsh',
    executablePath: 'C:\\Program Files\\PowerShell\\7\\pwsh.exe',
    args: ['-NoLogo'],
    available: true,
    recommended: true,
    ...overrides
  };
}

describe('TerminalRepository', () => {
  let database: DatabaseSync;
  let repository: TerminalRepository;

  beforeEach(() => {
    database = new DatabaseSync(':memory:');
    migrateCatalogDatabase(database);
    repository = new TerminalRepository(database);
    database
      .prepare(
        `INSERT INTO workspace (
          id, identity_key, canonical_path, display_name, available,
          origin, created_at, updated_at
        ) VALUES (?, ?, ?, ?, 1, 'manual', ?, ?)`
      )
      .run(
        workspaceId,
        'workspace-key',
        'D:\\Projects\\Lumora',
        'Lumora',
        timestamp,
        timestamp
      );
  });

  afterEach(() => database.close());

  it('reconciles detected profiles while preserving custom profiles', () => {
    const pwshId = 'b'.repeat(64);
    const bashId = 'c'.repeat(64);
    const customId = 'd'.repeat(64);
    repository.reconcileDetectedProfiles(
      [profile(pwshId), profile(bashId, { name: 'Bash', shellFamily: 'bash' })],
      timestamp
    );
    repository.saveCustomProfile(
      profile(customId, {
        kind: 'custom',
        name: 'My shell',
        recommended: false
      }),
      timestamp
    );

    repository.reconcileDetectedProfiles(
      [profile(bashId, { name: 'Bash', shellFamily: 'bash' })],
      '2026-07-11T05:00:00.000Z'
    );

    expect(repository.listProfiles()).toEqual([
      profile(bashId, { name: 'Bash', shellFamily: 'bash' }),
      profile(customId, {
        kind: 'custom',
        name: 'My shell',
        recommended: false
      }),
      profile(pwshId, { available: false, recommended: false })
    ]);
  });

  it('deletes custom profiles but refuses to delete detections', () => {
    const detectedId = 'b'.repeat(64);
    const customId = 'c'.repeat(64);
    repository.reconcileDetectedProfiles([profile(detectedId)], timestamp);
    repository.saveCustomProfile(
      profile(customId, {
        kind: 'custom',
        name: 'Custom',
        recommended: false
      }),
      timestamp
    );

    expect(repository.deleteCustomProfile(detectedId)).toBe(false);
    expect(repository.deleteCustomProfile(customId)).toBe(true);
    expect(repository.getProfile(customId)).toBeNull();
  });

  it('loads workspace launch information by stable ID', () => {
    expect(repository.getWorkspace(workspaceId)).toEqual({
      id: workspaceId,
      canonicalPath: 'D:\\Projects\\Lumora',
      displayName: 'Lumora',
      available: true
    });
    expect(repository.getWorkspace('f'.repeat(64))).toBeNull();
  });

  it('persists exact-path trust decisions and revokes them', () => {
    const canonicalPath = 'D:\\Projects\\Lumora';
    const decision = repository.trustWorkspace(
      workspaceId,
      canonicalPath,
      timestamp
    );

    expect(decision).toEqual({
      workspaceId,
      canonicalPath,
      trustedAt: timestamp
    });
    expect(repository.isWorkspaceTrusted(workspaceId, canonicalPath)).toBe(true);
    expect(
      repository.isWorkspaceTrusted(workspaceId, 'D:\\Projects\\Other')
    ).toBe(false);
    expect(repository.listWorkspaceTrustDecisions()).toEqual([decision]);

    const updatedAt = '2026-07-11T05:00:00.000Z';
    expect(
      repository.trustWorkspace(workspaceId, canonicalPath, updatedAt)
    ).toEqual({ ...decision, trustedAt: updatedAt });
    expect(repository.listWorkspaceTrustDecisions()).toEqual([
      { ...decision, trustedAt: updatedAt }
    ]);

    expect(repository.revokeWorkspaceTrust(workspaceId)).toEqual([]);
    expect(repository.isWorkspaceTrusted(workspaceId, canonicalPath)).toBe(
      false
    );
  });

  it('rejects trust for mismatched, missing, and unavailable workspaces', () => {
    expect(() =>
      repository.trustWorkspace(
        workspaceId,
        'D:\\Projects\\Other',
        timestamp
      )
    ).toThrow();
    expect(() =>
      repository.trustWorkspace(
        'f'.repeat(64),
        'D:\\Projects\\Lumora',
        timestamp
      )
    ).toThrow();

    database
      .prepare('UPDATE workspace SET available = 0 WHERE id = ?')
      .run(workspaceId);
    expect(() =>
      repository.trustWorkspace(
        workspaceId,
        'D:\\Projects\\Lumora',
        timestamp
      )
    ).toThrow();
  });

  it('deletes trust decisions with their workspace', () => {
    repository.trustWorkspace(
      workspaceId,
      'D:\\Projects\\Lumora',
      timestamp
    );

    database.prepare('DELETE FROM workspace WHERE id = ?').run(workspaceId);

    expect(repository.listWorkspaceTrustDecisions()).toEqual([]);
  });

  it('loads current session resume identity by stable ID', () => {
    const sessionId = 'c'.repeat(64);
    database
      .prepare(
        `INSERT INTO session (
          id, provider, native_id, workspace_id, title, normalized_title,
          created_at, updated_at, lifecycle, source_freshness
        ) VALUES (?, 'codex', ?, ?, 'Resume me', 'resume me', ?, ?,
          'saved', 'current')`
      )
      .run(sessionId, 'native-thread', workspaceId, timestamp, timestamp);

    expect(repository.getSession(sessionId)).toEqual({
      id: sessionId,
      title: 'Resume me',
      nativeId: 'native-thread',
      provider: 'codex',
      workspaceId,
      sourceFreshness: 'current'
    });
    expect(repository.getSession('f'.repeat(64))).toBeNull();
  });

  it('lists only current source keys for a handoff session', () => {
    const sessionId = 'c'.repeat(64);
    database.prepare(
      `INSERT INTO session (
        id, provider, native_id, workspace_id, title, normalized_title,
        created_at, updated_at, lifecycle, source_freshness
      ) VALUES (?, 'codex', 'native-thread', ?, 'Handoff', 'handoff', ?, ?,
        'saved', 'current')`
    ).run(sessionId, workspaceId, timestamp, timestamp);
    const insert = database.prepare(
      `INSERT INTO session_source (
        provider, source_key, session_id, size, modified_at_ms,
        last_seen_scan_id, stale
      ) VALUES ('codex', ?, ?, 100, 1000, 'scan-1', ?)`
    );
    insert.run('D:\\sessions\\current.jsonl', sessionId, 0);
    insert.run('D:\\sessions\\stale.jsonl', sessionId, 1);

    expect(repository.listCurrentSessionSourceKeys(sessionId)).toEqual([
      'D:\\sessions\\current.jsonl'
    ]);
    expect(repository.listCurrentSessionSourceKeys('f'.repeat(64))).toEqual([]);
  });

  it('stores provider launch commands and clears overrides', () => {
    const configurable = repository as unknown as {
      listProviderLaunchConfigs(): unknown;
      saveProviderLaunchConfig(
        input: { provider: 'codex' | 'claude' | 'gemini'; command: string | null },
        timestamp: string
      ): unknown;
      getProviderLaunchCommand(
        provider: 'codex' | 'claude' | 'gemini'
      ): string | null;
    };

    expect(configurable.listProviderLaunchConfigs()).toHaveLength(12);
    expect(configurable.listProviderLaunchConfigs()).toContainEqual({
      provider: 'gemini',
      command: null
    });

    configurable.saveProviderLaunchConfig(
      { provider: 'gemini', command: 'gemini-preview' },
      timestamp
    );
    expect(configurable.getProviderLaunchCommand('gemini')).toBe(
      'gemini-preview'
    );

    configurable.saveProviderLaunchConfig(
      { provider: 'gemini', command: null },
      '2026-07-11T05:00:00.000Z'
    );
    expect(configurable.getProviderLaunchCommand('gemini')).toBeNull();
  });

  it('persists ordered launch setting layers and deletes empty overrides', () => {
    const profileId = 'b'.repeat(64);
    repository.reconcileDetectedProfiles([profile(profileId)], timestamp);

    repository.saveLaunchSettingsLayer(
      {
        scope: 'workspace',
        targetId: workspaceId,
        settings: {
          terminalProfileId: profileId,
          providerCommands: { codex: 'workspace-codex' }
        }
      },
      timestamp
    );
    repository.saveLaunchSettingsLayer(
      {
        scope: 'global',
        targetId: 'global',
        settings: { terminalProfileId: null }
      },
      timestamp
    );

    expect(repository.listLaunchSettingsLayers()).toEqual([
      expect.objectContaining({ scope: 'global', targetId: 'global' }),
      expect.objectContaining({ scope: 'workspace', targetId: workspaceId })
    ]);

    repository.saveLaunchSettingsLayer(
      { scope: 'workspace', targetId: workspaceId, settings: {} },
      '2026-07-11T05:00:00.000Z'
    );
    expect(repository.listLaunchSettingsLayers()).toEqual([
      expect.objectContaining({ scope: 'global', targetId: 'global' })
    ]);
  });

  it('persists keyboard settings and falls back when a stored value is invalid', () => {
    const custom: KeyboardSettings = {
      ...DEFAULT_KEYBOARD_SETTINGS,
      terminalSwitcher: {
        code: 'KeyK',
        control: true,
        alt: false,
        shift: true,
        meta: false
      }
    };

    expect(repository.getKeyboardSettings()).toEqual(DEFAULT_KEYBOARD_SETTINGS);
    expect(repository.saveKeyboardSettings(custom, timestamp)).toEqual(custom);
    expect(repository.getKeyboardSettings()).toEqual(custom);

    database.prepare(
      `UPDATE app_preference SET value_json = ?
       WHERE key = 'keyboardShortcuts.v1'`
    ).run(JSON.stringify({ version: 1, terminalSwitcher: custom.terminalSwitcher }));
    expect(repository.getKeyboardSettings()).toEqual(custom);

    database.prepare(
      `UPDATE app_preference SET value_json = ?
       WHERE key = 'keyboardShortcuts.v1'`
    ).run('{"version":2}');
    expect(repository.getKeyboardSettings()).toEqual(DEFAULT_KEYBOARD_SETTINGS);
  });

  it('persists general settings and falls back when stored data is invalid', () => {
    const hidden: GeneralSettings = {
      ...DEFAULT_GENERAL_SETTINGS,
      showInformationalNotices: false
    };

    expect(repository.getGeneralSettings()).toEqual(DEFAULT_GENERAL_SETTINGS);

    database.prepare(
      `INSERT INTO app_preference (key, value_json, updated_at)
       VALUES ('generalSettings.v1', ?, ?)`
    ).run(JSON.stringify({
      version: 1,
      showInformationalNotices: false
    }), timestamp);
    expect(repository.getGeneralSettings()).toEqual({
      ...DEFAULT_GENERAL_SETTINGS,
      showInformationalNotices: false
    });

    expect(repository.saveGeneralSettings(hidden, timestamp)).toEqual(hidden);
    expect(repository.getGeneralSettings()).toEqual(hidden);

    database.prepare(
      `UPDATE app_preference SET value_json = ?
       WHERE key = 'generalSettings.v1'`
    ).run(JSON.stringify({ version: 1, showInformationalNotices: 'no' }));
    expect(repository.getGeneralSettings()).toEqual(DEFAULT_GENERAL_SETTINGS);

    database.exec('PRAGMA ignore_check_constraints = ON');
    database.prepare(
      `UPDATE app_preference SET value_json = ?
       WHERE key = 'generalSettings.v1'`
    ).run('{broken');
    expect(repository.getGeneralSettings()).toEqual(DEFAULT_GENERAL_SETTINGS);
    database.exec('PRAGMA ignore_check_constraints = OFF');
  });

  it('validates layer targets and session provider commands', () => {
    const sessionId = 'c'.repeat(64);
    database.prepare(
      `INSERT INTO session (
        id, provider, native_id, workspace_id, title, normalized_title,
        created_at, updated_at, lifecycle, source_freshness
      ) VALUES (?, 'codex', ?, ?, 'Resume me', 'resume me', ?, ?,
        'saved', 'current')`
    ).run(sessionId, 'native-thread', workspaceId, timestamp, timestamp);

    expect(() =>
      repository.saveLaunchSettingsLayer(
        {
          scope: 'workspace',
          targetId: 'f'.repeat(64),
          settings: { terminalProfileId: null }
        },
        timestamp
      )
    ).toThrow('workspace');
    expect(() =>
      repository.saveLaunchSettingsLayer(
        {
          scope: 'session',
          targetId: sessionId,
          settings: { providerCommands: { claude: 'claude-dev' } }
        },
        timestamp
      )
    ).toThrow('provider');
  });

  it('migrates legacy provider commands into provider layers', () => {
    const legacy = new DatabaseSync(':memory:');
    try {
      legacy.exec(`CREATE TABLE schema_migration (
        version INTEGER PRIMARY KEY,
        applied_at TEXT NOT NULL
      ) STRICT`);
      for (let version = 1; version <= 5; version += 1) {
        legacy.prepare(
          'INSERT INTO schema_migration (version, applied_at) VALUES (?, ?)'
        ).run(version, timestamp);
      }
      legacy.exec(`CREATE TABLE provider_launch_config (
        provider TEXT PRIMARY KEY CHECK (provider IN ('codex', 'claude')),
        command TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT`);
      legacy.exec(`CREATE TABLE runtime_instance (
        id TEXT PRIMARY KEY,
        provider TEXT NOT NULL CHECK (provider IN ('codex', 'claude'))
      ) STRICT`);
      legacy.prepare(
        `INSERT INTO provider_launch_config
          (provider, command, updated_at) VALUES ('codex', 'codexp', ?)`
      ).run(timestamp);

      runMigrations(
        legacy,
        CATALOG_MIGRATIONS.filter(({ version }) => version === 6)
      );

      const row = legacy.prepare(
        `SELECT scope, target_id, settings_json
         FROM config_layer WHERE scope = 'provider' AND target_id = 'codex'`
      ).get() as { scope: string; target_id: string; settings_json: string };
      expect(JSON.parse(row.settings_json)).toEqual({
        providerCommands: { codex: 'codexp' }
      });
    } finally {
      legacy.close();
    }
  });

  it('persists runtime lifecycle and marks interrupted live rows lost', () => {
    const profileId = 'b'.repeat(64);
    repository.reconcileDetectedProfiles([profile(profileId)], timestamp);
    const runtime: RuntimeSummary = {
      id: '0198f8b6-18f3-7ca0-9f0f-123456789abc',
      displayName: 'Repository cleanup',
      strategy: 'new',
      sessionId: null,
      nativeSessionId: null,
      reconciliationState: 'pending',
      provider: 'codex',
      workspaceId,
      terminalProfileId: profileId,
      launchHash: 'e'.repeat(64),
      state: 'running',
      pid: 4321,
      createdAt: timestamp,
      startedAt: timestamp,
      endedAt: null,
      exitCode: null,
      errorCode: null
    };

    repository.saveRuntime(runtime);
    expect(repository.listRuntimes()).toEqual([runtime]);

    repository.markLiveRuntimesLost('2026-07-11T05:00:00.000Z');
    expect(repository.listRuntimes()).toEqual([
      {
        ...runtime,
        reconciliationState: 'unresolved',
        state: 'runtime_lost',
        pid: null,
        endedAt: '2026-07-11T05:00:00.000Z',
        errorCode: 'PTY_RUNTIME_LOST'
      }
    ]);
  });

  it('persists and reconciles a native-fork runtime as a new provider identity', () => {
    const profileId = 'b'.repeat(64);
    const runtimeId = '0198f8b6-18f3-7ca0-9f0f-123456789abf';
    const forkSessionId = 'd'.repeat(64);
    repository.reconcileDetectedProfiles([profile(profileId)], timestamp);
    repository.saveRuntime({
      id: runtimeId,
      displayName: 'Fork of Repository cleanup',
      strategy: 'fork',
      sessionId: null,
      nativeSessionId: null,
      reconciliationState: 'pending',
      provider: 'codex',
      workspaceId,
      terminalProfileId: profileId,
      launchHash: 'e'.repeat(64),
      state: 'running',
      pid: 4321,
      createdAt: timestamp,
      startedAt: timestamp,
      endedAt: null,
      exitCode: null,
      errorCode: null
    }, ['known-native']);
    database.prepare(
      `INSERT INTO session (
        id, provider, native_id, workspace_id, title, normalized_title,
        created_at, updated_at, lifecycle, source_freshness
      ) VALUES (?, 'codex', 'fork-native', ?, 'Forked work',
        'forked work', ?, ?, 'active', 'current')`
    ).run(forkSessionId, workspaceId, timestamp, timestamp);

    expect(repository.applyRuntimeReconciliation(runtimeId, {
      state: 'linked',
      sessionId: forkSessionId,
      nativeSessionId: 'fork-native'
    })).toMatchObject({
      strategy: 'fork',
      displayName: 'Forked work',
      sessionId: forkSessionId,
      nativeSessionId: 'fork-native',
      reconciliationState: 'linked'
    });
  });

  it('retains resume identity through lifecycle updates and catalog unlink', () => {
    const profileId = 'b'.repeat(64);
    const sessionId = 'c'.repeat(64);
    repository.reconcileDetectedProfiles([profile(profileId)], timestamp);
    database.prepare(
      `INSERT INTO session (
        id, provider, native_id, workspace_id, title, normalized_title,
        created_at, updated_at, lifecycle, source_freshness
      ) VALUES (?, 'codex', ?, ?, 'Resume me', 'resume me', ?, ?,
        'saved', 'current')`
    ).run(sessionId, 'native-thread', workspaceId, timestamp, timestamp);
    const runtime: RuntimeSummary = {
      id: '0198f8b6-18f3-7ca0-9f0f-123456789abd',
      displayName: 'Resume me',
      strategy: 'resume',
      sessionId,
      nativeSessionId: 'native-thread',
      reconciliationState: 'not_required',
      provider: 'codex',
      workspaceId,
      terminalProfileId: profileId,
      launchHash: 'e'.repeat(64),
      state: 'running',
      pid: 4321,
      createdAt: timestamp,
      startedAt: timestamp,
      endedAt: null,
      exitCode: null,
      errorCode: null
    };

    repository.saveRuntime(runtime);
    repository.saveRuntime({
      ...runtime,
      state: 'completed',
      pid: null,
      endedAt: '2026-07-11T05:00:00.000Z',
      exitCode: 0
    });

    expect(repository.listRuntimes()).toEqual([
      expect.objectContaining({
        strategy: 'resume',
        sessionId,
        nativeSessionId: 'native-thread',
        state: 'completed'
      })
    ]);

    database.prepare('DELETE FROM session WHERE id = ?').run(sessionId);
    expect(repository.listRuntimes()).toEqual([
      expect.objectContaining({
        strategy: 'resume',
        sessionId: null,
        nativeSessionId: 'native-thread'
      })
    ]);
  });

  it('persists a launch baseline and applies one controlled reconciliation result', () => {
    const profileId = 'b'.repeat(64);
    const knownSessionId = 'c'.repeat(64);
    const newSessionId = 'd'.repeat(64);
    const runtimeId = '0198f8b6-18f3-7ca0-9f0f-123456789abe';
    repository.reconcileDetectedProfiles([profile(profileId)], timestamp);
    const insertSession = database.prepare(
      `INSERT INTO session (
        id, provider, native_id, workspace_id, title, normalized_title,
        created_at, updated_at, lifecycle, source_freshness
      ) VALUES (?, 'codex', ?, ?, ?, ?, ?, ?, 'active', 'current')`
    );
    insertSession.run(
      knownSessionId,
      'known-native',
      workspaceId,
      'Known',
      'known',
      timestamp,
      timestamp
    );
    insertSession.run(
      newSessionId,
      'new-native',
      workspaceId,
      'New',
      'new',
      timestamp,
      timestamp
    );
    const runtime: RuntimeSummary = {
      id: runtimeId,
      displayName: 'Repository cleanup',
      strategy: 'new',
      sessionId: null,
      nativeSessionId: null,
      reconciliationState: 'pending',
      provider: 'codex',
      workspaceId,
      terminalProfileId: profileId,
      launchHash: 'e'.repeat(64),
      state: 'running',
      pid: 4321,
      createdAt: timestamp,
      startedAt: timestamp,
      endedAt: null,
      exitCode: null,
      errorCode: null
    };

    repository.saveRuntime(runtime, ['known-native', 'known-native']);

    expect(
      database
        .prepare(
          `SELECT baseline_native_ids_json
           FROM runtime_reconciliation WHERE runtime_id = ?`
        )
        .get(runtimeId)
    ).toEqual({ baseline_native_ids_json: '["known-native"]' });
    expect(repository.listCurrentSessionIdentities('codex', workspaceId)).toEqual([
      { id: knownSessionId, nativeId: 'known-native' },
      { id: newSessionId, nativeId: 'new-native' }
    ]);

    expect(
      repository.applyRuntimeReconciliation(runtimeId, {
        state: 'linked',
        sessionId: newSessionId,
        nativeSessionId: 'new-native'
      })
    ).toMatchObject({
      displayName: 'New',
      reconciliationState: 'linked',
      sessionId: newSessionId,
      nativeSessionId: 'new-native'
    });
    expect(
      repository.applyRuntimeReconciliation(runtimeId, { state: 'ambiguous' })
    ).toBeNull();

    database.prepare('DELETE FROM session WHERE id = ?').run(newSessionId);
    expect(repository.listRuntimes()[0]).toMatchObject({
      reconciliationState: 'linked',
      sessionId: null,
      nativeSessionId: 'new-native'
    });
  });

  it('synchronizes linked runtime titles from the current catalog', () => {
    const profileId = 'b'.repeat(64);
    const resumeSessionId = 'c'.repeat(64);
    const newSessionId = 'd'.repeat(64);
    repository.reconcileDetectedProfiles([profile(profileId)], timestamp);
    const insertSession = database.prepare(
      `INSERT INTO session (
        id, provider, native_id, workspace_id, title, normalized_title,
        created_at, updated_at, lifecycle, source_freshness
      ) VALUES (?, 'codex', ?, ?, ?, ?, ?, ?, 'active', 'current')`
    );
    insertSession.run(
      resumeSessionId,
      'resume-native',
      workspaceId,
      'Old resume title',
      'old resume title',
      timestamp,
      timestamp
    );
    insertSession.run(
      newSessionId,
      'new-native',
      workspaceId,
      'Old new title',
      'old new title',
      timestamp,
      timestamp
    );
    const baseRuntime = {
      provider: 'codex' as const,
      workspaceId,
      terminalProfileId: profileId,
      launchHash: 'e'.repeat(64),
      state: 'running' as const,
      pid: 4321,
      createdAt: timestamp,
      startedAt: timestamp,
      endedAt: null,
      exitCode: null,
      errorCode: null
    };
    repository.saveRuntime({
      ...baseRuntime,
      id: '0198f8b6-18f3-7ca0-9f0f-123456789ab1',
      displayName: 'Old resume title',
      strategy: 'resume',
      sessionId: resumeSessionId,
      nativeSessionId: 'resume-native',
      reconciliationState: 'not_required'
    });
    repository.saveRuntime({
      ...baseRuntime,
      id: '0198f8b6-18f3-7ca0-9f0f-123456789ab2',
      displayName: 'Old new title',
      strategy: 'new',
      sessionId: newSessionId,
      nativeSessionId: 'new-native',
      reconciliationState: 'linked'
    });
    database
      .prepare(
        `UPDATE session SET title = ?, normalized_title = ? WHERE id = ?`
      )
      .run('Renamed resume', 'renamed resume', resumeSessionId);
    database
      .prepare(
        `UPDATE session SET title = ?, normalized_title = ? WHERE id = ?`
      )
      .run('Renamed new', 'renamed new', newSessionId);

    expect(repository.synchronizeRuntimeSessions()).toEqual([
      expect.objectContaining({
        id: '0198f8b6-18f3-7ca0-9f0f-123456789ab1',
        displayName: 'Renamed resume'
      }),
      expect.objectContaining({
        id: '0198f8b6-18f3-7ca0-9f0f-123456789ab2',
        displayName: 'Renamed new'
      })
    ]);
  });

  it('links one later-discovered session to an unresolved live runtime', () => {
    const profileId = 'b'.repeat(64);
    const sessionId = 'c'.repeat(64);
    const runtimeId = '0198f8b6-18f3-7ca0-9f0f-123456789ab3';
    repository.reconcileDetectedProfiles([profile(profileId)], timestamp);
    repository.saveRuntime(
      {
        id: runtimeId,
        displayName: 'New Codex session',
        strategy: 'new',
        sessionId: null,
        nativeSessionId: null,
        reconciliationState: 'pending',
        provider: 'codex',
        workspaceId,
        terminalProfileId: profileId,
        launchHash: 'e'.repeat(64),
        state: 'running',
        pid: 4321,
        createdAt: timestamp,
        startedAt: timestamp,
        endedAt: null,
        exitCode: null,
        errorCode: null
      },
      ['known-native']
    );
    repository.applyRuntimeReconciliation(runtimeId, { state: 'unresolved' });
    database
      .prepare(
        `INSERT INTO session (
          id, provider, native_id, workspace_id, title, normalized_title,
          created_at, updated_at, lifecycle, source_freshness
        ) VALUES (?, 'codex', 'later-native', ?, 'Renamed after launch',
          'renamed after launch', ?, ?, 'active', 'current')`
      )
      .run(sessionId, workspaceId, timestamp, timestamp);

    expect(repository.synchronizeRuntimeSessions()).toEqual([
      expect.objectContaining({
        id: runtimeId,
        displayName: 'Renamed after launch',
        reconciliationState: 'linked',
        sessionId,
        nativeSessionId: 'later-native'
      })
    ]);
  });

  it('keeps concurrent indistinguishable new sessions unlinked', () => {
    const profileId = 'b'.repeat(64);
    repository.reconcileDetectedProfiles([profile(profileId)], timestamp);
    const runtime = (
      id: string
    ): RuntimeSummary => ({
      id,
      displayName: 'New Codex session',
      strategy: 'new',
      sessionId: null,
      nativeSessionId: null,
      reconciliationState: 'pending',
      provider: 'codex',
      workspaceId,
      terminalProfileId: profileId,
      launchHash: 'e'.repeat(64),
      state: 'running',
      pid: 4321,
      createdAt: timestamp,
      startedAt: timestamp,
      endedAt: null,
      exitCode: null,
      errorCode: null
    });
    const firstRuntimeId = '0198f8b6-18f3-7ca0-9f0f-123456789ab4';
    const secondRuntimeId = '0198f8b6-18f3-7ca0-9f0f-123456789ab5';
    repository.saveRuntime(runtime(firstRuntimeId), []);
    repository.saveRuntime(runtime(secondRuntimeId), []);
    repository.applyRuntimeReconciliation(firstRuntimeId, { state: 'unresolved' });
    repository.applyRuntimeReconciliation(secondRuntimeId, { state: 'unresolved' });
    const insertSession = database.prepare(
      `INSERT INTO session (
        id, provider, native_id, workspace_id, title, normalized_title,
        created_at, updated_at, lifecycle, source_freshness
      ) VALUES (?, 'codex', ?, ?, ?, ?, ?, ?, 'active', 'current')`
    );
    insertSession.run(
      'c'.repeat(64),
      'native-a',
      workspaceId,
      'Session A',
      'session a',
      timestamp,
      timestamp
    );
    insertSession.run(
      'd'.repeat(64),
      'native-b',
      workspaceId,
      'Session B',
      'session b',
      timestamp,
      timestamp
    );

    repository.synchronizeRuntimeSessions();

    expect(repository.listRuntimes()).toEqual([
      expect.objectContaining({
        id: firstRuntimeId,
        reconciliationState: 'ambiguous',
        sessionId: null
      }),
      expect.objectContaining({
        id: secondRuntimeId,
        reconciliationState: 'ambiguous',
        sessionId: null
      })
    ]);
  });

  it('does not link one catalog session to two runtimes', () => {
    const profileId = 'b'.repeat(64);
    const sessionId = 'c'.repeat(64);
    repository.reconcileDetectedProfiles([profile(profileId)], timestamp);
    database
      .prepare(
        `INSERT INTO session (
          id, provider, native_id, workspace_id, title, normalized_title,
          created_at, updated_at, lifecycle, source_freshness
        ) VALUES (?, 'codex', 'shared-native', ?, 'Shared', 'shared', ?, ?,
          'active', 'current')`
      )
      .run(sessionId, workspaceId, timestamp, timestamp);
    const runtime = (
      id: string
    ): RuntimeSummary => ({
      id,
      displayName: 'New Codex session',
      strategy: 'new',
      sessionId: null,
      nativeSessionId: null,
      reconciliationState: 'pending',
      provider: 'codex',
      workspaceId,
      terminalProfileId: profileId,
      launchHash: 'e'.repeat(64),
      state: 'running',
      pid: 4321,
      createdAt: timestamp,
      startedAt: timestamp,
      endedAt: null,
      exitCode: null,
      errorCode: null
    });
    const firstRuntimeId = '0198f8b6-18f3-7ca0-9f0f-123456789ab6';
    const secondRuntimeId = '0198f8b6-18f3-7ca0-9f0f-123456789ab7';
    repository.saveRuntime(runtime(firstRuntimeId), []);
    repository.saveRuntime(runtime(secondRuntimeId), []);

    expect(
      repository.applyRuntimeReconciliation(firstRuntimeId, {
        state: 'linked',
        sessionId,
        nativeSessionId: 'shared-native'
      })
    ).not.toBeNull();
    expect(
      repository.applyRuntimeReconciliation(secondRuntimeId, {
        state: 'linked',
        sessionId,
        nativeSessionId: 'shared-native'
      })
    ).toBeNull();
  });
});
