import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { migrateCatalogDatabase } from '../storage/migrations';
import { TransferRepository } from './transfer-repository';

function historyEntry(index: number) {
  return {
    id: randomUUID(),
    direction: index % 2 === 0 ? ('export' as const) : ('import' as const),
    completedAt: new Date(Date.UTC(2026, 6, 29, 0, index)).toISOString(),
    importedCount: index % 2,
    exportedCount: (index + 1) % 2,
    skippedCount: 0,
    providers: ['opencode' as const]
  };
}

describe('TransferRepository', () => {
  let database: DatabaseSync;
  let repository: TransferRepository;

  beforeEach(() => {
    database = new DatabaseSync(':memory:');
    migrateCatalogDatabase(database);
    repository = new TransferRepository(database);
  });

  afterEach(() => {
    database.close();
  });

  it('remembers directories and trims history without storing paths', () => {
    repository.saveLastDirectory(
      'export',
      'D:\\Transfers',
      '2026-07-29T00:00:00.000Z'
    );
    for (let index = 0; index < 30; index += 1) {
      repository.recordHistory(historyEntry(index));
    }

    expect(repository.getLastDirectory('export')).toBe('D:\\Transfers');
    expect(repository.getLastDirectory('import')).toBeNull();
    expect(repository.listHistory()).toHaveLength(25);
    expect(repository.listHistory()[0]?.completedAt).toBe(
      historyEntry(29).completedAt
    );
    expect(JSON.stringify(repository.listHistory())).not.toContain('Transfers');
  });

  it('falls back safely when stored preference JSON is invalid', () => {
    database
      .prepare(
        `INSERT INTO app_preference (key, value_json, updated_at)
         VALUES (?, ?, ?)`
      )
      .run(
        'sessionTransferDirectories.v1',
        JSON.stringify('not-an-object'),
        '2026-07-29T00:00:00.000Z'
      );
    database
      .prepare(
        `INSERT INTO app_preference (key, value_json, updated_at)
         VALUES (?, ?, ?)`
      )
      .run(
        'sessionTransferHistory.v1',
        JSON.stringify([{ archivePath: 'D:\\secret' }]),
        '2026-07-29T00:00:00.000Z'
      );

    expect(repository.getLastDirectory('export')).toBeNull();
    expect(repository.listHistory()).toEqual([]);
  });

  it('validates directory timestamps and history entries before writing', () => {
    expect(() => repository.saveLastDirectory('export', '', 'bad-time')).toThrow();
    expect(() =>
      repository.recordHistory({
        ...historyEntry(0),
        providers: [],
        archivePath: 'D:\\secret'
      } as never)
    ).toThrow();
  });
});
