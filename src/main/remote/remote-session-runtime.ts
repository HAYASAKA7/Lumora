import { createHash } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';

import type {
  LaunchPrepareRequest,
  ProviderId,
  ProviderScanResult,
  RemoteDiscoverySnapshot,
  RemoteExecutionTargetId,
  RemoteSessionCatalog,
  RuntimeEvent,
  SystemInfo,
  TerminalProfile
} from '../../shared/contracts';
import { SESSION_PROVIDER_IDS } from '../../shared/provider-definitions';
import { CatalogRepository } from '../storage/catalog-repository';
import { TerminalRepository } from '../storage/terminal-repository';
import { resolvePtyInvocation } from '../platform/pty-invocation';
import {
  buildResumeArguments
} from '../providers/launch-command';
import {
  createSessionCatalogRegistry,
  validateInstalledProviderCompatibility
} from '../providers/session-catalog-adapter';
import { LaunchService } from '../terminal/launch-service';
import { NewSessionReconciler } from '../terminal/new-session-reconciler';
import {
  RuntimeHost,
  type PtySpawnOptions
} from '../terminal/runtime-host';
import { buildRemotePtyCommand } from './remote-pty-command';
import type { RemotePtyChannel } from './ssh-client';

interface CreateRemoteSessionRuntimeOptions {
  database: DatabaseSync;
  executionTargetId: RemoteExecutionTargetId;
  platform: SystemInfo['platform'];
  defaultShell: string;
  scanDiscovery(): Promise<RemoteDiscoverySnapshot>;
  scanSessions(): Promise<RemoteSessionCatalog>;
  enabledProviders?(): readonly ProviderId[];
  openPty(
    command: string,
    size: { cols: number; rows: number }
  ): Promise<RemotePtyChannel>;
  reconciliationWait?(
    delay: number,
    signal: AbortSignal
  ): Promise<void>;
  reconciliationDelays?: readonly number[];
  clock?: () => Date;
}

function stableRemoteId(...parts: string[]): string {
  return createHash('sha256').update(parts.join('\0')).digest('hex');
}

export function createRemoteWorkspaceId(
  executionTargetId: string,
  canonicalPath: string
): string {
  return stableRemoteId(executionTargetId, 'workspace', canonicalPath);
}

function remoteShellFamily(
  shellPath: string
): TerminalProfile['shellFamily'] {
  const basename = shellPath.split(/[\\/]/u).at(-1)?.toLocaleLowerCase() ?? '';
  if (basename === 'pwsh' || basename === 'pwsh.exe') return 'pwsh';
  if (basename === 'powershell' || basename === 'powershell.exe') {
    return 'powershell';
  }
  if (basename === 'cmd' || basename === 'cmd.exe') return 'cmd';
  if (basename === 'zsh') return 'zsh';
  if (basename === 'bash') return 'bash';
  if (basename === 'fish') return 'fish';
  return 'other';
}

const remoteSessionCatalogRegistry = createSessionCatalogRegistry(
  SESSION_PROVIDER_IDS.map((provider) => ({
    provider,
    discover: async () => {
      throw new Error('Remote session discovery is owned by the helper.');
    },
    validateCompatibility: validateInstalledProviderCompatibility,
    buildResumeArguments: (nativeSessionId: string, startPrompt: string) =>
      buildResumeArguments(provider, nativeSessionId, startPrompt),
    snapshotHandoff: async () => {
      throw new Error('Remote cross-agent handoff is unavailable.');
    }
  }))
);

export function createRemoteSessionRuntime(
  options: CreateRemoteSessionRuntimeOptions
) {
  const clock = options.clock ?? (() => new Date());
  const catalogRepository = new CatalogRepository(
    options.database,
    options.executionTargetId
  );
  const repository = new TerminalRepository(
    options.database,
    options.executionTargetId
  );
  repository.markLiveRuntimesLost(clock().toISOString());
  const shellFamily = remoteShellFamily(options.defaultShell);
  const terminalProfile: TerminalProfile = {
    id: stableRemoteId(
      options.executionTargetId,
      'ssh-pty',
      options.defaultShell
    ),
    kind: 'detected',
    name: 'Remote SSH PTY',
    shellFamily,
    executablePath: options.defaultShell,
    args:
      options.platform !== 'win32' && shellFamily !== 'other'
        ? ['-l']
        : [],
    available: true,
    recommended: true
  };
  repository.reconcileDetectedProfiles([terminalProfile], clock().toISOString());
  let executablePaths = new Set<string>();

  const updateCatalog = (catalog: RemoteSessionCatalog): void => {
    if (catalog.executionTargetId !== options.executionTargetId) {
      throw new Error('Remote catalog target mismatch.');
    }
    for (const provider of SESSION_PROVIDER_IDS) {
      const candidates = catalog.sessions
        .filter((session) => session.provider === provider)
        .map((session) => ({
          provider,
          nativeId: session.nativeId,
          workspace: {
            id: createRemoteWorkspaceId(
              options.executionTargetId,
              session.workspacePath
            ),
            canonicalPath: session.workspacePath,
            identityKey: session.workspacePath,
            displayName:
              session.workspacePath.split(/[\\/]+/u).filter(Boolean).at(-1) ??
              session.workspacePath,
            available: true
          },
          title: session.title,
          createdAt: session.createdAt,
          updatedAt: session.updatedAt,
          lifetimeTokens: session.lifetimeTokens,
          source: {
            key: `remote:${stableRemoteId(
              options.executionTargetId,
              provider,
              session.nativeId
            )}`,
            fingerprint: null
          }
        }));
      catalogRepository.applyProviderScan({
        provider,
        scanId: stableRemoteId(
          options.executionTargetId,
          provider,
          catalog.scannedAt
        ),
        scannedAt: catalog.scannedAt,
        candidates
      });
    }
  };

  const scanProviders = async (): Promise<ProviderScanResult> => {
    const snapshot = await options.scanDiscovery();
    if (snapshot.executionTargetId !== options.executionTargetId) {
      throw new Error('Remote discovery target mismatch.');
    }
    executablePaths = new Set(
      snapshot.providers.providers.flatMap((provider) =>
        provider.state === 'ready' ? [provider.executablePath] : []
      )
    );
    return snapshot.providers;
  };

  const refreshCatalog = async (): Promise<RemoteSessionCatalog> => {
    const catalog = await options.scanSessions();
    updateCatalog(catalog);
    return catalog;
  };

  const launchService = new LaunchService({
    repository,
    sessionCatalogRegistry: remoteSessionCatalogRegistry,
    scanProviders,
    isExecutablePath: async (path) => executablePaths.has(path),
    captureSessionBaseline: async (provider, workspaceId) => {
      await refreshCatalog();
      return repository
        .listCurrentSessionIdentities(provider, workspaceId)
        .map((session) => session.nativeId);
    },
    handoffService: {
      reserve: () => {
        throw new Error('Remote cross-agent handoff is unavailable.');
      },
      materialize: async () => {
        throw new Error('Remote cross-agent handoff is unavailable.');
      }
    },
    platform: options.platform,
    env: {},
    buildEnvironment: () => ({}),
    clock
  });

  let host!: RuntimeHost;
  const reconciler = new NewSessionReconciler({
    refreshCatalog,
    listCurrentSessionIdentities: (provider, workspaceId) =>
      repository.listCurrentSessionIdentities(provider, workspaceId),
    applyResult: (runtimeId, result) => {
      host.applyReconciliation(runtimeId, result);
    },
    ...(options.reconciliationWait === undefined
      ? {}
      : { wait: options.reconciliationWait }),
    ...(options.reconciliationDelays === undefined
      ? {}
      : { delays: options.reconciliationDelays })
  });
  host = new RuntimeHost({
    repository,
    consumeLaunch: (token) => launchService.consume(token),
    spawn: async (spawnOptions: PtySpawnOptions) => {
      const command = buildRemotePtyCommand({
        platform: options.platform,
        cwd: spawnOptions.cwd,
        executablePath: spawnOptions.executablePath,
        args: spawnOptions.args,
        env: spawnOptions.env
      });
      return options.openPty(command, {
        cols: spawnOptions.cols,
        rows: spawnOptions.rows
      });
    },
    resolveInvocation: (spec) => resolvePtyInvocation({
      platform: options.platform,
      executablePath: spec.executablePath,
      args: spec.args,
      command: spec.command,
      env: {},
      terminalProfile: spec.terminalProfile,
      isExecutableFile: () => true
    }),
    startReconciliation: (request) => {
      void reconciler.start(request);
    },
    platform: options.platform,
    clock
  });

  let closed = false;
  return {
    updateCatalog,
    getProfiles: () => repository.listProfiles(),
    async saveProfile() {
      throw new Error('Remote terminal profiles are managed by SSH.');
    },
    deleteProfile() {
      throw new Error('Remote terminal profiles are managed by SSH.');
    },
    getProviderLaunchConfigs: () => {
      const enabled = new Set(
        options.enabledProviders?.() ?? SESSION_PROVIDER_IDS
      );
      return repository.listProviderLaunchConfigs().filter(
        ({ provider }) =>
          enabled.has(provider) && SESSION_PROVIDER_IDS.includes(provider)
      );
    },
    getLaunchSettingsLayers: () => repository.listLaunchSettingsLayers(),
    saveProviderLaunchConfig: (
      input: Parameters<TerminalRepository['saveProviderLaunchConfig']>[0]
    ) => repository.saveProviderLaunchConfig(input, clock().toISOString()),
    saveLaunchSettingsLayer: (
      input: Parameters<TerminalRepository['saveLaunchSettingsLayer']>[0]
    ) => repository.saveLaunchSettingsLayer(input, clock().toISOString()),
    getGeneralSettings: () => ({
      ...repository.getGeneralSettings(),
      crossAgentWorkflowEnabled: false as const,
      enabledProviders: [
        ...(options.enabledProviders?.() ?? SESSION_PROVIDER_IDS)
      ]
    }),
    getKeyboardSettings: () => repository.getKeyboardSettings(),
    saveGeneralSettings() {
      throw new Error('Remote general settings use the target settings API.');
    },
    saveKeyboardSettings: (
      input: Parameters<TerminalRepository['saveKeyboardSettings']>[0]
    ) => repository.saveKeyboardSettings(input, clock().toISOString()),
    getWorkspaceTrustDecisions: () =>
      repository.listWorkspaceTrustDecisions(),
    revokeWorkspaceTrust: (workspaceId: string) =>
      repository.revokeWorkspaceTrust(workspaceId),
    async prepareLaunch(input: LaunchPrepareRequest) {
      if (input.strategy === 'fork') {
        throw new Error('Remote native fork is unavailable.');
      }
      await refreshCatalog();
      return launchService.prepare(input);
    },
    trustWorkspaceForLaunch: (launchToken: string) =>
      launchService.trustWorkspaceForLaunch(launchToken),
    startRuntime: (launchToken: string) => host.start(launchToken),
    listRuntimes: () => host.list(),
    attachRuntime: (runtimeId: string) => host.attach(runtimeId),
    writeRuntime: (input: Parameters<RuntimeHost['write']>[0]) => host.write(input),
    resizeRuntime: (input: Parameters<RuntimeHost['resize']>[0]) =>
      host.resize(input),
    terminateRuntime: (runtimeId: string) => host.terminate(runtimeId),
    subscribe: (listener: (event: RuntimeEvent) => void) => host.subscribe(listener),
    async shutdown() {
      await reconciler.shutdown();
      await host.shutdown();
    },
    close() {
      if (closed) return;
      closed = true;
      void reconciler.shutdown();
    }
  };
}

export type RemoteSessionRuntime = ReturnType<typeof createRemoteSessionRuntime>;
