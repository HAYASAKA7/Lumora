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
import {
  buildForkArguments,
  buildResumeArguments
} from '../providers/launch-command';
import { discoverOpenCodeSessions } from '../providers/opencode-session-source';
import { discoverQwenSessions } from '../providers/qwen-session-source';
import {
  createFileHandoffSnapshotter,
  createOpenCodeHandoffSnapshotter
} from '../providers/session-handoff-source';
import {
  createSessionCatalogRegistry,
  validateInstalledProviderCompatibility,
  type SessionCatalogAdapter,
  type SessionCatalogRegistry
} from '../providers/session-catalog-adapter';
import {
  SESSION_PROVIDER_IDS,
  hasNativeForkSupport
} from '../../shared/provider-definitions';
import { CatalogRepository } from '../storage/catalog-repository';
import { migrateCatalogDatabase } from '../storage/migrations';
import { CatalogService } from './catalog-service';
import { createOpenCodeTransferAdapter } from '../transfer/adapters/opencode-transfer-adapter';
import {
  createTransferAdapterRegistry,
  type TransferAdapterRegistry
} from '../transfer/transfer-adapter-registry';

type Environment = Readonly<Record<string, string | undefined>>;

interface CreateCatalogRuntimeOptions {
  databasePath: string;
  homeDirectory: string;
  platform: SystemInfo['platform'];
  env: Environment;
  scanProviders(): Promise<ProviderScanResult>;
  enabledProviders?: () => readonly ProviderId[];
  clock?: () => Date;
  createScanId?: (provider: ProviderId) => string;
}

export type CatalogTransferPort = Pick<
  CatalogService,
  'getTransferSession' | 'getTransferSessionProvider' | 'hasNativeSession'
>;

export interface CatalogRuntime {
  service: CatalogService;
  registry: SessionCatalogRegistry;
  transferRegistry: TransferAdapterRegistry;
  transferCatalog: CatalogTransferPort;
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
  enabledProviders = () => SESSION_PROVIDER_IDS,
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
    discover: SessionCatalogAdapter['discover'],
    snapshotHandoff: SessionCatalogAdapter['snapshotHandoff'] =
      createFileHandoffSnapshotter(provider)
  ): SessionCatalogAdapter => {
    const buildNativeFork = hasNativeForkSupport(provider)
      ? {
          buildForkArguments: (
            nativeSessionId: string,
            startPrompt: string
          ) => buildForkArguments(provider, nativeSessionId, startPrompt)
        }
      : {};
    return {
      provider,
      discover,
      validateCompatibility: validateInstalledProviderCompatibility,
      buildResumeArguments: (nativeSessionId, startPrompt) =>
        buildResumeArguments(provider, nativeSessionId, startPrompt),
      ...buildNativeFork,
      snapshotHandoff
    };
  };
  const registry = createSessionCatalogRegistry([
    adapter('codex', (installation) =>
      discoverCodexSessions({
        executablePath: installation.executablePath,
        platform,
        env,
        lookupSource
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
    adapter(
      'opencode',
      (installation) =>
        discoverOpenCodeSessions({ installation, env, platform }),
      createOpenCodeHandoffSnapshotter({ env, platform })
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
  const transferRegistry = createTransferAdapterRegistry({
    adapters: [createOpenCodeTransferAdapter({ platform, env })]
  });
  const service = new CatalogService({
    scanProviders,
    enabledProviders,
    registry,
    canonicalizeWorkspace: (path) =>
      canonicalizeWorkspacePath(path, { platform }),
    repository,
    clock,
    createScanId
  });
  const transferCatalog: CatalogTransferPort = Object.freeze({
    getTransferSession: (sessionId) => service.getTransferSession(sessionId),
    getTransferSessionProvider: (sessionId) =>
      service.getTransferSessionProvider(sessionId),
    hasNativeSession: (provider, nativeId) =>
      service.hasNativeSession(provider, nativeId)
  });
  let closed = false;

  return {
    service,
    registry,
    transferRegistry,
    transferCatalog,
    close() {
      if (closed) {
        return;
      }
      closed = true;
      database.close();
    }
  };
}
