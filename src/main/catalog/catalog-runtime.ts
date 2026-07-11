import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

import type {
  ProviderScanResult,
  SystemInfo
} from '../../shared/contracts';
import { canonicalizeWorkspacePath } from '../platform/workspace-path';
import { discoverClaudeSessions } from '../providers/claude-session-source';
import { discoverCodexSessions } from '../providers/codex-app-server';
import { CatalogRepository } from '../storage/catalog-repository';
import { migrateCatalogDatabase } from '../storage/migrations';
import { CatalogService } from './catalog-service';

type Environment = Readonly<Record<string, string | undefined>>;

interface CreateCatalogRuntimeOptions {
  databasePath: string;
  homeDirectory: string;
  platform: SystemInfo['platform'];
  env: Environment;
  scanProviders(): Promise<ProviderScanResult>;
  clock?: () => Date;
  createScanId?: () => string;
}

export interface CatalogRuntime {
  service: CatalogService;
  close(): void;
}

export function createCatalogRuntime({
  databasePath,
  homeDirectory,
  platform,
  env,
  scanProviders,
  clock = () => new Date(),
  createScanId = randomUUID
}: CreateCatalogRuntimeOptions): CatalogRuntime {
  const database = new DatabaseSync(databasePath);
  try {
    migrateCatalogDatabase(database);
  } catch (error) {
    database.close();
    throw error;
  }

  const repository = new CatalogRepository(database);
  const service = new CatalogService({
    scanProviders,
    discoverCodex: (installation) =>
      discoverCodexSessions({
        executablePath: installation.executablePath,
        platform,
        env
      }),
    discoverClaude: () =>
      discoverClaudeSessions({
        homeDirectory,
        env,
        lookupSource: async (provider, sourceKey) =>
          repository.findSource(provider, sourceKey)
      }),
    canonicalizeWorkspace: (path) =>
      canonicalizeWorkspacePath(path, { platform }),
    repository,
    clock,
    createScanId
  });
  let closed = false;

  return {
    service,
    close() {
      if (closed) {
        return;
      }
      closed = true;
      database.close();
    }
  };
}
