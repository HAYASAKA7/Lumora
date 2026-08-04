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
  clock = () => new Date(),
  createTargetId = () => randomUUID()
}: CreateRemoteTargetServiceOptions) {
  const clients = new Map<RemoteExecutionTargetId, ConnectedRemoteSshClient>();
  let closed = false;

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
    const client = clients.get(id);
    if (client !== undefined) {
      clients.delete(id);
      client.close();
    }
    targets.updateRemoteConnection(id, { connectionState: 'offline' });
    return summary(id);
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
      const client = clients.get(id);
      if (client !== undefined) {
        clients.delete(id);
        client.close();
      }
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
      const former = clients.get(id);
      if (former !== undefined) {
        clients.delete(id);
        former.close();
      }
      targets.updateRemoteConnection(id, { connectionState: 'connecting' });
      let connected: ConnectedRemoteSshClient | null = null;
      try {
        targets.updateRemoteConnection(id, { connectionState: 'authenticating' });
        connected = await ssh.connect(profile, credentials);
        const facts = await probe(connected.execute);
        clients.set(id, connected);
        const target = remoteTarget(targets.updateRemoteConnection(id, {
          connectionState: 'ready',
          platform: facts.platform,
          architecture: facts.architecture,
          lastConnectedAt: clock().toISOString()
        }));
        return {
          target,
          profile: profiles.get(id)!,
          homeDirectory: facts.homeDirectory,
          defaultShell: facts.defaultShell
        };
      } catch {
        connected?.close();
        targets.updateRemoteConnection(id, { connectionState: 'error' });
        throw new RemoteTargetServiceError();
      }
    },

    disconnect,

    close(): void {
      if (closed) return;
      closed = true;
      for (const [id, client] of clients) {
        client.close();
        targets.updateRemoteConnection(id, { connectionState: 'offline' });
      }
      clients.clear();
    }
  };
}

export type RemoteTargetService = ReturnType<typeof createRemoteTargetService>;
