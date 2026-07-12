import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { RuntimeSummary, TerminalProfile } from '../../shared/contracts';
import { migrateCatalogDatabase } from './migrations';
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
      nativeId: 'native-thread',
      provider: 'codex',
      workspaceId,
      sourceFreshness: 'current'
    });
    expect(repository.getSession('f'.repeat(64))).toBeNull();
  });

  it('stores provider launch commands and clears overrides', () => {
    const configurable = repository as unknown as {
      listProviderLaunchConfigs(): unknown;
      saveProviderLaunchConfig(
        input: { provider: 'codex' | 'claude'; command: string | null },
        timestamp: string
      ): unknown;
      getProviderLaunchCommand(provider: 'codex' | 'claude'): string | null;
    };

    expect(configurable.listProviderLaunchConfigs()).toEqual([
      { provider: 'codex', command: null },
      { provider: 'claude', command: null }
    ]);

    expect(
      configurable.saveProviderLaunchConfig(
        { provider: 'codex', command: 'codexp' },
        timestamp
      )
    ).toEqual([
      { provider: 'codex', command: 'codexp' },
      { provider: 'claude', command: null }
    ]);
    expect(configurable.getProviderLaunchCommand('codex')).toBe('codexp');

    configurable.saveProviderLaunchConfig(
      { provider: 'codex', command: null },
      '2026-07-11T05:00:00.000Z'
    );
    expect(configurable.getProviderLaunchCommand('codex')).toBeNull();
  });

  it('persists runtime lifecycle and marks interrupted live rows lost', () => {
    const profileId = 'b'.repeat(64);
    repository.reconcileDetectedProfiles([profile(profileId)], timestamp);
    const runtime: RuntimeSummary = {
      id: '0198f8b6-18f3-7ca0-9f0f-123456789abc',
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
});
