import { randomUUID } from 'node:crypto';

import {
  RemoteConnectionProfileInputSchema,
  RemoteExecutionTargetIdSchema,
  RemoteTargetCredentialsSchema,
  type ExecutionTarget,
  type RemoteConnectionProfile,
  type RemoteConnectionProfileInput,
  type RemoteExecutionTargetId,
  type RemoteTargetCredentials
} from '../../shared/contracts';
import type { RemotePlatformFacts } from './platform-probe';
import { probeRemotePlatform } from './platform-probe';
import {
  connectRemoteHelper,
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
  clock?: () => Date;
  createTargetId?: () => string;
}

export class RemoteTargetServiceError extends Error {
  readonly code = 'REMOTE_TARGET_CONNECTION_FAILED';

  constructor() {
    super('Lumora could not connect to the remote computer.');
    this.name = 'RemoteTargetServiceError';
  }
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
  files: Awaited<ReturnType<ConnectedRemoteSshClient['openFileTransfer']>>;
  facts: RemotePlatformFacts;
  artifact: VerifiedRemoteHelperArtifact;
  paths: RemoteHelperPaths;
  inspection: RemoteHelperInspection;
  helper: ConnectedRemoteHelper | null;
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
  clock = () => new Date(),
  createTargetId = () => randomUUID()
}: CreateRemoteTargetServiceOptions) {
  const activeTargets = new Map<RemoteExecutionTargetId, ActiveRemoteTarget>();
  let nextGeneration = 1;
  let closed = false;

  const disposeActive = (active: ActiveRemoteTarget | undefined) => {
    if (active === undefined) return;
    active.helper?.close();
    active.files.close();
    active.ssh.close();
  };

  const summary = (id: RemoteExecutionTargetId): RemoteTargetSummary => {
    const target = remoteTarget(targets.get(id));
    const profile = profiles.get(id);
    if (profile === null) {
      throw new Error('The remote connection profile does not exist.');
    }
    return { target, profile };
  };

  const disconnect = (input: RemoteExecutionTargetId): RemoteTargetSummary => {
    const id = RemoteExecutionTargetIdSchema.parse(input);
    const active = activeTargets.get(id);
    activeTargets.delete(id);
    disposeActive(active);
    targets.updateRemoteConnection(id, { connectionState: 'offline' });
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
      helperLaunchCommand(active.paths, active.artifact.platform)
    );
    const helper = await connectHelper({
      channel,
      generation: active.generation,
      expectedPlatform: active.artifact.platform,
      expectedArchitecture: active.artifact.architecture
    });
    active.helper = helper;
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
    return connectionDetails(id, active.facts);
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

    update(
      input: RemoteExecutionTargetId,
      profileInput: RemoteConnectionProfileInput
    ): RemoteTargetSummary {
      const id = RemoteExecutionTargetIdSchema.parse(input);
      const profile = RemoteConnectionProfileInputSchema.parse(profileInput);
      profiles.save(id, profile, clock());
      return summary(id);
    },

    remove(input: RemoteExecutionTargetId): void {
      const id = RemoteExecutionTargetIdSchema.parse(input);
      const active = activeTargets.get(id);
      activeTargets.delete(id);
      disposeActive(active);
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
      credentialsInput: RemoteTargetCredentials
    ): Promise<RemoteTargetConnectionDetails> {
      const id = RemoteExecutionTargetIdSchema.parse(input);
      const credentials = RemoteTargetCredentialsSchema.parse(credentialsInput);
      const profile = summary(id).profile;
      const former = activeTargets.get(id);
      activeTargets.delete(id);
      disposeActive(former);
      targets.updateRemoteConnection(id, { connectionState: 'connecting' });
      let connected: ConnectedRemoteSshClient | null = null;
      let files: ActiveRemoteTarget['files'] | null = null;
      try {
        targets.updateRemoteConnection(id, { connectionState: 'authenticating' });
        connected = await ssh.connect(profile, credentials);
        const facts = await probe(connected.execute);
        if (
          facts.platform === 'unknown' ||
          facts.architecture === 'unknown'
        ) throw new Error('Unsupported remote helper target.');
        const artifact = await resolveHelperArtifact(facts);
        const paths = createHelperPaths({
          platform: facts.platform,
          baseDirectory: facts.helperBaseDirectory,
          helperVersion: artifact.helperVersion,
          temporaryId: randomUUID()
        });
        files = await connected.openFileTransfer();
        const inspection = await inspectHelper({
          files,
          execute: connected.execute,
          paths,
          artifact
        });
        const active: ActiveRemoteTarget = {
          generation: nextGeneration++,
          ssh: connected,
          files,
          facts,
          artifact,
          paths,
          inspection,
          helper: null
        };
        activeTargets.set(id, active);
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
          return connectionDetails(id, facts);
        }
      } catch {
        files?.close();
        connected?.close();
        targets.updateRemoteConnection(id, { connectionState: 'error' });
        throw new RemoteTargetServiceError();
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
        throw new RemoteTargetServiceError();
      }
    },

    disconnect,

    close(): void {
      if (closed) return;
      closed = true;
      for (const [id, active] of activeTargets) {
        disposeActive(active);
        targets.updateRemoteConnection(id, { connectionState: 'offline' });
      }
      activeTargets.clear();
    }
  };
}

export type RemoteTargetService = ReturnType<typeof createRemoteTargetService>;
