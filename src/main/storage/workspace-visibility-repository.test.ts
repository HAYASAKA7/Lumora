import { DatabaseSync } from 'node:sqlite';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { CanonicalWorkspacePath } from '../platform/workspace-path';
import { CatalogRepository } from './catalog-repository';
import { migrateCatalogDatabase } from './migrations';
import { WorkspaceVisibilityRepository } from './workspace-visibility-repository';

const REMOTE_TARGET_ID = '4f632901-1f8d-44c0-8418-aa823f791ca0';
const LOCAL_WORKSPACE_ID = 'a'.repeat(64);
const REMOTE_WORKSPACE_ID = 'b'.repeat(64);

function workspace(id: string, path: string): CanonicalWorkspacePath {
  return {
    id,
    canonicalPath: path,
    identityKey: path,
    displayName: path.split('/').at(-1) ?? path,
    available: true
  };
}

describe('WorkspaceVisibilityRepository', () => {
  let database: DatabaseSync;

  beforeEach(() => {
    database = new DatabaseSync(':memory:');
    migrateCatalogDatabase(database);
    database.prepare(
      `INSERT INTO execution_target (
        id, kind, display_name, platform, architecture, connection_state,
        helper_version, protocol_version, capabilities_json,
        last_connected_at, last_scanned_at
      ) VALUES (?, 'remote', 'Build server', 'linux', 'x64', 'offline',
        NULL, NULL, '[]', NULL, NULL)`
    ).run(REMOTE_TARGET_ID);
    new CatalogRepository(database).registerWorkspace(
      workspace(LOCAL_WORKSPACE_ID, '/work/local'),
      'manual',
      '2026-08-12T01:00:00.000Z'
    );
    new CatalogRepository(database, REMOTE_TARGET_ID).registerWorkspace(
      workspace(REMOTE_WORKSPACE_ID, '/work/remote'),
      'discovered',
      '2026-08-12T01:00:00.000Z'
    );
  });

  afterEach(() => database.close());

  it('keeps policies isolated by execution target and orders latest first', () => {
    const local = new WorkspaceVisibilityRepository(database);
    const remote = new WorkspaceVisibilityRepository(database, REMOTE_TARGET_ID);

    local.set(
      { workspaceId: LOCAL_WORKSPACE_ID, mode: 'workspace_only' },
      '2026-08-12T01:00:00.000Z'
    );
    remote.set(
      { workspaceId: REMOTE_WORKSPACE_ID, mode: 'workspace_and_sessions' },
      '2026-08-12T02:00:00.000Z'
    );

    expect(local.list()).toEqual([{
      workspaceId: LOCAL_WORKSPACE_ID,
      mode: 'workspace_only',
      updatedAt: '2026-08-12T01:00:00.000Z'
    }]);
    expect(remote.list()).toEqual([{
      workspaceId: REMOTE_WORKSPACE_ID,
      mode: 'workspace_and_sessions',
      updatedAt: '2026-08-12T02:00:00.000Z'
    }]);
  });

  it('updates a policy idempotently and restores selected policies', () => {
    const repository = new WorkspaceVisibilityRepository(database);
    repository.set(
      { workspaceId: LOCAL_WORKSPACE_ID, mode: 'workspace_only' },
      '2026-08-12T01:00:00.000Z'
    );
    repository.set(
      { workspaceId: LOCAL_WORKSPACE_ID, mode: 'workspace_and_sessions' },
      '2026-08-12T03:00:00.000Z'
    );

    expect(repository.list()).toEqual([{
      workspaceId: LOCAL_WORKSPACE_ID,
      mode: 'workspace_and_sessions',
      updatedAt: '2026-08-12T03:00:00.000Z'
    }]);
    expect(repository.restore([LOCAL_WORKSPACE_ID])).toEqual([]);
    expect(repository.restore([LOCAL_WORKSPACE_ID])).toEqual([]);
  });

  it('restores all policies only for its execution target', () => {
    const local = new WorkspaceVisibilityRepository(database);
    const remote = new WorkspaceVisibilityRepository(database, REMOTE_TARGET_ID);
    local.set(
      { workspaceId: LOCAL_WORKSPACE_ID, mode: 'workspace_only' },
      '2026-08-12T01:00:00.000Z'
    );
    remote.set(
      { workspaceId: REMOTE_WORKSPACE_ID, mode: 'workspace_only' },
      '2026-08-12T01:00:00.000Z'
    );

    expect(local.restoreAll()).toEqual([]);
    expect(remote.list()).toHaveLength(1);
  });

  it('rejects missing and cross-target workspaces', () => {
    const local = new WorkspaceVisibilityRepository(database);

    expect(() => local.set(
      { workspaceId: REMOTE_WORKSPACE_ID, mode: 'workspace_only' },
      '2026-08-12T01:00:00.000Z'
    )).toThrow();
    expect(() => local.set(
      { workspaceId: 'c'.repeat(64), mode: 'workspace_only' },
      '2026-08-12T01:00:00.000Z'
    )).toThrow();
  });
});
