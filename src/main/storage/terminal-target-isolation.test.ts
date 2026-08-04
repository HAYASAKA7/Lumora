import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  DEFAULT_GENERAL_SETTINGS,
  type RuntimeSummary,
  type TerminalProfile
} from '../../shared/contracts';
import { migrateCatalogDatabase } from './migrations';
import { TerminalRepository } from './terminal-repository';

const timestamp = '2026-08-04T10:00:00.000Z';
const localWorkspaceId = 'a'.repeat(64);
const remoteWorkspaceId = 'b'.repeat(64);

function insertTarget(database: DatabaseSync): void {
  database.prepare(
    `INSERT INTO execution_target (
      id, kind, display_name, platform, architecture, connection_state,
      helper_version, protocol_version, capabilities_json,
      last_connected_at, last_scanned_at
    ) VALUES (
      '0198f8b6-18f3-7ca0-9f0f-123456789a00', 'remote', 'Remote test', 'linux', 'x64', 'ready',
      '0.1.0', 1, '["provider-scan","session-scan","pty"]', ?, ?
    )`
  ).run(timestamp, timestamp);
}

function insertWorkspace(
  database: DatabaseSync,
  executionTargetId: string,
  id: string
): void {
  database.prepare(
    `INSERT INTO workspace (
      execution_target_id, id, identity_key, canonical_path, display_name,
      available, origin, created_at, updated_at
    ) VALUES (?, ?, ?, '/srv/lumora', 'Lumora', 1, 'manual', ?, ?)`
  ).run(executionTargetId, id, `${executionTargetId}-workspace`, timestamp, timestamp);
}

function profile(id: string, name: string): TerminalProfile {
  return {
    id,
    kind: 'custom',
    name,
    shellFamily: 'bash',
    executablePath: '/bin/bash',
    args: [],
    available: true,
    recommended: false
  };
}

function runtime(
  id: string,
  workspaceId: string,
  profileId: string
): RuntimeSummary {
  return {
    id,
    displayName: id,
    strategy: 'new',
    sessionId: null,
    nativeSessionId: null,
    reconciliationState: 'pending',
    provider: 'codex',
    workspaceId,
    terminalProfileId: profileId,
    launchHash: 'f'.repeat(64),
    state: 'running',
    pid: 1234,
    createdAt: timestamp,
    startedAt: timestamp,
    endedAt: null,
    exitCode: null,
    errorCode: null
  };
}

describe('TerminalRepository execution-target isolation', () => {
  let database: DatabaseSync;
  let local: TerminalRepository;
  let remote: TerminalRepository;

  beforeEach(() => {
    database = new DatabaseSync(':memory:');
    migrateCatalogDatabase(database);
    insertTarget(database);
    insertWorkspace(database, 'local', localWorkspaceId);
    insertWorkspace(database, '0198f8b6-18f3-7ca0-9f0f-123456789a00', remoteWorkspaceId);
    local = new TerminalRepository(database, 'local');
    remote = new TerminalRepository(database, '0198f8b6-18f3-7ca0-9f0f-123456789a00');
  });

  afterEach(() => database.close());

  it('isolates profiles, provider commands, launch layers, and trust decisions', () => {
    const localProfileId = 'c'.repeat(64);
    const remoteProfileId = 'd'.repeat(64);
    local.saveCustomProfile(profile(localProfileId, 'Local shell'), timestamp);
    remote.saveCustomProfile(profile(remoteProfileId, 'Remote shell'), timestamp);
    local.saveProviderLaunchConfig({ provider: 'codex', command: 'codex-local' }, timestamp);
    remote.saveProviderLaunchConfig({ provider: 'codex', command: 'codex-remote' }, timestamp);
    local.trustWorkspace(localWorkspaceId, '/srv/lumora', timestamp);
    remote.trustWorkspace(remoteWorkspaceId, '/srv/lumora', timestamp);

    expect(local.listProfiles()).toEqual([profile(localProfileId, 'Local shell')]);
    expect(remote.listProfiles()).toEqual([profile(remoteProfileId, 'Remote shell')]);
    expect(local.getProviderLaunchCommand('codex')).toBe('codex-local');
    expect(remote.getProviderLaunchCommand('codex')).toBe('codex-remote');
    expect(local.listWorkspaceTrustDecisions()).toHaveLength(1);
    expect(remote.listWorkspaceTrustDecisions()).toHaveLength(1);
    expect(local.getWorkspace(remoteWorkspaceId)).toBeNull();
    expect(remote.getWorkspace(localWorkspaceId)).toBeNull();
  });

  it('allows the same detected profile identity on separate targets', () => {
    const sharedProfileId = '9'.repeat(64);
    local.saveCustomProfile(profile(sharedProfileId, 'Local bash'), timestamp);
    remote.saveCustomProfile(profile(sharedProfileId, 'Remote bash'), timestamp);

    expect(local.getProfile(sharedProfileId)?.name).toBe('Local bash');
    expect(remote.getProfile(sharedProfileId)?.name).toBe('Remote bash');
  });

  it('isolates runtime lifecycle updates and reconciliation state', () => {
    const localProfileId = 'e'.repeat(64);
    const remoteProfileId = 'f'.repeat(64);
    local.saveCustomProfile(profile(localProfileId, 'Local shell'), timestamp);
    remote.saveCustomProfile(profile(remoteProfileId, 'Remote shell'), timestamp);
    const localRuntime = runtime('0198f8b6-18f3-7ca0-9f0f-123456789a01', localWorkspaceId, localProfileId);
    const remoteRuntime = runtime('0198f8b6-18f3-7ca0-9f0f-123456789a02', remoteWorkspaceId, remoteProfileId);
    local.saveRuntime(localRuntime, []);
    remote.saveRuntime(remoteRuntime, []);

    local.markLiveRuntimesLost('2026-08-04T11:00:00.000Z');

    expect(local.listRuntimes()[0]).toMatchObject({ state: 'runtime_lost' });
    expect(remote.listRuntimes()).toEqual([remoteRuntime]);
  });

  it('shares presentation settings while isolating provider policy settings', () => {
    local.saveGeneralSettings({
      ...DEFAULT_GENERAL_SETTINGS,
      showInformationalNotices: false,
      checkProviderUpdatesAutomatically: false,
      enabledProviders: ['codex']
    }, timestamp);

    expect(remote.getGeneralSettings()).toEqual({
      ...DEFAULT_GENERAL_SETTINGS,
      showInformationalNotices: false
    });

    remote.saveGeneralSettings({
      ...remote.getGeneralSettings(),
      startMaximized: false,
      crossAgentWorkflowEnabled: true,
      crossAgentHandoffRetentionDays: 7,
      enabledProviders: ['claude']
    }, '2026-08-04T11:00:00.000Z');

    expect(local.getGeneralSettings()).toMatchObject({
      showInformationalNotices: false,
      startMaximized: false,
      checkProviderUpdatesAutomatically: false,
      crossAgentWorkflowEnabled: false,
      crossAgentHandoffRetentionDays: 30,
      enabledProviders: ['codex']
    });
    expect(remote.getGeneralSettings()).toMatchObject({
      showInformationalNotices: false,
      startMaximized: false,
      checkProviderUpdatesAutomatically: true,
      crossAgentWorkflowEnabled: true,
      crossAgentHandoffRetentionDays: 7,
      enabledProviders: ['claude']
    });
  });
});
