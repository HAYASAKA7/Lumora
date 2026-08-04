import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';

import { migrateCatalogDatabase } from './migrations';
import { ExecutionTargetRepository } from './execution-target-repository';

describe('ExecutionTargetRepository', () => {
  let database: DatabaseSync | null = null;

  afterEach(() => {
    database?.close();
    database = null;
  });

  it('hydrates the permanent local target with current platform facts', () => {
    database = new DatabaseSync(':memory:');
    migrateCatalogDatabase(database);
    const repository = new ExecutionTargetRepository(database);

    expect(repository.ensureLocalTarget({
      platform: 'win32',
      architecture: 'x64'
    })).toEqual({
      id: 'local',
      kind: 'local',
      displayName: 'This computer',
      platform: 'win32',
      architecture: 'x64',
      connectionState: 'local',
      helperVersion: null,
      protocolVersion: null,
      capabilities: ['provider-scan', 'session-scan', 'pty'],
      lastConnectedAt: null,
      lastScannedAt: null
    });
    expect(repository.list()).toEqual([repository.get('local')]);
  });

  it('does not allow the permanent local target to be deleted', () => {
    database = new DatabaseSync(':memory:');
    migrateCatalogDatabase(database);

    expect(() => database!.prepare(
      "DELETE FROM execution_target WHERE id = 'local'"
    ).run()).toThrow('permanent');
  });
});

