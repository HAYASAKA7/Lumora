import { DatabaseSync } from 'node:sqlite';

import type { ApplicationReleaseMetadata } from '../../shared/contracts';
import { migrateCatalogDatabase } from '../storage/migrations';
import { ApplicationReleaseCacheRepository } from '../storage/application-release-cache-repository';
import {
  createApplicationReleaseService,
  type ApplicationReleaseService
} from './application-release-service';

export interface ApplicationReleaseRuntime {
  service: ApplicationReleaseService;
  close(): Promise<void>;
}

export function createApplicationReleaseRuntime({
  databasePath,
  installedVersion,
  source,
  openExternal
}: {
  databasePath: string;
  installedVersion: string;
  source: { latestRelease(signal?: AbortSignal): Promise<ApplicationReleaseMetadata> };
  openExternal(url: string): Promise<unknown>;
}): ApplicationReleaseRuntime {
  const database = new DatabaseSync(databasePath);
  try {
    migrateCatalogDatabase(database);
  } catch (error) {
    database.close();
    throw error;
  }
  const service = createApplicationReleaseService({
    installedVersion,
    cache: new ApplicationReleaseCacheRepository(database),
    source,
    openExternal
  });
  let closed = false;
  return {
    service,
    async close() {
      if (closed) return;
      closed = true;
      await service.close();
      database.close();
    }
  };
}
