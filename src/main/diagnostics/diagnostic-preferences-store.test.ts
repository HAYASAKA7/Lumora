import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { DiagnosticPreferencesStore } from './diagnostic-preferences-store';

const cleanup: string[] = [];

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((path) => rm(path, {
    force: true,
    recursive: true
  })));
});

async function createHarness() {
  const root = await mkdtemp(join(tmpdir(), 'lumora-diagnostic-preferences-'));
  cleanup.push(root);
  const defaultJournalDirectory = join(root, 'default-journal');
  const defaultExportDirectory = join(root, 'documents');
  await mkdir(defaultExportDirectory, { recursive: true });
  const preferencesPath = join(root, 'diagnostic-preferences.json');
  const store = new DiagnosticPreferencesStore({
    preferencesPath,
    defaultJournalDirectory,
    defaultExportDirectory
  });
  return {
    root,
    preferencesPath,
    defaultJournalDirectory,
    defaultExportDirectory,
    store
  };
}

describe('DiagnosticPreferencesStore', () => {
  it('uses safe defaults for missing or malformed preferences', async () => {
    const harness = await createHarness();

    await expect(harness.store.getSettings()).resolves.toEqual({
      selectedJournalDirectory: null,
      effectiveJournalDirectory: harness.defaultJournalDirectory,
      selectedExportDirectory: null,
      effectiveExportDirectory: harness.defaultExportDirectory,
      journalUsesDefault: true,
      exportUsesDefault: true,
      restartRequired: false,
      fallbackActive: false
    });

    await writeFile(harness.preferencesPath, '{"version":99,"path":"unsafe"}');
    const recovered = new DiagnosticPreferencesStore({
      preferencesPath: harness.preferencesPath,
      defaultJournalDirectory: harness.defaultJournalDirectory,
      defaultExportDirectory: harness.defaultExportDirectory
    });
    await expect(recovered.getSettings()).resolves.toMatchObject({
      selectedJournalDirectory: null,
      selectedExportDirectory: null
    });
  });

  it('validates and atomically persists selected directories', async () => {
    const harness = await createHarness();
    const journalDirectory = join(harness.root, 'custom-journal');
    const exportDirectory = join(harness.root, 'exports');

    await expect(
      harness.store.selectJournalDirectory(journalDirectory)
    ).resolves.toMatchObject({
      selectedJournalDirectory: journalDirectory,
      effectiveJournalDirectory: harness.defaultJournalDirectory,
      restartRequired: true
    });
    await expect(
      harness.store.selectExportDirectory(exportDirectory)
    ).resolves.toMatchObject({
      selectedExportDirectory: exportDirectory,
      effectiveExportDirectory: exportDirectory,
      exportUsesDefault: false
    });

    const stored = JSON.parse(await readFile(harness.preferencesPath, 'utf8'));
    expect(stored).toEqual({
      version: 1,
      selectedJournalDirectory: journalDirectory,
      appliedJournalDirectory: null,
      selectedExportDirectory: exportDirectory
    });
    await expect(readFile(`${harness.preferencesPath}.tmp`, 'utf8')).rejects.toMatchObject({
      code: 'ENOENT'
    });
  });

  it('resets journal and export selections independently', async () => {
    const harness = await createHarness();
    await harness.store.selectJournalDirectory(join(harness.root, 'journal'));
    await harness.store.selectExportDirectory(join(harness.root, 'exports'));

    await expect(harness.store.resetJournalDirectory()).resolves.toMatchObject({
      selectedJournalDirectory: null,
      journalUsesDefault: true,
      restartRequired: false,
      selectedExportDirectory: join(harness.root, 'exports')
    });
    await expect(harness.store.resetExportDirectory()).resolves.toMatchObject({
      selectedExportDirectory: null,
      effectiveExportDirectory: harness.defaultExportDirectory,
      exportUsesDefault: true
    });
  });

  it('rejects a path that cannot be used as a directory', async () => {
    const harness = await createHarness();
    const filePath = join(harness.root, 'not-a-directory');
    await writeFile(filePath, 'content');

    await expect(
      harness.store.selectJournalDirectory(filePath)
    ).rejects.toThrow('The selected diagnostic folder is not writable.');
    await expect(harness.store.getSettings()).resolves.toMatchObject({
      selectedJournalDirectory: null
    });
  });

  it('tracks the applied journal and startup fallback without clearing selection', async () => {
    const harness = await createHarness();
    const selected = join(harness.root, 'selected');
    await harness.store.selectJournalDirectory(selected);

    await harness.store.setRuntimeJournalState({
      effectiveDirectory: harness.defaultJournalDirectory,
      appliedDirectory: harness.defaultJournalDirectory,
      fallbackActive: true
    });

    await expect(harness.store.getSettings()).resolves.toMatchObject({
      selectedJournalDirectory: selected,
      effectiveJournalDirectory: harness.defaultJournalDirectory,
      restartRequired: true,
      fallbackActive: true
    });
    await expect(harness.store.getPreferences()).resolves.toMatchObject({
      selectedJournalDirectory: selected,
      appliedJournalDirectory: harness.defaultJournalDirectory
    });
  });
});
