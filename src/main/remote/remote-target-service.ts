import { createHash, randomUUID } from 'node:crypto';

import {
  RemoteConnectionProfileInputSchema,
  RemoteDiscoverySnapshotSchema,
  RemoteExecutionTargetIdSchema,
  ProviderIdSchema,
  RemoteProviderPreferencesSchema,
  RemoteSessionCatalogSchema,
  RemoteTargetCredentialsSchema,
  PROVIDER_IDS,
  type ExecutionTarget,
  type CatalogSnapshot,
  type ProviderId,
  type RemoteConnectionProfile,
  type RemoteConnectionProfileInput,
  type RemoteCredentialStatus,
  type RemoteDiscoverySnapshot,
  type RemoteExecutionTargetId,
  type RemoteSessionCatalog,
  type RemoteTargetCredentials,
  type RuntimeEvent,
  type SystemInfo
} from '../../shared/contracts';
import {
  SESSION_PROVIDER_IDS,
  providerDefinition
} from '../../shared/provider-definitions';
import type { RemoteTargetErrorCode } from '../../shared/remote-target-errors';
import type { RemotePlatformFacts } from './platform-probe';
import { probeRemotePlatform } from './platform-probe';
import {
  connectRemoteHelper,
  RemoteHelperConnectionError,
  type ConnectedRemoteHelper
} from './helper-connection';
import type { VerifiedRemoteHelperArtifact } from './helper-artifact-resolver';
import {
  inspectRemoteHelper,
  installRemoteHelper,
  type RemoteHelperInspection
} from './helper-installer';
import {
  createRemoteHelperPaths,
  helperLaunchCommand,
  type RemoteHelperPaths
} from './helper-remote-paths';
import type { ConnectedRemoteSshClient } from './ssh-client';
import { createRemoteSshClient } from './ssh-client';
import { RemoteSshError } from './ssh-errors';
import type { RemoteSessionRuntime } from './remote-session-runtime';
import {
  createProviderUpdateService,
  type ProviderUpdateService
} from '../providers/provider-update-service';
import type { ProviderReleaseSource } from '../providers/provider-release-source';
import { createRemoteLifecycleStore } from './remote-lifecycle-store';

type RemoteTarget = Extract<ExecutionTarget, { kind: 'remote' }>;

interface TargetRepository {
  list(): ExecutionTarget[];
  get(id: RemoteExecutionTargetId): ExecutionTarget | null;
  createRemote(input: {
    id: RemoteExecutionTargetId;
    displayName: string;
  }): ExecutionTarget;
  updateRemoteConnection(
    id: RemoteExecutionTargetId,
    input: Partial<Pick<RemoteTarget,
      'connectionState' | 'platform' | 'architecture' | 'helperVersion' |
      'protocolVersion' | 'capabilities' | 'lastConnectedAt' | 'lastScannedAt'>>
  ): ExecutionTarget;
  deleteRemote(id: RemoteExecutionTargetId): void;
}

interface ProfileRepository {
  list(): RemoteConnectionProfile[];
  get(id: RemoteExecutionTargetId): RemoteConnectionProfile | null;
  save(
    id: RemoteExecutionTargetId,
    input: RemoteConnectionProfileInput,
    now?: Date
  ): RemoteConnectionProfile;
  trustHostKey(
    id: RemoteExecutionTargetId,
    fingerprint: string,
    now?: Date
  ): RemoteConnectionProfile;
}

interface SshService {
  observeHostKey(profile: RemoteConnectionProfile): Promise<{
    executionTargetId: RemoteExecutionTargetId;
    fingerprint: string;
  }>;
  connect(
    profile: RemoteConnectionProfile,
    credentials: RemoteTargetCredentials
  ): Promise<ConnectedRemoteSshClient>;
}

interface ProviderPreferenceRepository {
  get(id: RemoteExecutionTargetId): readonly (typeof PROVIDER_IDS)[number][];
  save(
    id: RemoteExecutionTargetId,
    providers: readonly (typeof PROVIDER_IDS)[number][],
    now?: Date
  ): readonly (typeof PROVIDER_IDS)[number][];
}

interface RemoteCredentialPreferenceRepository {
  getAutoConnect(id: RemoteExecutionTargetId): boolean;
  setAutoConnect(id: RemoteExecutionTargetId, enabled: boolean): void;
}

interface RemoteCredentialVaultAccess {
  getStorageState(): Promise<RemoteCredentialStatus['storageState']>;
  getCredentialState(
    id: RemoteExecutionTargetId
  ): RemoteCredentialStatus['credentialState'];
  save(
    id: RemoteExecutionTargetId,
    kind: 'password' | 'private-key-passphrase',
    secret: string
  ): Promise<void>;
  resolve(
    id: RemoteExecutionTargetId,
    kind: 'password' | 'private-key-passphrase'
  ): Promise<string | null>;
  forget(id: RemoteExecutionTargetId): void;
}

type RemoteConnectionInput = RemoteTargetCredentials | {
  mode: 'manual';
  credentials: RemoteTargetCredentials;
  rememberCredential: boolean;
} | {
  mode: 'automatic';
} | {
  mode: 'remembered';
};

export interface RemoteTargetSummary {
  target: RemoteTarget;
  profile: RemoteConnectionProfile;
}

export interface RemoteTargetConnectionDetails extends RemoteTargetSummary {
  homeDirectory: string;
  defaultShell: string;
}

interface CreateRemoteTargetServiceOptions {
  targets: TargetRepository;
  profiles: ProfileRepository;
  ssh?: SshService;
  probePlatform?: (
    execute: ConnectedRemoteSshClient['execute']
  ) => Promise<RemotePlatformFacts>;
  resolveHelperArtifact?: (
    facts: RemotePlatformFacts
  ) => Promise<VerifiedRemoteHelperArtifact>;
  createHelperPaths?: typeof createRemoteHelperPaths;
  inspectHelper?: typeof inspectRemoteHelper;
  installHelper?: typeof installRemoteHelper;
  connectHelper?: typeof connectRemoteHelper;
  createSessionRuntime?(input: {
    executionTargetId: RemoteExecutionTargetId;
    platform: SystemInfo['platform'];
    defaultShell: string;
    ssh: ConnectedRemoteSshClient;
  }): RemoteSessionRuntime;
  providerPreferences?: ProviderPreferenceRepository;
  credentialPreferences?: RemoteCredentialPreferenceRepository;
  credentialVault?: RemoteCredentialVaultAccess;
  providerReleases?: ProviderReleaseSource;
  clock?: () => Date;
  createTargetId?: () => string;
}

export class RemoteTargetServiceError extends Error {
  constructor(
    readonly code: RemoteTargetErrorCode = 'REMOTE_TARGET_OPERATION_FAILED'
  ) {
    super('Lumora could not connect to the remote computer.');
    this.name = 'RemoteTargetServiceError';
  }
}

type RemoteConnectionStage =
  | 'ssh'
  | 'platform'
  | 'helper-bundle'
  | 'file-transfer'
  | 'helper-inspection';

function connectionFailureCode(
  stage: RemoteConnectionStage,
  error: unknown
): RemoteTargetErrorCode {
  if (stage === 'platform') return 'REMOTE_TARGET_PLATFORM_PROBE_FAILED';
  if (stage === 'helper-bundle') return 'REMOTE_TARGET_HELPER_BUNDLE_FAILED';
  if (stage === 'file-transfer') return 'REMOTE_TARGET_FILE_TRANSFER_FAILED';
  if (stage === 'helper-inspection') {
    return 'REMOTE_TARGET_HELPER_INSPECTION_FAILED';
  }
  if (error instanceof RemoteSshError) {
    if (
      error.code === 'AUTHENTICATION_MISMATCH' ||
      error.code === 'AUTHENTICATION_FAILED' ||
      error.code === 'SSH_AGENT_UNAVAILABLE'
    ) return 'REMOTE_TARGET_AUTHENTICATION_FAILED';
    if (error.code === 'HOST_KEY_CHANGED') {
      return 'REMOTE_TARGET_HOST_KEY_CHANGED';
    }
    if (error.code === 'SSH_TIMEOUT') return 'REMOTE_TARGET_SSH_TIMEOUT';
  }
  return 'REMOTE_TARGET_SSH_CONNECTION_FAILED';
}

export interface RemoteHelperInstallDetails {
  status: 'missing' | 'invalid';
  helperVersion: string;
  installLocation: string;
  requiresConfirmation: true;
}

interface ActiveRemoteTarget {
  generation: number;
  ssh: ConnectedRemoteSshClient;
  removeCloseListener: (() => void) | null;
  files: Awaited<ReturnType<ConnectedRemoteSshClient['openFileTransfer']>>;
  facts: RemotePlatformFacts;
  artifact: VerifiedRemoteHelperArtifact;
  paths: RemoteHelperPaths;
  inspection: RemoteHelperInspection;
  helper: ConnectedRemoteHelper | null;
  sessionRuntime: RemoteSessionRuntime | null;
  removeSessionRuntimeListener: (() => void) | null;
}

function stableRemoteCatalogId(...parts: string[]): string {
  return createHash('sha256').update(parts.join('\0')).digest('hex');
}

function remoteWorkspaceName(workspacePath: string): string {
  const segments = workspacePath.split(/[\\/]+/).filter(Boolean);
  return segments.at(-1) ?? workspacePath;
}

function normalizeRemoteCatalog(
  executionTargetId: RemoteExecutionTargetId,
  scannedAt: string,
  sessions: readonly {
    provider: ProviderId;
    nativeId: string;
    workspacePath: string;
    title: string;
    createdAt: string;
    updatedAt: string;
    lifetimeTokens: number | null;
  }[],
  providers: readonly {
    provider: ProviderId;
    status: 'ready' | 'unavailable' | 'unsupported' | 'failed';
    sessionCount: number;
    invalidCount: number;
  }[]
): CatalogSnapshot {
  const workspaceSessions = new Map<string, typeof sessions[number][]>();
  for (const session of sessions) {
    const entries = workspaceSessions.get(session.workspacePath) ?? [];
    entries.push(session);
    workspaceSessions.set(session.workspacePath, entries);
  }

  const workspaces = [...workspaceSessions.entries()].map(
    ([canonicalPath, entries]) => {
      const providerCounts: Partial<Record<ProviderId, number>> = {};
      for (const entry of entries) {
        providerCounts[entry.provider] = (providerCounts[entry.provider] ?? 0) + 1;
      }
      return {
        id: stableRemoteCatalogId(
          executionTargetId,
          'workspace',
          canonicalPath
        ),
        displayName: remoteWorkspaceName(canonicalPath),
        canonicalPath,
        available: true,
        origin: 'discovered' as const,
        sessionCount: entries.length,
        providerCounts,
        lastActivityAt: entries.reduce<string | null>(
          (latest, entry) => latest === null || entry.updatedAt > latest
            ? entry.updatedAt
            : latest,
          null
        )
      };
    }
  ).sort(
    (left, right) =>
      (right.lastActivityAt ?? '').localeCompare(left.lastActivityAt ?? '') ||
      left.canonicalPath.localeCompare(right.canonicalPath)
  );
  const workspaceIds = new Map(
    workspaces.map((workspace) => [workspace.canonicalPath, workspace.id])
  );

  return {
    refreshedAt: scannedAt,
    workspaces,
    sessions: sessions.map((session) => ({
      id: stableRemoteCatalogId(
        executionTargetId,
        session.provider,
        session.nativeId
      ),
      nativeId: session.nativeId,
      provider: session.provider,
      workspaceId: workspaceIds.get(session.workspacePath)!,
      title: session.title,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      lifetimeTokens: session.lifetimeTokens,
      lifecycle: 'saved' as const,
      sourceFreshness: 'current' as const
    })),
    providerStatus: providers.map((provider) => ({
      provider: provider.provider,
      state: provider.status === 'ready' ? 'ready' as const : 'unavailable' as const,
      discoveredCount: provider.sessionCount,
      unchangedCount: 0,
      invalidCount: provider.invalidCount
    })),
    providerFacets: providers
      .filter((provider) => provider.sessionCount > 0)
      .map((provider) => ({
        provider: provider.provider,
        sessionCount: provider.sessionCount
      })),
    diagnostics: providers
      .filter((provider) => provider.status !== 'ready')
      .map((provider) => ({
        code: 'CATALOG_PROVIDER_UNAVAILABLE' as const,
        provider: provider.provider,
        affectedCount: provider.sessionCount,
        message: provider.status === 'unsupported'
          ? `${providerDefinition(provider.provider).displayName} remote catalog support is pending.`
          : provider.status === 'failed'
            ? `${providerDefinition(provider.provider).displayName} remote catalog scan failed.`
            : `${providerDefinition(provider.provider).displayName} is unavailable on this remote computer.`,
        recovery: provider.status === 'unsupported'
          ? 'Use a provider with remote catalog support or check a future Lumora release.'
          : provider.status === 'failed'
            ? `Retry the scan or update ${providerDefinition(provider.provider).displayName} on the remote computer.`
            : 'Install or enable the provider on the remote computer, then refresh.',
        retryable: provider.status !== 'unsupported',
        scannedAt
      }))
  };
}

function remoteTarget(value: ExecutionTarget | null): RemoteTarget {
  if (value === null || value.kind !== 'remote') {
    throw new Error('The remote execution target does not exist.');
  }
  return value;
}

export function createRemoteTargetService({
  targets,
  profiles,
  ssh = createRemoteSshClient(),
  probePlatform: probe = probeRemotePlatform,
  resolveHelperArtifact = async () => {
    throw new Error('The packaged remote helper is unavailable.');
  },
  createHelperPaths = createRemoteHelperPaths,
  inspectHelper = inspectRemoteHelper,
  installHelper: performHelperInstall = installRemoteHelper,
  connectHelper = connectRemoteHelper,
  createSessionRuntime,
  providerPreferences = {
    get: () => [...PROVIDER_IDS],
    save: (_id, providers) => [...providers]
  },
  credentialPreferences = {
    getAutoConnect: () => false,
    setAutoConnect: () => {
      throw new Error('Remote credential preferences are unavailable.');
    }
  },
  credentialVault = {
    getStorageState: async () => 'unavailable' as const,
    getCredentialState: () => 'none' as const,
    save: async () => {
      throw new Error('Remote credential storage is unavailable.');
    },
    resolve: async () => null,
    forget: () => undefined
  },
  providerReleases = {
    latestVersion: async () => {
      throw new Error('Provider release metadata is unavailable.');
    }
  },
  clock = () => new Date(),
  createTargetId = () => randomUUID()
}: CreateRemoteTargetServiceOptions) {
  const activeTargets = new Map<RemoteExecutionTargetId, ActiveRemoteTarget>();
  const providerUpdateServices = new Map<
    RemoteExecutionTargetId,
    ProviderUpdateService
  >();
  const sessionRuntimeListeners = new Set<(
    executionTargetId: RemoteExecutionTargetId,
    event: RuntimeEvent
  ) => void>();
  let closed = false;

  const disposeActive = async (
    active: ActiveRemoteTarget | undefined
  ): Promise<void> => {
    if (active === undefined) return;
    active.removeCloseListener?.();
    active.removeCloseListener = null;
    active.helper?.close();
    active.helper = null;
    active.removeSessionRuntimeListener?.();
    active.removeSessionRuntimeListener = null;
    const sessionRuntime = active.sessionRuntime;
    active.sessionRuntime = null;
    try {
      await sessionRuntime?.shutdown();
    } catch {
      // Resource closure below is authoritative even if graceful PTY shutdown fails.
    } finally {
      sessionRuntime?.close();
      active.files.close();
      active.ssh.close();
    }
  };

  const summary = (id: RemoteExecutionTargetId): RemoteTargetSummary => {
    const target = remoteTarget(targets.get(id));
    const profile = profiles.get(id);
    if (profile === null) {
      throw new Error('The remote connection profile does not exist.');
    }
    return { target, profile };
  };
  const lifecycle = createRemoteLifecycleStore({ getSummary: summary });
  const pendingDiscoveryScans = new Map<RemoteExecutionTargetId, {
    generation: number;
    promise: Promise<RemoteDiscoverySnapshot>;
  }>();
  const pendingCatalogScans = new Map<RemoteExecutionTargetId, {
    generation: number;
    promise: Promise<RemoteSessionCatalog>;
  }>();

  const credentialStatus = async (
    id: RemoteExecutionTargetId
  ): Promise<RemoteCredentialStatus> => ({
    executionTargetId: id,
    storageState: await credentialVault.getStorageState(),
    credentialState: credentialVault.getCredentialState(id),
    autoConnect: credentialPreferences.getAutoConnect(id)
  });

  const resolveCredentials = async (
    id: RemoteExecutionTargetId,
    profile: RemoteConnectionProfile,
    input: RemoteConnectionInput
  ): Promise<{
    credentials: RemoteTargetCredentials;
    rememberCredential: boolean;
  }> => {
    if (!('mode' in input)) {
      return {
        credentials: RemoteTargetCredentialsSchema.parse(input),
        rememberCredential: false
      };
    }
    if (input.mode === 'manual') {
      return {
        credentials: RemoteTargetCredentialsSchema.parse(input.credentials),
        rememberCredential: input.rememberCredential
      };
    }
    if (
      input.mode === 'automatic' &&
      !credentialPreferences.getAutoConnect(id)
    ) {
      throw new RemoteTargetServiceError('REMOTE_TARGET_CREDENTIAL_REQUIRED');
    }
    if (profile.authentication.method === 'agent') {
      return { credentials: { method: 'agent' }, rememberCredential: false };
    }
    if (profile.authentication.method === 'private-key') {
      return {
        credentials: {
          method: 'private-key',
          passphrase: await credentialVault.resolve(
            id,
            'private-key-passphrase'
          )
        },
        rememberCredential: false
      };
    }
    const password = await credentialVault.resolve(id, 'password');
    if (password === null) {
      throw new RemoteTargetServiceError('REMOTE_TARGET_CREDENTIAL_REQUIRED');
    }
    return {
      credentials: { method: 'password', password },
      rememberCredential: false
    };
  };

  const disconnect = async (
    input: RemoteExecutionTargetId
  ): Promise<RemoteTargetSummary> => {
    const id = RemoteExecutionTargetIdSchema.parse(input);
    const active = activeTargets.get(id);
    activeTargets.delete(id);
    providerUpdateServices.delete(id);
    await disposeActive(active);
    targets.updateRemoteConnection(id, { connectionState: 'offline' });
    lifecycle.invalidateConnection(id);
    return summary(id);
  };

  const connectionDetails = (
    id: RemoteExecutionTargetId,
    facts: RemotePlatformFacts
  ): RemoteTargetConnectionDetails => ({
    ...summary(id),
    homeDirectory: facts.homeDirectory,
    defaultShell: facts.defaultShell
  });

  const activateHelper = async (
    id: RemoteExecutionTargetId,
    active: ActiveRemoteTarget
  ): Promise<RemoteTargetConnectionDetails> => {
    const channel = await active.ssh.openExec(
      helperLaunchCommand(active.paths, active.artifact.platform, {
        homeDirectory: active.facts.homeDirectory,
        defaultShell: active.facts.defaultShell
      })
    );
    const helper = await connectHelper({
      channel,
      generation: active.generation,
      expectedPlatform: active.artifact.platform,
      expectedArchitecture: active.artifact.architecture
    });
    active.helper = helper;
    active.sessionRuntime ??= createSessionRuntime?.({
      executionTargetId: id,
      platform: active.artifact.platform,
      defaultShell: active.facts.defaultShell,
      ssh: active.ssh
    }) ?? null;
    if (
      active.sessionRuntime !== null &&
      active.removeSessionRuntimeListener === null
    ) {
      active.removeSessionRuntimeListener = active.sessionRuntime.subscribe((event) => {
        if (event.type === 'state') {
          const activeTerminalCount = active.sessionRuntime?.listRuntimes()
            .filter((runtime) =>
              runtime.state === 'launching' || runtime.state === 'running'
            ).length ?? 0;
          lifecycle.setActiveTerminalCount(id, activeTerminalCount);
        }
        for (const listener of sessionRuntimeListeners) {
          try {
            listener(id, event);
          } catch {
            // Runtime delivery must isolate consumer failures.
          }
        }
      });
    }
    const supportedCapabilities = helper.info.capabilities.filter(
      (capability): capability is RemoteTarget['capabilities'][number] =>
        capability !== 'system-info'
    );
    targets.updateRemoteConnection(id, {
      connectionState: 'ready',
      platform: active.facts.platform,
      architecture: active.facts.architecture,
      helperVersion: helper.info.helperVersion,
      protocolVersion: helper.info.protocolVersion,
      capabilities: supportedCapabilities,
      lastConnectedAt: clock().toISOString()
    });
    lifecycle.refreshSummary(id);
    return connectionDetails(id, active.facts);
  };

  const normalizeDiscovery = (
    id: RemoteExecutionTargetId,
    result: Awaited<ReturnType<ConnectedRemoteHelper['scanDiscovery']>>,
    enabledProviders: readonly (typeof PROVIDER_IDS)[number][]
  ) => {
    if (
      result.providers.length !== enabledProviders.length ||
      result.providers.some(
        ({ provider }, index) => provider !== enabledProviders[index]
      )
    ) throw new RemoteTargetServiceError();

    const providers = result.providers.map((probe) => {
      const definition = providerDefinition(probe.provider);
      if (probe.state === 'ready') {
        return {
          ...probe,
          displayName: definition.displayName,
          issue: null
        } as const;
      }
      if (probe.state === 'not_found') {
        return {
          ...probe,
          displayName: definition.displayName,
          issue: {
            code: 'PROVIDER_NOT_FOUND' as const,
            message: `${definition.displayName} was not found on PATH.`,
            recovery:
              `Install ${definition.displayName} on the remote computer, then refresh.`,
            retryable: true
          }
        } as const;
      }
      return {
        ...probe,
        displayName: definition.displayName,
        issue: {
          code: 'PROVIDER_VERSION_PROBE_FAILED' as const,
          message:
            `Lumora found ${definition.displayName} but could not read its version.`,
          recovery:
            `Check ${definition.displayName} on the remote computer, then refresh.`,
          retryable: true
        }
      } as const;
    });
    return RemoteDiscoverySnapshotSchema.parse({
      executionTargetId: id,
      scannedAt: result.checkedAt,
      environment: {
        checkedAt: result.checkedAt,
        node: result.node,
        npm: result.npm
      },
      providers: {
        scannedAt: result.checkedAt,
        providers
      }
    });
  };

  const scanDiscovery = async (input: RemoteExecutionTargetId) => {
    const id = RemoteExecutionTargetIdSchema.parse(input);
    const active = activeTargets.get(id);
    if (
      active?.helper === null || active === undefined ||
      !active.helper.info.capabilities.includes('provider-scan')
    ) throw new RemoteTargetServiceError();
    const pending = pendingDiscoveryScans.get(id);
    if (pending?.generation === active.generation) return pending.promise;
    const enabledProviders = providerPreferences.get(id);
    const generation = active.generation;
    const helper = active.helper;
    lifecycle.beginDiscovery(id, generation);
    let promise!: Promise<RemoteDiscoverySnapshot>;
    promise = (async () => {
      try {
        const result = normalizeDiscovery(
          id,
          await helper.scanDiscovery(enabledProviders),
          enabledProviders
        );
        targets.updateRemoteConnection(id, {
          lastScannedAt: result.scannedAt
        });
        lifecycle.completeDiscovery(id, generation, result);
        return result;
      } catch (error) {
        lifecycle.failDiscovery(id, generation);
        if (error instanceof RemoteTargetServiceError) throw error;
        throw new RemoteTargetServiceError();
      } finally {
        if (pendingDiscoveryScans.get(id)?.promise === promise) {
          pendingDiscoveryScans.delete(id);
        }
      }
    })();
    pendingDiscoveryScans.set(id, { generation, promise });
    return promise;
  };

  const providerUpdatesFor = (
    id: RemoteExecutionTargetId
  ): ProviderUpdateService => {
    const existing = providerUpdateServices.get(id);
    if (existing !== undefined) return existing;

    const service = createProviderUpdateService({
      registry: {
        scan: async () => (await scanDiscovery(id)).providers,
        scanFresh: async () => (await scanDiscovery(id)).providers
      },
      enabledProviders: () => providerPreferences.get(id),
      releases: providerReleases,
      runLifecycle: async (provider, action) => {
        const active = activeTargets.get(id);
        if (
          active?.helper === null || active === undefined ||
          !active.helper.info.capabilities.includes('provider-lifecycle')
        ) throw new RemoteTargetServiceError();
        const result = await active.helper.runProviderLifecycle(provider, action);
        if (result.provider !== provider || result.action !== action) {
          throw new RemoteTargetServiceError();
        }
      },
      now: clock
    });
    providerUpdateServices.set(id, service);
    return service;
  };

  const scanProviderSessions = async (
    helper: ConnectedRemoteHelper,
    provider: ProviderId
  ) => {
    const sessions = new Map<string, {
      provider: ProviderId;
      nativeId: string;
      workspacePath: string;
      title: string;
      createdAt: string;
      updatedAt: string;
      lifetimeTokens: number | null;
    }>();
    const seenCursors = new Set<string>();
    let cursor: string | null = null;
    let invalidCount = 0;
    let status: 'ready' | 'unavailable' | 'unsupported' | 'failed' = 'ready';

    for (let page = 0; page < 250; page += 1) {
      const result = await helper.scanSessionPage(provider, cursor, 100);
      if (result.provider !== provider) throw new RemoteTargetServiceError();
      status = result.status;
      invalidCount = Math.max(invalidCount, result.invalidCount);
      if (result.status !== 'ready') {
        if (cursor !== null || result.sessions.length !== 0) {
          throw new RemoteTargetServiceError();
        }
        break;
      }
      for (const session of result.sessions) {
        const normalized = {
          provider,
          nativeId: session.nativeId,
          workspacePath: session.workspacePath,
          title: session.title,
          createdAt: session.createdAt,
          updatedAt: session.updatedAt,
          lifetimeTokens: session.lifetimeTokens
        };
        const existing = sessions.get(session.nativeId);
        if (
          existing === undefined ||
          normalized.updatedAt > existing.updatedAt ||
          (normalized.updatedAt === existing.updatedAt &&
            normalized.title > existing.title)
        ) {
          sessions.set(session.nativeId, normalized);
        }
      }
      if (sessions.size > 25_000) throw new RemoteTargetServiceError();
      if (result.nextCursor === null) break;
      if (seenCursors.has(result.nextCursor)) throw new RemoteTargetServiceError();
      seenCursors.add(result.nextCursor);
      cursor = result.nextCursor;
      if (page === 249) throw new RemoteTargetServiceError();
    }

    const ordered = [...sessions.values()].sort(
      (left, right) =>
        right.updatedAt.localeCompare(left.updatedAt) ||
        left.nativeId.localeCompare(right.nativeId)
    );
    return {
      sessions: ordered,
      provider: {
        provider,
        status,
        sessionCount: ordered.length,
        invalidCount
      }
    };
  };

  return {
    list(): RemoteTargetSummary[] {
      return profiles.list().map((profile) => ({
        target: remoteTarget(targets.get(profile.executionTargetId)),
        profile
      }));
    },

    get(input: RemoteExecutionTargetId): RemoteTargetSummary {
      return summary(RemoteExecutionTargetIdSchema.parse(input));
    },

    listLifecycleSnapshots() {
      return lifecycle.list(
        profiles.list().map(({ executionTargetId }) => executionTargetId)
      );
    },

    getLifecycleSnapshot(input: RemoteExecutionTargetId) {
      return lifecycle.snapshot(RemoteExecutionTargetIdSchema.parse(input));
    },

    subscribeLifecycle: lifecycle.subscribe,

    async getCredentialStatus(
      input: RemoteExecutionTargetId
    ): Promise<RemoteCredentialStatus> {
      const id = RemoteExecutionTargetIdSchema.parse(input);
      summary(id);
      return credentialStatus(id);
    },

    async setAutoConnect(
      input: RemoteExecutionTargetId,
      enabled: boolean
    ): Promise<RemoteCredentialStatus> {
      const id = RemoteExecutionTargetIdSchema.parse(input);
      const profile = summary(id).profile;
      if (
        enabled &&
        profile.authentication.method === 'password' &&
        credentialVault.getCredentialState(id) !== 'remembered'
      ) {
        throw new RemoteTargetServiceError('REMOTE_TARGET_CREDENTIAL_REQUIRED');
      }
      credentialPreferences.setAutoConnect(id, enabled);
      return credentialStatus(id);
    },

    async forgetCredential(
      input: RemoteExecutionTargetId
    ): Promise<RemoteCredentialStatus> {
      const id = RemoteExecutionTargetIdSchema.parse(input);
      const profile = summary(id).profile;
      credentialVault.forget(id);
      if (profile.authentication.method === 'password') {
        credentialPreferences.setAutoConnect(id, false);
      }
      return credentialStatus(id);
    },

    create(input: RemoteConnectionProfileInput): RemoteTargetSummary {
      const profile = RemoteConnectionProfileInputSchema.parse(input);
      const id = RemoteExecutionTargetIdSchema.parse(createTargetId());
      targets.createRemote({ id, displayName: profile.displayName });
      try {
        profiles.save(id, profile, clock());
      } catch (error) {
        targets.deleteRemote(id);
        throw error;
      }
      return summary(id);
    },

    async update(
      input: RemoteExecutionTargetId,
      profileInput: RemoteConnectionProfileInput
    ): Promise<RemoteTargetSummary> {
      const id = RemoteExecutionTargetIdSchema.parse(input);
      const profile = RemoteConnectionProfileInputSchema.parse(profileInput);
      const formerProfile = summary(id).profile;
      const active = activeTargets.get(id);
      activeTargets.delete(id);
      providerUpdateServices.delete(id);
      await disposeActive(active);
      targets.updateRemoteConnection(id, { connectionState: 'offline' });
      profiles.save(id, profile, clock());
      lifecycle.invalidateConnection(id);
      if (formerProfile.authentication.method !== profile.authentication.method) {
        credentialVault.forget(id);
        credentialPreferences.setAutoConnect(id, false);
      }
      return summary(id);
    },

    async remove(input: RemoteExecutionTargetId): Promise<void> {
      const id = RemoteExecutionTargetIdSchema.parse(input);
      const active = activeTargets.get(id);
      activeTargets.delete(id);
      providerUpdateServices.delete(id);
      await disposeActive(active);
      credentialVault.forget(id);
      targets.deleteRemote(id);
    },

    observeHostKey(input: RemoteExecutionTargetId) {
      const id = RemoteExecutionTargetIdSchema.parse(input);
      return ssh.observeHostKey(summary(id).profile);
    },

    trustHostKey(input: RemoteExecutionTargetId, fingerprint: string) {
      const id = RemoteExecutionTargetIdSchema.parse(input);
      profiles.trustHostKey(id, fingerprint, clock());
      return summary(id);
    },

    async connect(
      input: RemoteExecutionTargetId,
      connectionInput: RemoteConnectionInput
    ): Promise<RemoteTargetConnectionDetails> {
      const id = RemoteExecutionTargetIdSchema.parse(input);
      const profile = summary(id).profile;
      let resolved: Awaited<ReturnType<typeof resolveCredentials>>;
      try {
        resolved = await resolveCredentials(id, profile, connectionInput);
      } catch (error) {
        if (error instanceof RemoteTargetServiceError) throw error;
        throw new RemoteTargetServiceError('REMOTE_TARGET_CREDENTIAL_UNAVAILABLE');
      }
      const { credentials, rememberCredential } = resolved;
      const former = activeTargets.get(id);
      activeTargets.delete(id);
      providerUpdateServices.delete(id);
      await disposeActive(former);
      targets.updateRemoteConnection(id, { connectionState: 'connecting' });
      const generation = lifecycle.beginConnection(id);
      let connected: ConnectedRemoteSshClient | null = null;
      let files: ActiveRemoteTarget['files'] | null = null;
      let stage: RemoteConnectionStage = 'ssh';
      try {
        targets.updateRemoteConnection(id, { connectionState: 'authenticating' });
        lifecycle.refreshSummary(id);
        connected = await ssh.connect(profile, credentials);
        if ('mode' in connectionInput && connectionInput.mode === 'manual') {
          try {
            if (
              rememberCredential &&
              credentials.method === 'password'
            ) {
              await credentialVault.save(id, 'password', credentials.password);
            } else if (
              rememberCredential &&
              credentials.method === 'private-key' &&
              credentials.passphrase !== null &&
              credentials.passphrase.length > 0
            ) {
              await credentialVault.save(
                id,
                'private-key-passphrase',
                credentials.passphrase
              );
            } else {
              credentialVault.forget(id);
              if (credentials.method === 'password') {
                credentialPreferences.setAutoConnect(id, false);
              }
            }
          } catch {
            // Credential storage is optional and must not tear down a valid SSH session.
          }
        }
        stage = 'platform';
        const facts = await probe(connected.execute);
        if (
          facts.platform === 'unknown' ||
          facts.architecture === 'unknown'
        ) throw new Error('Unsupported remote helper target.');
        stage = 'helper-bundle';
        const artifact = await resolveHelperArtifact(facts);
        const paths = createHelperPaths({
          platform: facts.platform,
          baseDirectory: facts.helperBaseDirectory,
          helperVersion: artifact.helperVersion,
          temporaryId: randomUUID()
        });
        stage = 'file-transfer';
        files = await connected.openFileTransfer();
        stage = 'helper-inspection';
        const inspection = await inspectHelper({
          files,
          execute: connected.execute,
          paths,
          artifact
        });
        const active: ActiveRemoteTarget = {
          generation,
          ssh: connected,
          removeCloseListener: null,
          files,
          facts,
          artifact,
          paths,
          inspection,
          helper: null,
          sessionRuntime: null,
          removeSessionRuntimeListener: null
        };
        activeTargets.set(id, active);
        active.removeCloseListener = connected.onClose(() => {
          if (activeTargets.get(id) !== active) return;
          activeTargets.delete(id);
          providerUpdateServices.delete(id);
          active.removeCloseListener?.();
          active.removeCloseListener = null;
          active.helper?.close();
          active.helper = null;
          active.removeSessionRuntimeListener?.();
          active.removeSessionRuntimeListener = null;
          active.sessionRuntime?.close();
          active.sessionRuntime = null;
          active.files.close();
          targets.updateRemoteConnection(id, { connectionState: 'offline' });
          lifecycle.invalidateConnection(id);
        });
        targets.updateRemoteConnection(id, {
          connectionState: inspection.status === 'missing'
            ? 'helper-missing'
            : inspection.status === 'invalid'
              ? 'helper-incompatible'
              : 'authenticating',
          platform: facts.platform,
          architecture: facts.architecture,
          helperVersion: null,
          protocolVersion: null,
          capabilities: [],
          lastConnectedAt: clock().toISOString()
        });
        lifecycle.refreshSummary(id);
        if (inspection.status !== 'installed') {
          return connectionDetails(id, facts);
        }
        try {
          return await activateHelper(id, active);
        } catch {
          active.inspection = { status: 'invalid', paths };
          targets.updateRemoteConnection(id, {
            connectionState: 'helper-incompatible'
          });
          lifecycle.refreshSummary(id);
          return connectionDetails(id, facts);
        }
      } catch (error) {
        files?.close();
        connected?.close();
        targets.updateRemoteConnection(id, { connectionState: 'error' });
        lifecycle.invalidateConnection(id);
        throw new RemoteTargetServiceError(connectionFailureCode(stage, error));
      }
    },

    getHelperInstallDetails(input: RemoteExecutionTargetId): RemoteHelperInstallDetails {
      const id = RemoteExecutionTargetIdSchema.parse(input);
      const active = activeTargets.get(id);
      if (active === undefined || active.inspection.status === 'installed') {
        throw new RemoteTargetServiceError();
      }
      return {
        status: active.inspection.status,
        helperVersion: active.artifact.helperVersion,
        installLocation: active.paths.executablePath,
        requiresConfirmation: true
      };
    },

    async installHelper(
      input: RemoteExecutionTargetId
    ): Promise<RemoteTargetConnectionDetails> {
      const id = RemoteExecutionTargetIdSchema.parse(input);
      const active = activeTargets.get(id);
      if (active === undefined || active.inspection.status === 'installed') {
        throw new RemoteTargetServiceError();
      }
      try {
        await performHelperInstall({
          files: active.files,
          execute: active.ssh.execute,
          paths: active.paths,
          artifact: active.artifact,
          replaceExisting: active.inspection.status === 'invalid'
        });
        active.inspection = { status: 'installed', paths: active.paths };
        return await activateHelper(id, active);
      } catch {
        targets.updateRemoteConnection(id, {
          connectionState: 'helper-incompatible'
        });
        lifecycle.refreshSummary(id);
        throw new RemoteTargetServiceError();
      }
    },

    getProviderPreferences(input: RemoteExecutionTargetId) {
      const id = RemoteExecutionTargetIdSchema.parse(input);
      summary(id);
      return RemoteProviderPreferencesSchema.parse({
        enabledProviders: providerPreferences.get(id)
      });
    },

    saveProviderPreferences(
      input: RemoteExecutionTargetId,
      preferencesInput: unknown
    ) {
      const id = RemoteExecutionTargetIdSchema.parse(input);
      summary(id);
      const preferences = RemoteProviderPreferencesSchema.parse(
        preferencesInput
      );
      return RemoteProviderPreferencesSchema.parse({
        enabledProviders: providerPreferences.save(
          id,
          preferences.enabledProviders,
          clock()
        )
      });
    },

    scanDiscovery,

    checkProviderUpdates(input: RemoteExecutionTargetId) {
      const id = RemoteExecutionTargetIdSchema.parse(input);
      return providerUpdatesFor(id).check();
    },

    installProvider(
      input: RemoteExecutionTargetId,
      providerInput: ProviderId
    ) {
      const id = RemoteExecutionTargetIdSchema.parse(input);
      const provider = ProviderIdSchema.parse(providerInput);
      return providerUpdatesFor(id).install(provider);
    },

    updateProvider(
      input: RemoteExecutionTargetId,
      providerInput: ProviderId
    ) {
      const id = RemoteExecutionTargetIdSchema.parse(input);
      const provider = ProviderIdSchema.parse(providerInput);
      return providerUpdatesFor(id).update(provider);
    },

    async scanSessions(input: RemoteExecutionTargetId) {
      const id = RemoteExecutionTargetIdSchema.parse(input);
      const active = activeTargets.get(id);
      if (
        active?.helper === null || active === undefined ||
        !active.helper.info.capabilities.includes('session-scan')
      ) throw new RemoteTargetServiceError();
      const pending = pendingCatalogScans.get(id);
      if (pending?.generation === active.generation) return pending.promise;
      const enabled = new Set(providerPreferences.get(id));
      const providers = SESSION_PROVIDER_IDS.filter((provider) => enabled.has(provider));
      const generation = active.generation;
      const helper = active.helper;
      lifecycle.beginCatalog(id, generation);
      let promise!: Promise<RemoteSessionCatalog>;
      promise = (async () => {
        try {
          const results: Awaited<ReturnType<typeof scanProviderSessions>>[] = [];
          for (let index = 0; index < providers.length; index += 1) {
            const provider = providers[index]!;
            try {
              results.push(await scanProviderSessions(helper, provider));
            } catch (error) {
              if (!(error instanceof RemoteHelperConnectionError) ||
                error.code === 'HELPER_INCOMPATIBLE') {
                throw error;
              }
              results.push({
                sessions: [],
                provider: {
                  provider, status: 'failed', sessionCount: 0, invalidCount: 0
                }
              });
              if (error.code === 'HELPER_TIMEOUT') {
                for (const pendingProvider of providers.slice(index + 1)) {
                  results.push({
                    sessions: [],
                    provider: {
                      provider: pendingProvider,
                      status: 'failed', sessionCount: 0, invalidCount: 0
                    }
                  });
                }
                break;
              }
            }
          }
          const scannedAt = clock().toISOString();
          const sessions = results
            .flatMap((result) => result.sessions)
            .sort(
              (left, right) =>
                right.updatedAt.localeCompare(left.updatedAt) ||
                left.provider.localeCompare(right.provider) ||
                left.nativeId.localeCompare(right.nativeId)
            );
          const providerStatus = results.map((result) => result.provider);
          const catalog = RemoteSessionCatalogSchema.parse({
            executionTargetId: id,
            scannedAt,
            sessions,
            providers: providerStatus,
            snapshot: normalizeRemoteCatalog(id, scannedAt, sessions, providerStatus)
          });
          active.sessionRuntime?.updateCatalog(catalog);
          targets.updateRemoteConnection(id, { lastScannedAt: scannedAt });
          lifecycle.completeCatalog(id, generation, catalog);
          return catalog;
        } catch (error) {
          lifecycle.failCatalog(id, generation);
          if (error instanceof RemoteTargetServiceError) throw error;
          throw new RemoteTargetServiceError();
        } finally {
          if (pendingCatalogScans.get(id)?.promise === promise) {
            pendingCatalogScans.delete(id);
          }
        }
      })();
      pendingCatalogScans.set(id, { generation, promise });
      return promise;
    },

    resolveSessionRuntime(input: RemoteExecutionTargetId) {
      const id = RemoteExecutionTargetIdSchema.parse(input);
      const runtime = activeTargets.get(id)?.sessionRuntime ?? null;
      if (runtime === null) throw new RemoteTargetServiceError();
      return runtime;
    },

    subscribeSessionRuntimeEvents(listener: (
      executionTargetId: RemoteExecutionTargetId,
      event: RuntimeEvent
    ) => void) {
      sessionRuntimeListeners.add(listener);
      return () => sessionRuntimeListeners.delete(listener);
    },

    disconnect,

    async close(): Promise<void> {
      if (closed) return;
      closed = true;
      const disposing: Promise<void>[] = [];
      for (const [id, active] of activeTargets) {
        disposing.push(disposeActive(active));
        targets.updateRemoteConnection(id, { connectionState: 'offline' });
        lifecycle.invalidateConnection(id);
      }
      activeTargets.clear();
      providerUpdateServices.clear();
      pendingDiscoveryScans.clear();
      pendingCatalogScans.clear();
      sessionRuntimeListeners.clear();
      await Promise.allSettled(disposing);
    }
  };
}

export type RemoteTargetService = ReturnType<typeof createRemoteTargetService>;
