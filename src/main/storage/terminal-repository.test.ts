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

  it('persists runtime lifecycle and marks interrupted live rows lost', () => {
    const profileId = 'b'.repeat(64);
    repository.reconcileDetectedProfiles([profile(profileId)], timestamp);
    const runtime: RuntimeSummary = {
      id: '0198f8b6-18f3-7ca0-9f0f-123456789abc',
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
        state: 'runtime_lost',
        pid: null,
        endedAt: '2026-07-11T05:00:00.000Z',
        errorCode: 'PTY_RUNTIME_LOST'
      }
    ]);
  });
});
