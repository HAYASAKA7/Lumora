import { randomUUID } from 'node:crypto';
import {
  mkdir,
  open,
  readFile,
  rename,
  rm,
  stat,
  writeFile
} from 'node:fs/promises';
import { join, resolve } from 'node:path';

import {
  DiagnosticEventSchema,
  type DiagnosticEvent
} from '../../shared/diagnostics';
import type { DiagnosticPreferencesStore } from './diagnostic-preferences-store';

const DEFAULT_MAX_FILE_BYTES = 1024 * 1024;
const DEFAULT_ROTATED_FILES = 2;
const MAX_EVENT_BYTES = 8 * 1024;
const ACTIVE_FILE = 'events.ndjson';
const MARKER_FILE = 'active-run.json';

interface MigrateDiagnosticJournalOptions {
  sourceDirectory: string;
  destinationDirectory: string;
  maxFileBytes?: number;
  rotatedFiles?: number;
}

interface ResolveDiagnosticJournalStorageOptions {
  store: DiagnosticPreferencesStore;
  defaultDirectory: string;
}

interface ResolvedDiagnosticJournalStorage {
  directory: string;
  fallbackActive: boolean;
}

function missing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === 'ENOENT';
}

function journalFileNames(rotatedFiles: number): string[] {
  return [
    ...Array.from(
      { length: rotatedFiles },
      (_, index) => `events.${rotatedFiles - index}.ndjson`
    ),
    ACTIVE_FILE
  ];
}

async function readBounded(path: string, maximum: number): Promise<string | null> {
  let handle;
  try {
    handle = await open(path, 'r');
    const details = await handle.stat();
    const length = Math.min(details.size, maximum);
    const buffer = Buffer.alloc(length);
    await handle.read(buffer, 0, length, details.size - length);
    return buffer.toString('utf8');
  } catch (error) {
    if (missing(error)) return null;
    throw error;
  } finally {
    await handle?.close();
  }
}

async function readEvents(
  directory: string,
  names: readonly string[],
  maxFileBytes: number
): Promise<DiagnosticEvent[]> {
  const events: DiagnosticEvent[] = [];
  for (const name of names) {
    const content = await readBounded(
      join(directory, name),
      maxFileBytes + MAX_EVENT_BYTES
    );
    if (content === null) continue;
    for (const line of content.split(/\r?\n/u)) {
      if (line.trim() === '' || Buffer.byteLength(line, 'utf8') > MAX_EVENT_BYTES) {
        continue;
      }
      try {
        const parsed = DiagnosticEventSchema.safeParse(JSON.parse(line));
        if (parsed.success) events.push(parsed.data);
      } catch {
        // Malformed journal records are ignored by the normal journal reader too.
      }
    }
  }
  return events;
}

function boundedChunks(
  events: readonly DiagnosticEvent[],
  maxFileBytes: number,
  fileCount: number
): string[] {
  const chunksNewestFirst: string[] = [];
  let current = '';
  let currentBytes = 0;
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const line = `${JSON.stringify(events[index])}\n`;
    const lineBytes = Buffer.byteLength(line, 'utf8');
    if (current !== '' && currentBytes + lineBytes > maxFileBytes) {
      chunksNewestFirst.push(current);
      if (chunksNewestFirst.length >= fileCount) break;
      current = '';
      currentBytes = 0;
    }
    if (lineBytes > maxFileBytes) continue;
    current = `${line}${current}`;
    currentBytes += lineBytes;
  }
  if (current !== '' && chunksNewestFirst.length < fileCount) {
    chunksNewestFirst.push(current);
  }
  return chunksNewestFirst.reverse();
}

async function markerContent(directory: string): Promise<string | null> {
  try {
    const details = await stat(join(directory, MARKER_FILE));
    if (!details.isFile() || details.size > MAX_EVENT_BYTES) return null;
    return await readFile(join(directory, MARKER_FILE), 'utf8');
  } catch (error) {
    if (missing(error)) return null;
    throw error;
  }
}

async function assertWritableDirectory(directory: string): Promise<void> {
  await mkdir(directory, { recursive: true });
  if (!(await stat(directory)).isDirectory()) throw new Error('not-directory');
  const probe = join(directory, `.lumora-migration-${randomUUID()}.tmp`);
  try {
    await writeFile(probe, '', { flag: 'wx', mode: 0o600 });
  } finally {
    await rm(probe, { force: true });
  }
}

export async function migrateDiagnosticJournal({
  sourceDirectory,
  destinationDirectory,
  maxFileBytes = DEFAULT_MAX_FILE_BYTES,
  rotatedFiles = DEFAULT_ROTATED_FILES
}: MigrateDiagnosticJournalOptions): Promise<void> {
  const source = resolve(sourceDirectory);
  const destination = resolve(destinationDirectory);
  await assertWritableDirectory(destination);
  if (source === destination) return;

  const boundedFileBytes = Math.max(256, Math.trunc(maxFileBytes));
  const boundedRotatedFiles = Math.max(0, Math.min(8, Math.trunc(rotatedFiles)));
  const names = journalFileNames(boundedRotatedFiles);
  const combined = [
    ...await readEvents(source, names, boundedFileBytes),
    ...await readEvents(destination, names, boundedFileBytes)
  ];
  const deduplicated = [...new Map(combined.map((value) => [value.id, value])).values()]
    .sort((left, right) => left.recordedAt.localeCompare(right.recordedAt));
  const chunks = boundedChunks(
    deduplicated,
    boundedFileBytes,
    boundedRotatedFiles + 1
  );
  const destinationNames = chunks.length === 0
    ? []
    : journalFileNames(chunks.length - 1);
  const transactionId = randomUUID();
  const staged = chunks.map((content, index) => {
    const name = destinationNames[index];
    if (name === undefined) {
      throw new Error('Diagnostic migration file mapping is incomplete.');
    }
    return {
      name,
      path: join(destination, `${name}.${transactionId}.tmp`),
      content
    };
  });

  try {
    await Promise.all(staged.map(({ path, content }) => writeFile(path, content, {
      encoding: 'utf8',
      flag: 'wx',
      mode: 0o600
    })));
    const marker = await markerContent(source) ?? await markerContent(destination);
    const markerStage = marker === null
      ? null
      : join(destination, `${MARKER_FILE}.${transactionId}.tmp`);
    if (marker !== null && markerStage !== null) {
      await writeFile(markerStage, marker, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
    }

    await Promise.all(names.map((name) => rm(join(destination, name), { force: true })));
    for (const item of staged) await rename(item.path, join(destination, item.name));
    if (markerStage !== null) {
      await rm(join(destination, MARKER_FILE), { force: true });
      await rename(markerStage, join(destination, MARKER_FILE));
    }

    await Promise.all([
      ...names.map((name) => rm(join(source, name), { force: true })),
      rm(join(source, MARKER_FILE), { force: true })
    ]);
  } finally {
    await Promise.all(staged.map(({ path }) => rm(path, { force: true })));
    await rm(join(destination, `${MARKER_FILE}.${transactionId}.tmp`), { force: true });
  }
}

export async function resolveDiagnosticJournalStorage({
  store,
  defaultDirectory
}: ResolveDiagnosticJournalStorageOptions): Promise<ResolvedDiagnosticJournalStorage> {
  const preferences = await store.getPreferences();
  const sourceDirectory = preferences.appliedJournalDirectory ?? defaultDirectory;
  const selectedDirectory = preferences.selectedJournalDirectory ?? defaultDirectory;
  try {
    await migrateDiagnosticJournal({
      sourceDirectory,
      destinationDirectory: selectedDirectory
    });
    await store.setRuntimeJournalState({
      effectiveDirectory: selectedDirectory,
      appliedDirectory: selectedDirectory,
      fallbackActive: false
    });
    return { directory: selectedDirectory, fallbackActive: false };
  } catch {
    await assertWritableDirectory(defaultDirectory);
    await store.setRuntimeJournalState({
      effectiveDirectory: defaultDirectory,
      appliedDirectory: defaultDirectory,
      fallbackActive: true
    });
    return { directory: defaultDirectory, fallbackActive: true };
  }
}
