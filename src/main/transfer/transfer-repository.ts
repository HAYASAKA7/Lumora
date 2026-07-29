import type { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';

import {
  TransferHistoryEntrySchema,
  TransferHistoryListSchema,
  type TransferHistoryEntry
} from '../../shared/session-transfer';

const DIRECTORY_KEY = 'sessionTransferDirectories.v1';
const HISTORY_KEY = 'sessionTransferHistory.v1';
const MAX_HISTORY = 25;

const StoredDirectorySchema = z.strictObject({
  path: z.string().min(1).max(32_768),
  updatedAt: z.iso.datetime()
});

const StoredDirectoriesSchema = z.strictObject({
  version: z.literal(1),
  export: StoredDirectorySchema.nullable(),
  import: StoredDirectorySchema.nullable()
});

type TransferDirection = 'export' | 'import';

const EMPTY_DIRECTORIES = Object.freeze({
  version: 1 as const,
  export: null,
  import: null
});

export class TransferRepository {
  constructor(private readonly database: DatabaseSync) {}

  private readJson(key: string): unknown {
    const row = this.database
      .prepare('SELECT value_json FROM app_preference WHERE key = ?')
      .get(key) as { value_json: string } | undefined;
    if (row === undefined) return undefined;
    try {
      return JSON.parse(row.value_json) as unknown;
    } catch {
      return undefined;
    }
  }

  private writeJson(key: string, value: unknown, timestamp: string): void {
    const normalizedTimestamp = z.iso.datetime().parse(timestamp);
    this.database
      .prepare(
        `INSERT INTO app_preference (key, value_json, updated_at)
         VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET
           value_json = excluded.value_json,
           updated_at = excluded.updated_at`
      )
      .run(key, JSON.stringify(value), normalizedTimestamp);
  }

  private readDirectories(): z.infer<typeof StoredDirectoriesSchema> {
    const parsed = StoredDirectoriesSchema.safeParse(this.readJson(DIRECTORY_KEY));
    return parsed.success ? parsed.data : { ...EMPTY_DIRECTORIES };
  }

  getLastDirectory(direction: TransferDirection): string | null {
    return this.readDirectories()[direction]?.path ?? null;
  }

  saveLastDirectory(
    direction: TransferDirection,
    path: string,
    timestamp: string
  ): string {
    const directory = StoredDirectorySchema.parse({ path, updatedAt: timestamp });
    const directories = this.readDirectories();
    const next = StoredDirectoriesSchema.parse({
      ...directories,
      [direction]: directory
    });
    this.writeJson(DIRECTORY_KEY, next, directory.updatedAt);
    return directory.path;
  }

  listHistory(): TransferHistoryEntry[] {
    const parsed = TransferHistoryListSchema.safeParse(this.readJson(HISTORY_KEY));
    return parsed.success ? parsed.data : [];
  }

  recordHistory(value: TransferHistoryEntry): TransferHistoryEntry[] {
    const entry = TransferHistoryEntrySchema.parse(value);
    const history = [
      entry,
      ...this.listHistory().filter((existing) => existing.id !== entry.id)
    ].slice(0, MAX_HISTORY);
    const parsed = TransferHistoryListSchema.parse(history);
    this.writeJson(HISTORY_KEY, parsed, entry.completedAt);
    return parsed;
  }
}
