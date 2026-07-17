import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { join, resolve } from 'node:path';

import type {
  ProviderScanResult,
  SystemInfo,
  ProviderId
} from '../../shared/contracts';
import { canonicalizeWorkspacePath } from '../platform/workspace-path';
import { discoverClaudeSessions } from '../providers/claude-session-source';
import { discoverCopilotSessions } from '../providers/copilot-session-source';
import { discoverCodexSessions } from '../providers/codex-app-server';
import { discoverJsonSessions } from '../providers/json-session-source';
import { buildResumeArguments } from '../providers/launch-command';
import { discoverOpenCodeSessions } from '../providers/opencode-session-source';
import { discoverQwenSessions } from '../providers/qwen-session-source';
import {
  createSessionCatalogRegistry,
  validateInstalledProviderCompatibility,
  type SessionCatalogAdapter,
  type SessionCatalogRegistry
} from '../providers/session-catalog-adapter';
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
  createScanId?: (provider: ProviderId) => string;
}

export interface CatalogRuntime {
  service: CatalogService;
  registry: SessionCatalogRegistry;
  close(): void;
}

function environmentHome(
  env: Environment,
  name: string,
  fallback: string
): string {
  const matching = Object.keys(env).find(
    (candidate) => candidate.toLocaleLowerCase() === name.toLocaleLowerCase()
  );
  const configured = matching === undefined ? undefined : env[matching]?.trim();
  return configured ? resolve(configured) : fallback;
}

export function createCatalogRuntime({
  databasePath,
  homeDirectory,
  platform,
  env,
  scanProviders,
  clock = () => new Date(),
  createScanId = () => randomUUID()
}: CreateCatalogRuntimeOptions): CatalogRuntime {
  const database = new DatabaseSync(databasePath);
  try {
    migrateCatalogDatabase(database);
  } catch (error) {
    database.close();
    throw error;
  }

  const repository = new CatalogRepository(database);
  const lookupSource = async (provider: ProviderId, sourceKey: string) =>
    repository.findSource(provider, sourceKey);
  const adapter = (
    provider: ProviderId,
    discover: SessionCatalogAdapter['discover']
  ): SessionCatalogAdapter => ({
    provider,
    discover,
    validateCompatibility: validateInstalledProviderCompatibility,
    buildResumeArguments: (nativeSessionId) =>
      buildResumeArguments(provider, nativeSessionId)
  });
  const registry = createSessionCatalogRegistry([
    adapter('codex', (installation) =>
      discoverCodexSessions({
        executablePath: installation.executablePath,
        platform,
        env
      })
    ),
    adapter('claude', () =>
      discoverClaudeSessions({ homeDirectory, env, lookupSource })
    ),
    adapter('gemini', () =>
      discoverJsonSessions({
        provider: 'gemini',
        storageRoot: join(
          environmentHome(env, 'GEMINI_CLI_HOME', homeDirectory),
          '.gemini',
          'tmp'
        ),
        lookupSource
      })
    ),
    adapter('opencode', (installation) =>
      discoverOpenCodeSessions({ installation, env, platform })
    ),
    adapter('copilot', () =>
      discoverCopilotSessions({ homeDirectory, env, lookupSource })
    ),
    adapter('qwen', () => {
      const configuredRuntime = environmentHome(
        env,
        'QWEN_RUNTIME_DIR',
        ''
      ).trim();
      const configuredHome = environmentHome(env, 'QWEN_HOME', '').trim();
      return discoverQwenSessions({
        qwenRoot:
          configuredRuntime || configuredHome || join(homeDirectory, '.qwen'),
        lookupSource
      });
    })
  ]);
  const service = new CatalogService({
    scanProviders,
    registry,
    canonicalizeWorkspace: (path) =>
      canonicalizeWorkspacePath(path, { platform }),
    repository,
    clock,
    createScanId
  });
  let closed = false;

  return {
    service,
    registry,
    close() {
      if (closed) {
        return;
      }
      closed = true;
      database.close();
    }
  };
}
