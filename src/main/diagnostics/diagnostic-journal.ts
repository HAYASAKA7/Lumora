import { randomUUID } from 'node:crypto';
import {
  appendFile,
  mkdir,
  open,
  readFile,
  rename,
  rm,
  stat,
  writeFile
} from 'node:fs/promises';
import { join } from 'node:path';

import {
  DiagnosticEventSchema,
  type DiagnosticEvent
} from '../../shared/diagnostics';

const DEFAULT_MAX_FILE_BYTES = 1024 * 1024;
const DEFAULT_ROTATED_FILES = 2;
const MAX_EVENT_BYTES = 8 * 1024;

interface DiagnosticJournalOptions {
  directory: string;
  maxFileBytes?: number;
  rotatedFiles?: number;
  clock?: () => Date;
  createId?: () => string;
}

interface DiagnosticJournalReadResult {
  events: DiagnosticEvent[];
  storedEvents: number;
  invalidRecords: number;
}

interface DiagnosticRunState {
  runId: string;
  previousRunAbnormal: boolean;
}

interface RunMarker {
  schemaVersion: 1;
  runId: string;
  startedAt: string;
}

function missing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === 'ENOENT';
}

export class DiagnosticJournal {
  private readonly activePath: string;
  private readonly markerPath: string;
  private readonly maxFileBytes: number;
  private readonly rotatedFiles: number;
  private readonly clock: () => Date;
  private readonly createId: () => string;
  private pending: Promise<void> = Promise.resolve();
  private runState: DiagnosticRunState | null = null;

  constructor(private readonly options: DiagnosticJournalOptions) {
    this.maxFileBytes = Math.max(256, Math.trunc(
      options.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES
    ));
    this.rotatedFiles = Math.max(0, Math.min(
      8,
      Math.trunc(options.rotatedFiles ?? DEFAULT_ROTATED_FILES)
    ));
    this.clock = options.clock ?? (() => new Date());
    this.createId = options.createId ?? randomUUID;
    this.activePath = join(options.directory, 'events.ndjson');
    this.markerPath = join(options.directory, 'active-run.json');
  }

  record(value: DiagnosticEvent): Promise<void> {
    const event = DiagnosticEventSchema.parse(value);
    const line = `${JSON.stringify(event)}\n`;
    if (Buffer.byteLength(line, 'utf8') > MAX_EVENT_BYTES) {
      throw new RangeError('Diagnostic event exceeds its storage bound.');
    }
    return this.enqueue(async () => {
      await mkdir(this.options.directory, { recursive: true });
      let currentBytes = 0;
      try {
        currentBytes = (await stat(this.activePath)).size;
      } catch (error) {
        if (!missing(error)) throw error;
      }
      if (
        currentBytes > 0 &&
        currentBytes + Buffer.byteLength(line, 'utf8') > this.maxFileBytes
      ) {
        await this.rotate();
      }
      await appendFile(this.activePath, line, { encoding: 'utf8', mode: 0o600 });
    });
  }

  async readRecent(limit = 100): Promise<DiagnosticJournalReadResult> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      throw new RangeError('Diagnostic read limit must be between 1 and 100.');
    }
    await this.pending;
    const events: DiagnosticEvent[] = [];
    let invalidRecords = 0;
    for (const path of this.pathsOldestFirst()) {
      const content = await this.readBounded(path);
      if (content === null) continue;
      invalidRecords += content.truncated ? 1 : 0;
      for (const line of content.value.split(/\r?\n/)) {
        if (line.trim() === '') continue;
        if (Buffer.byteLength(line, 'utf8') > MAX_EVENT_BYTES) {
          invalidRecords += 1;
          continue;
        }
        let value: unknown;
        try {
          value = JSON.parse(line);
        } catch {
          invalidRecords += 1;
          continue;
        }
        const parsed = DiagnosticEventSchema.safeParse(value);
        if (!parsed.success) {
          invalidRecords += 1;
          continue;
        }
        events.push(parsed.data);
      }
    }
    return {
      events: events.slice(-limit),
      storedEvents: events.length,
      invalidRecords
    };
  }

  startRun(): Promise<DiagnosticRunState> {
    if (this.runState !== null) return Promise.resolve(this.runState);
    return this.enqueue(async () => {
      await mkdir(this.options.directory, { recursive: true });
      let previousRunAbnormal = false;
      try {
        await stat(this.markerPath);
        previousRunAbnormal = true;
      } catch (error) {
        if (!missing(error)) throw error;
      }
      const marker: RunMarker = {
        schemaVersion: 1,
        runId: this.createId(),
        startedAt: this.clock().toISOString()
      };
      const temporaryPath = join(
        this.options.directory,
        `active-run.${marker.runId}.tmp`
      );
      await writeFile(temporaryPath, JSON.stringify(marker), {
        encoding: 'utf8',
        flag: 'wx',
        mode: 0o600
      });
      try {
        await rename(temporaryPath, this.markerPath);
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code !== 'EEXIST' && code !== 'EPERM') throw error;
        await rm(this.markerPath, { force: true });
        await rename(temporaryPath, this.markerPath);
      }
      this.runState = {
        runId: marker.runId,
        previousRunAbnormal
      };
      return this.runState;
    });
  }

  finishRun(): Promise<void> {
    return this.enqueue(async () => {
      if (this.runState === null) return;
      let marker: RunMarker | null = null;
      try {
        marker = JSON.parse(await readFile(this.markerPath, 'utf8')) as RunMarker;
      } catch {
        marker = null;
      }
      if (marker?.runId === this.runState.runId) {
        await rm(this.markerPath, { force: true });
      }
      this.runState = null;
    });
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.pending.then(operation, operation);
    this.pending = result.then(() => undefined, () => undefined);
    return result;
  }

  private pathsOldestFirst(): string[] {
    const paths: string[] = [];
    for (let index = this.rotatedFiles; index >= 1; index -= 1) {
      paths.push(join(this.options.directory, `events.${index}.ndjson`));
    }
    paths.push(this.activePath);
    return paths;
  }

  private async readBounded(
    path: string
  ): Promise<{ value: string; truncated: boolean } | null> {
    let handle;
    try {
      handle = await open(path, 'r');
      const details = await handle.stat();
      const bound = this.maxFileBytes + MAX_EVENT_BYTES;
      const length = Math.min(details.size, bound);
      const buffer = Buffer.alloc(length);
      await handle.read(buffer, 0, length, details.size - length);
      return {
        value: buffer.toString('utf8'),
        truncated: details.size > bound
      };
    } catch (error) {
      if (missing(error)) return null;
      throw error;
    } finally {
      await handle?.close();
    }
  }

  private async rotate(): Promise<void> {
    if (this.rotatedFiles === 0) {
      await rm(this.activePath, { force: true });
      return;
    }
    await rm(
      join(this.options.directory, `events.${this.rotatedFiles}.ndjson`),
      { force: true }
    );
    for (let index = this.rotatedFiles; index >= 1; index -= 1) {
      const source = index === 1
        ? this.activePath
        : join(this.options.directory, `events.${index - 1}.ndjson`);
      const destination = join(
        this.options.directory,
        `events.${index}.ndjson`
      );
      try {
        await rename(source, destination);
      } catch (error) {
        if (!missing(error)) throw error;
      }
    }
  }
}
