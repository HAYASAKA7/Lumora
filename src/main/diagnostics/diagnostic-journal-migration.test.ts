import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import type { DiagnosticEvent } from '../../shared/diagnostics';
import { DiagnosticJournal } from './diagnostic-journal';
import {
  migrateDiagnosticJournal,
  resolveDiagnosticJournalStorage
} from './diagnostic-journal-migration';
import { DiagnosticPreferencesStore } from './diagnostic-preferences-store';

const cleanup: string[] = [];

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((path) => rm(path, {
    force: true,
    recursive: true
  })));
});

function event(index: number): DiagnosticEvent {
  const hex = index.toString(16).padStart(12, '0');
  return {
    id: `00000000-0000-4000-8000-${hex}`,
    recordedAt: new Date(Date.UTC(2026, 7, 13, 8, 0, index)).toISOString(),
    severity: 'info',
    subsystem: 'application',
    operation: 'application-event',
    outcome: 'succeeded',
    correlationId: `10000000-0000-4000-8000-${hex}`,
    targetKind: 'local'
  };
}

async function createRoot() {
  const root = await mkdtemp(join(tmpdir(), 'lumora-diagnostic-migration-'));
  cleanup.push(root);
  return root;
}

describe('diagnostic journal migration', () => {
  it('merges valid bounded events, ignores malformed records, and deduplicates IDs', async () => {
    const root = await createRoot();
    const source = join(root, 'source');
    const destination = join(root, 'destination');
    await mkdir(source, { recursive: true });
    await mkdir(destination, { recursive: true });
    await writeFile(join(source, 'events.1.ndjson'), `${JSON.stringify(event(1))}\n`);
    await writeFile(
      join(source, 'events.ndjson'),
      `not-json\n${JSON.stringify(event(2))}\n${JSON.stringify(event(2))}\n`
    );
    await writeFile(join(destination, 'events.ndjson'), `${JSON.stringify(event(3))}\n`);

    await migrateDiagnosticJournal({ sourceDirectory: source, destinationDirectory: destination });

    const journal = new DiagnosticJournal({ directory: destination });
    await expect(journal.readRecent()).resolves.toMatchObject({
      events: [event(1), event(2), event(3)],
      invalidRecords: 0
    });
    await expect(stat(join(source, 'events.ndjson'))).rejects.toMatchObject({
      code: 'ENOENT'
    });
  });

  it('preserves an abnormal-run marker when moving journal storage', async () => {
    const root = await createRoot();
    const source = join(root, 'source');
    const destination = join(root, 'destination');
    await mkdir(source, { recursive: true });
    await writeFile(join(source, 'active-run.json'), JSON.stringify({
      schemaVersion: 1,
      runId: '00000000-0000-4000-8000-000000000001',
      startedAt: '2026-08-13T08:00:00.000Z'
    }));

    await migrateDiagnosticJournal({ sourceDirectory: source, destinationDirectory: destination });

    expect(await readFile(join(destination, 'active-run.json'), 'utf8')).toContain(
      '00000000-0000-4000-8000-000000000001'
    );
  });

  it('retains only the newest events within the configured file bound', async () => {
    const root = await createRoot();
    const source = join(root, 'source');
    const destination = join(root, 'destination');
    await mkdir(source, { recursive: true });
    await writeFile(
      join(source, 'events.ndjson'),
      Array.from({ length: 12 }, (_, index) => JSON.stringify(event(index + 1))).join('\n')
    );

    await migrateDiagnosticJournal({
      sourceDirectory: source,
      destinationDirectory: destination,
      maxFileBytes: 512,
      rotatedFiles: 2
    });

    const files = await Promise.all(
      ['events.2.ndjson', 'events.1.ndjson', 'events.ndjson'].map(async (name) => ({
        name,
        size: (await stat(join(destination, name))).size
      }))
    );
    expect(files.every(({ size }) => size <= 512)).toBe(true);
    const journal = new DiagnosticJournal({
      directory: destination,
      maxFileBytes: 512,
      rotatedFiles: 2
    });
    const recent = await journal.readRecent();
    expect(recent.events.at(-1)).toEqual(event(12));
    expect(recent.events.length).toBeLessThan(12);
  });

  it('falls back safely while preserving an unavailable custom selection', async () => {
    const root = await createRoot();
    const defaultDirectory = join(root, 'default');
    const documentsDirectory = join(root, 'documents');
    const selectedDirectory = join(root, 'selected');
    const preferencesPath = join(root, 'diagnostic-preferences.json');
    await mkdir(documentsDirectory, { recursive: true });
    await mkdir(selectedDirectory, { recursive: true });
    const store = new DiagnosticPreferencesStore({
      preferencesPath,
      defaultJournalDirectory: defaultDirectory,
      defaultExportDirectory: documentsDirectory
    });
    await store.selectJournalDirectory(selectedDirectory);
    await rm(selectedDirectory, { recursive: true });
    await writeFile(selectedDirectory, 'not a directory');

    await expect(resolveDiagnosticJournalStorage({
      store,
      defaultDirectory
    })).resolves.toEqual({
      directory: defaultDirectory,
      fallbackActive: true
    });
    await expect(store.getSettings()).resolves.toMatchObject({
      selectedJournalDirectory: selectedDirectory,
      effectiveJournalDirectory: defaultDirectory,
      fallbackActive: true,
      restartRequired: true
    });
  });
});
