import { DatabaseSync } from 'node:sqlite';

import { afterEach, describe, expect, it } from 'vitest';

import { migrateCatalogDatabase } from './migrations';
import { StructuredProviderPreferenceRepository } from './structured-provider-preference-repository';

const databases: DatabaseSync[] = [];

function repository() {
  const database = new DatabaseSync(':memory:');
  databases.push(database);
  migrateCatalogDatabase(database);
  return new StructuredProviderPreferenceRepository(database, 'local');
}

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

describe('StructuredProviderPreferenceRepository', () => {
  it('defaults all supported providers to automatic unified routing', () => {
    expect(repository().list()).toEqual([
      { providerId: 'codex', useUnifiedWhenAvailable: true, executablePathOverride: null },
      { providerId: 'claude', useUnifiedWhenAvailable: true, executablePathOverride: null },
      { providerId: 'gemini', useUnifiedWhenAvailable: true, executablePathOverride: null }
    ]);
  });

  it('saves one provider without changing the others', () => {
    const current = repository();
    current.save({
      providerId: 'claude',
      useUnifiedWhenAvailable: false,
      executablePathOverride: '/opt/claude'
    }, '2026-08-27T00:00:00.000Z');
    expect(current.get('claude')).toEqual({
      providerId: 'claude',
      useUnifiedWhenAvailable: false,
      executablePathOverride: '/opt/claude'
    });
    expect(current.get('codex').useUnifiedWhenAvailable).toBe(true);
  });
});
