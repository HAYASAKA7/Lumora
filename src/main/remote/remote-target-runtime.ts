import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';

import { ExecutionTargetRepository } from '../storage/execution-target-repository';
import { migrateCatalogDatabase } from '../storage/migrations';
import { RemoteConnectionProfileRepository } from '../storage/remote-connection-profile-repository';
import { RemoteCredentialRepository } from '../storage/remote-credential-repository';
import { RemoteProviderPreferenceRepository } from '../storage/remote-provider-preference-repository';
import type { RemotePlatformFacts } from './platform-probe';
import { resolveRemoteHelperArtifact } from './helper-artifact-resolver';
import type { ConnectedRemoteSshClient } from './ssh-client';
import { createRemoteSessionRuntime } from './remote-session-runtime';
import type { ProviderReleaseSource } from '../providers/provider-release-source';
import {
  RemoteCredentialVault,
  type RemoteCredentialEncryptionBackend
} from './remote-credential-vault';
import {
  createRemoteTargetService,
  type RemoteTargetService
} from './remote-target-service';

interface CreateRemoteTargetRuntimeOptions {
  databasePath: string;
  clock?: () => Date;
  createTargetId?: () => string;
  ssh?: Parameters<typeof createRemoteTargetService>[0]['ssh'];
  probePlatform?: (
    execute: ConnectedRemoteSshClient['execute']
  ) => Promise<RemotePlatformFacts>;
  helperBundleRoot?: string;
  providerReleases?: ProviderReleaseSource;
  credentialEncryption?: RemoteCredentialEncryptionBackend;
}

export interface RemoteTargetRuntime {
  service: RemoteTargetService;
  close(): Promise<void>;
}

export function createRemoteTargetRuntime({
  databasePath,
  clock,
  createTargetId,
  ssh,
  probePlatform,
  providerReleases,
  credentialEncryption,
  helperBundleRoot = join(process.cwd(), 'resources', 'helper', 'generated')
}: CreateRemoteTargetRuntimeOptions): RemoteTargetRuntime {
  const database = new DatabaseSync(databasePath);
  try {
    migrateCatalogDatabase(database);
  } catch (error) {
    database.close();
    throw error;
  }
  const targets = new ExecutionTargetRepository(database);
  targets.resetRemoteConnectionStates();
  const profiles = new RemoteConnectionProfileRepository(database);
  const credentialRepository = new RemoteCredentialRepository(database);
  const credentialVault = credentialEncryption === undefined
    ? undefined
    : new RemoteCredentialVault(credentialRepository, credentialEncryption);
  const providerPreferences = new RemoteProviderPreferenceRepository(database);
  let service!: RemoteTargetService;
  service = createRemoteTargetService({
    targets,
    profiles,
    credentialPreferences: credentialRepository,
    ...(credentialVault === undefined ? {} : { credentialVault }),
    providerPreferences,
    ...(clock === undefined ? {} : { clock }),
    ...(createTargetId === undefined ? {} : { createTargetId }),
    ...(ssh === undefined ? {} : { ssh }),
    ...(probePlatform === undefined ? {} : { probePlatform }),
    ...(providerReleases === undefined ? {} : { providerReleases }),
    createSessionRuntime: ({
      executionTargetId,
      platform,
      defaultShell,
      ssh: connectedSsh
    }) => createRemoteSessionRuntime({
      database,
      executionTargetId,
      platform,
      defaultShell,
      scanDiscovery: () => service.scanDiscovery(executionTargetId),
      scanSessions: () => service.scanSessions(executionTargetId),
      enabledProviders: () =>
        service.getProviderPreferences(executionTargetId).enabledProviders,
      openPty: (command, size) => connectedSsh.openPtyExec(command, size),
      ...(clock === undefined ? {} : { clock })
    }),
    resolveHelperArtifact: (facts) => {
      if (facts.platform === 'unknown' || facts.architecture === 'unknown') {
        throw new Error('The remote helper target is unsupported.');
      }
      return resolveRemoteHelperArtifact({
        bundleRoot: helperBundleRoot,
        platform: facts.platform,
        architecture: facts.architecture
      });
    }
  });
  let closed = false;

  return {
    service,
    async close() {
      if (closed) return;
      closed = true;
      try {
        await service.close();
      } finally {
        database.close();
      }
    }
  };
}
