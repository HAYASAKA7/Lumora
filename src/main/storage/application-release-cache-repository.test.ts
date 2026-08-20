import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';

import { migrateCatalogDatabase } from './migrations';
import { ApplicationReleaseCacheRepository } from './application-release-cache-repository';

describe('ApplicationReleaseCacheRepository', () => {
  const databases: DatabaseSync[] = [];
  afterEach(() => databases.splice(0).forEach((database) => database.close()));

  function makeRepository() {
    const database = new DatabaseSync(':memory:');
    databases.push(database);
    migrateCatalogDatabase(database);
    return { database, repository: new ApplicationReleaseCacheRepository(database) };
  }

  it('round-trips the validated global cache', () => {
    const { repository } = makeRepository();
    expect(repository.get()).toBeNull();
    const value = {
      checkedAt: '2026-08-20T00:00:00.000Z',
      release: {
        version: '0.3.6',
        publishedAt: '2026-08-19T00:00:00.000Z',
        summary: 'Safer release.',
        url: 'https://github.com/HAYASAKA7/Lumora/releases/tag/v0.3.6'
      }
    };
    repository.set(value);
    expect(repository.get()).toEqual(value);
  });

  it('ignores corrupt stored data', () => {
    const { database, repository } = makeRepository();
    database.prepare(
      'INSERT INTO app_preference (key, value_json, updated_at) VALUES (?, ?, ?)'
    ).run('applicationReleaseCheck.v1', '{}', new Date().toISOString());
    expect(repository.get()).toBeNull();
  });
});
