import type { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';

import {
  ApplicationReleaseMetadataSchema,
  type ApplicationReleaseMetadata
} from '../../shared/contracts';

const CACHE_KEY = 'applicationReleaseCheck.v1';
const StoredCacheSchema = z.strictObject({
  version: z.literal(1),
  checkedAt: z.iso.datetime(),
  release: ApplicationReleaseMetadataSchema
});

export interface ApplicationReleaseCacheValue {
  checkedAt: string;
  release: ApplicationReleaseMetadata;
}

export class ApplicationReleaseCacheRepository {
  constructor(private readonly database: DatabaseSync) {}

  get(): ApplicationReleaseCacheValue | null {
    const row = this.database.prepare(
      'SELECT value_json FROM app_preference WHERE key = ?'
    ).get(CACHE_KEY) as { value_json: string } | undefined;
    if (row === undefined) return null;
    try {
      const parsed = StoredCacheSchema.parse(JSON.parse(row.value_json));
      return { checkedAt: parsed.checkedAt, release: parsed.release };
    } catch {
      return null;
    }
  }

  set(value: ApplicationReleaseCacheValue): void {
    const stored = StoredCacheSchema.parse({ version: 1, ...value });
    this.database.prepare(
      `INSERT INTO app_preference (key, value_json, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET
         value_json = excluded.value_json,
         updated_at = excluded.updated_at`
    ).run(CACHE_KEY, JSON.stringify(stored), value.checkedAt);
  }
}
