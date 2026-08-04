import { DatabaseSync } from 'node:sqlite';

import { ExecutionTargetRepository } from '../storage/execution-target-repository';
import { migrateCatalogDatabase } from '../storage/migrations';
import { RemoteConnectionProfileRepository } from '../storage/remote-connection-profile-repository';
import type { RemotePlatformFacts } from './platform-probe';
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
  probePlatform
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
    ...(probePlatform === undefined ? {} : { probePlatform })
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
