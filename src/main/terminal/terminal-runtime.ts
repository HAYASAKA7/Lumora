import { randomBytes } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { posix, win32 } from 'node:path';

import {
  CustomTerminalProfileInputSchema,
  TerminalProfileIdSchema,
  TerminalProfileListSchema,
  TerminalProfileSchema,
  type CustomTerminalProfileInput,
  type LaunchPrepareRequest,
  type LaunchPreview,
  type ProviderLaunchConfig,
  type ProviderLaunchConfigInput,
  type ProviderScanResult,
  type RuntimeAttachment,
  type RuntimeEvent,
  type RuntimeResizeRequest,
  type RuntimeSummary,
  type RuntimeWriteRequest,
  type SystemInfo,
  type TerminalProfile
} from '../../shared/contracts';
import { findExecutable, isExecutableFile } from '../platform/executable-locator';
import { migrateCatalogDatabase } from '../storage/migrations';
import { TerminalRepository } from '../storage/terminal-repository';
import { LaunchService } from './launch-service';
import { NewSessionReconciler } from './new-session-reconciler';
import { spawnPty } from './pty-adapter';
import { detectTerminalProfiles } from './profile-detector';
import { RuntimeHost, type PtySpawnOptions, type PtyProcess } from './runtime-host';

type Environment = Readonly<Record<string, string | undefined>>;

interface CreateTerminalRuntimeOptions {
  databasePath: string;
  platform: SystemInfo['platform'];
  env: Environment;
  scanProviders(): Promise<ProviderScanResult>;
  refreshCatalog?(): Promise<unknown>;
  clock?: () => Date;
  createProfileId?: () => string;
  spawn?: (options: PtySpawnOptions) => PtyProcess;
}

export interface TerminalRuntime {
  getProfiles(): TerminalProfile[];
  saveProfile(input: CustomTerminalProfileInput): Promise<TerminalProfile[]>;
  deleteProfile(profileId: string): TerminalProfile[];
  getProviderLaunchConfigs(): ProviderLaunchConfig[];
  saveProviderLaunchConfig(
    input: ProviderLaunchConfigInput
  ): ProviderLaunchConfig[];
  prepareLaunch(input: LaunchPrepareRequest): Promise<LaunchPreview>;
  startRuntime(launchToken: string): Promise<RuntimeSummary>;
  listRuntimes(): RuntimeSummary[];
  attachRuntime(runtimeId: string): RuntimeAttachment;
  writeRuntime(input: RuntimeWriteRequest): void;
  resizeRuntime(input: RuntimeResizeRequest): void;
  terminateRuntime(runtimeId: string): Promise<RuntimeSummary>;
  subscribe(listener: (event: RuntimeEvent) => void): () => void;
  shutdown(): Promise<void>;
  close(): void;
}

export async function createTerminalRuntime({
  databasePath,
  platform,
  env,
  scanProviders,
  refreshCatalog,
  clock = () => new Date(),
  createProfileId = () => randomBytes(32).toString('hex'),
  spawn = spawnPty
}: CreateTerminalRuntimeOptions): Promise<TerminalRuntime> {
  const database = new DatabaseSync(databasePath);
  try {
    migrateCatalogDatabase(database);
  } catch (error) {
    database.close();
    throw error;
  }
  const repository = new TerminalRepository(database);
  repository.markLiveRuntimesLost(clock().toISOString());

  const locate = (command: string) =>
    findExecutable(command, { platform, env });
  const detected = await detectTerminalProfiles({
    platform,
    env,
    findExecutable: locate,
    isExecutablePath: (path) => isExecutableFile(path, platform)
  });
  repository.reconcileDetectedProfiles(detected, clock().toISOString());

  const launchService = new LaunchService({
    repository,
    scanProviders,
    isExecutablePath: (path) => isExecutableFile(path, platform),
    captureSessionBaseline: async (provider, workspaceId) => {
      if (refreshCatalog === undefined) {
        throw new Error('Catalog refresh is unavailable.');
      }
      await refreshCatalog();
      return repository
        .listCurrentSessionIdentities(provider, workspaceId)
        .map((session) => session.nativeId);
    },
    platform,
    env,
    clock
  });
  let host!: RuntimeHost;
  const reconciler = new NewSessionReconciler({
    refreshCatalog: async () => {
      if (refreshCatalog === undefined) {
        throw new Error('Catalog refresh is unavailable.');
      }
      await refreshCatalog();
    },
    listCurrentSessionIdentities: (provider, workspaceId) =>
      repository.listCurrentSessionIdentities(provider, workspaceId),
    applyResult: (runtimeId, result) => {
      host.applyReconciliation(runtimeId, result);
    }
  });
  host = new RuntimeHost({
    repository,
    consumeLaunch: (token) => launchService.consume(token),
    spawn,
    startReconciliation: (request) => {
      void reconciler.start(request);
    },
    platform,
    clock
  });
  let closed = false;

  return {
    getProfiles() {
      return TerminalProfileListSchema.parse(repository.listProfiles());
    },
    async saveProfile(value) {
      const input = CustomTerminalProfileInputSchema.parse(value);
      const pathApi = platform === 'win32' ? win32 : posix;
      if (!pathApi.isAbsolute(input.executablePath)) {
        throw new Error('Terminal profile executable paths must be absolute.');
      }
      const profile = TerminalProfileSchema.parse({
        id: createProfileId(),
        kind: 'custom',
        name: input.name,
        shellFamily: input.shellFamily,
        executablePath: input.executablePath,
        args: input.args,
        available: await isExecutableFile(input.executablePath, platform),
        recommended: false
      });
      repository.saveCustomProfile(profile, clock().toISOString());
      return TerminalProfileListSchema.parse(repository.listProfiles());
    },
    deleteProfile(profileId) {
      repository.deleteCustomProfile(TerminalProfileIdSchema.parse(profileId));
      return TerminalProfileListSchema.parse(repository.listProfiles());
    },
    getProviderLaunchConfigs() {
      return repository.listProviderLaunchConfigs();
    },
    saveProviderLaunchConfig(input) {
      return repository.saveProviderLaunchConfig(input, clock().toISOString());
    },
    prepareLaunch(input) {
      return launchService.prepare(input);
    },
    startRuntime(launchToken) {
      return host.start(launchToken);
    },
    listRuntimes() {
      return host.list();
    },
    attachRuntime(runtimeId) {
      return host.attach(runtimeId);
    },
    writeRuntime(input) {
      host.write(input);
    },
    resizeRuntime(input) {
      host.resize(input);
    },
    terminateRuntime(runtimeId) {
      return host.terminate(runtimeId);
    },
    subscribe(listener) {
      return host.subscribe(listener);
    },
    async shutdown() {
      await reconciler.shutdown();
      await host.shutdown();
    },
    close() {
      if (closed) return;
      closed = true;
      void reconciler.shutdown();
      database.close();
    }
  };
}
