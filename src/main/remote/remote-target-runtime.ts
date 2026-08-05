import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';

import { ExecutionTargetRepository } from '../storage/execution-target-repository';
import { migrateCatalogDatabase } from '../storage/migrations';
import { RemoteConnectionProfileRepository } from '../storage/remote-connection-profile-repository';
import type { RemotePlatformFacts } from './platform-probe';
import { resolveRemoteHelperArtifact } from './helper-artifact-resolver';
import type { ConnectedRemoteSshClient } from './ssh-client';
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
}

export interface RemoteTargetRuntime {
  service: RemoteTargetService;
  close(): void;
}

export function createRemoteTargetRuntime({
  databasePath,
  clock,
  createTargetId,
  ssh,
  probePlatform,
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
  const service = createRemoteTargetService({
    targets,
    profiles,
    ...(clock === undefined ? {} : { clock }),
    ...(createTargetId === undefined ? {} : { createTargetId }),
    ...(ssh === undefined ? {} : { ssh }),
    ...(probePlatform === undefined ? {} : { probePlatform }),
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
    close() {
      if (closed) return;
      closed = true;
      service.close();
      database.close();
    }
  };
}
