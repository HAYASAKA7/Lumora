import { randomUUID } from 'node:crypto';
import {
  mkdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile
} from 'node:fs/promises';
import { dirname, isAbsolute, join } from 'node:path';

import { z } from 'zod';

import {
  DiagnosticStorageSettingsSchema,
  type DiagnosticStorageSettings
} from '../../shared/diagnostics';

const StoredDiagnosticPreferencesSchema = z.strictObject({
  version: z.literal(1),
  selectedJournalDirectory: z.string().min(1).max(32_768).nullable(),
  appliedJournalDirectory: z.string().min(1).max(32_768).nullable(),
  selectedExportDirectory: z.string().min(1).max(32_768).nullable()
});

export type StoredDiagnosticPreferences = z.infer<
  typeof StoredDiagnosticPreferencesSchema
>;

interface DiagnosticPreferencesStoreOptions {
  preferencesPath: string;
  defaultJournalDirectory: string;
  defaultExportDirectory: string;
}

interface RuntimeJournalState {
  effectiveDirectory: string;
  appliedDirectory: string;
  fallbackActive: boolean;
}

const DEFAULT_PREFERENCES: StoredDiagnosticPreferences = Object.freeze({
  version: 1,
  selectedJournalDirectory: null,
  appliedJournalDirectory: null,
  selectedExportDirectory: null
});

function missing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === 'ENOENT';
}

export class DiagnosticPreferencesStore {
  private preferences: StoredDiagnosticPreferences | null = null;
  private runtimeState: RuntimeJournalState | null = null;

  constructor(private readonly options: DiagnosticPreferencesStoreOptions) {}

  async getPreferences(): Promise<StoredDiagnosticPreferences> {
    return { ...await this.load() };
  }

  async getSettings(): Promise<DiagnosticStorageSettings> {
    const preferences = await this.load();
    const selectedJournalDirectory = preferences.selectedJournalDirectory;
    const selectedExportDirectory = preferences.selectedExportDirectory;
    const effectiveJournalDirectory = this.runtimeState?.effectiveDirectory
      ?? preferences.appliedJournalDirectory
      ?? this.options.defaultJournalDirectory;
    const effectiveExportDirectory = selectedExportDirectory
      ?? this.options.defaultExportDirectory;
    return DiagnosticStorageSettingsSchema.parse({
      selectedJournalDirectory,
      effectiveJournalDirectory,
      selectedExportDirectory,
      effectiveExportDirectory,
      journalUsesDefault: selectedJournalDirectory === null,
      exportUsesDefault: selectedExportDirectory === null,
      restartRequired: (
        selectedJournalDirectory ?? this.options.defaultJournalDirectory
      ) !== effectiveJournalDirectory,
      fallbackActive: this.runtimeState?.fallbackActive ?? false
    });
  }

  async selectJournalDirectory(
    directory: string
  ): Promise<DiagnosticStorageSettings> {
    await this.assertWritableDirectory(directory);
    const preferences = await this.load();
    await this.save({ ...preferences, selectedJournalDirectory: directory });
    return this.getSettings();
  }

  async resetJournalDirectory(): Promise<DiagnosticStorageSettings> {
    const preferences = await this.load();
    await this.save({ ...preferences, selectedJournalDirectory: null });
    return this.getSettings();
  }

  async selectExportDirectory(
    directory: string
  ): Promise<DiagnosticStorageSettings> {
    await this.assertWritableDirectory(directory);
    const preferences = await this.load();
    await this.save({ ...preferences, selectedExportDirectory: directory });
    return this.getSettings();
  }

  async resetExportDirectory(): Promise<DiagnosticStorageSettings> {
    const preferences = await this.load();
    await this.save({ ...preferences, selectedExportDirectory: null });
    return this.getSettings();
  }

  async setRuntimeJournalState(
    state: RuntimeJournalState
  ): Promise<DiagnosticStorageSettings> {
    const preferences = await this.load();
    this.runtimeState = { ...state };
    if (preferences.appliedJournalDirectory !== state.appliedDirectory) {
      await this.save({
        ...preferences,
        appliedJournalDirectory: state.appliedDirectory
      });
    }
    return this.getSettings();
  }

  private async load(): Promise<StoredDiagnosticPreferences> {
    if (this.preferences !== null) return this.preferences;
    try {
      const parsed = StoredDiagnosticPreferencesSchema.safeParse(
        JSON.parse(await readFile(this.options.preferencesPath, 'utf8'))
      );
      this.preferences = parsed.success
        ? parsed.data
        : { ...DEFAULT_PREFERENCES };
    } catch (error) {
      if (!missing(error) && !(error instanceof SyntaxError)) throw error;
      this.preferences = { ...DEFAULT_PREFERENCES };
    }
    return this.preferences;
  }

  private async save(preferences: StoredDiagnosticPreferences): Promise<void> {
    const parsed = StoredDiagnosticPreferencesSchema.parse(preferences);
    const directory = dirname(this.options.preferencesPath);
    const temporaryPath = `${this.options.preferencesPath}.tmp`;
    const backupPath = `${this.options.preferencesPath}.backup`;
    await mkdir(directory, { recursive: true });
    await rm(temporaryPath, { force: true });
    await writeFile(temporaryPath, `${JSON.stringify(parsed, null, 2)}\n`, {
      encoding: 'utf8',
      flag: 'wx',
      mode: 0o600
    });
    let previousMoved = false;
    try {
      try {
        await rename(this.options.preferencesPath, backupPath);
        previousMoved = true;
      } catch (error) {
        if (!missing(error)) throw error;
      }
      await rename(temporaryPath, this.options.preferencesPath);
      this.preferences = parsed;
      await rm(backupPath, { force: true });
    } catch (error) {
      if (previousMoved) {
        await rename(backupPath, this.options.preferencesPath);
      }
      throw error;
    } finally {
      await rm(temporaryPath, { force: true });
    }
  }

  private async assertWritableDirectory(directory: string): Promise<void> {
    if (!isAbsolute(directory) || directory.length > 32_768) {
      throw new Error('The selected diagnostic folder is not writable.');
    }
    const probePath = join(directory, `.lumora-write-${randomUUID()}.tmp`);
    let validationError: Error | null = null;
    try {
      await mkdir(directory, { recursive: true });
      if (!(await stat(directory)).isDirectory()) throw new Error('not-directory');
      await writeFile(probePath, '', { encoding: 'utf8', flag: 'wx', mode: 0o600 });
    } catch {
      validationError = new Error(
        'The selected diagnostic folder is not writable.'
      );
    }
    try {
      await rm(probePath, { force: true });
    } catch {
      validationError ??= new Error(
        'The selected diagnostic folder is not writable.'
      );
    }
    if (validationError !== null) throw validationError;
  }
}
