import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { join, resolve } from 'node:path';

import type {
  ProviderScanResult,
  SystemInfo,
  ProviderId,
  ExecutionTargetId
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
import { discoverKimiSessions } from '../providers/kimi-session-source';
import {
  createFileHandoffSnapshotter,
  createKimiHandoffSnapshotter,
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
import { WorkspaceVisibilityRepository } from '../storage/workspace-visibility-repository';
import { migrateCatalogDatabase } from '../storage/migrations';
import { CatalogService } from './catalog-service';
import { WorkspaceVisibilityService } from './workspace-visibility-service';
import { createOpenCodeTransferAdapter } from '../transfer/adapters/opencode-transfer-adapter';
import { createGeminiTransferAdapter } from '../transfer/adapters/gemini-transfer-adapter';
import { createQwenTransferAdapter } from '../transfer/adapters/qwen-transfer-adapter';
import { createClaudeTransferAdapter } from '../transfer/adapters/claude-transfer-adapter';
import { createCodexTransferAdapter } from '../transfer/adapters/codex-transfer-adapter';
import { createCopilotTransferAdapter } from '../transfer/adapters/copilot-transfer-adapter';
import { createKimiTransferAdapter } from '../transfer/adapters/kimi-transfer-adapter';
import {
  createTransferAdapterRegistry,
  type TransferAdapterRegistry
} from '../transfer/transfer-adapter-registry';

type Environment = Readonly<Record<string, string | undefined>>;

interface CreateCatalogRuntimeOptions {
  databasePath: string;
  executionTargetId: ExecutionTargetId;
  homeDirectory: string;
  platform: SystemInfo['platform'];
  env: Environment;
  scanProviders(): Promise<ProviderScanResult>;
  enabledProviders?: () => readonly ProviderId[];
  allowExperimentalTransferRoutes?: boolean;
  clock?: () => Date;
  createScanId?: (provider: ProviderId) => string;
  onRefreshSettled?: (measurement: {
    outcome: 'succeeded' | 'failed';
    durationMs: number;
    cacheHits: number;
    counts: { discovered: number; unchanged: number; invalid: number };
  }) => void;
}

export type CatalogTransferPort = Pick<
  CatalogService,
  'getTransferSession' | 'getTransferSessionProvider' | 'hasNativeSession'
>;

export interface CatalogRuntime {
  service: CatalogService;
  workspaceVisibility: WorkspaceVisibilityService;
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
  executionTargetId,
  homeDirectory,
  platform,
  env,
  scanProviders,
  enabledProviders = () => SESSION_PROVIDER_IDS,
  allowExperimentalTransferRoutes = false,
  clock = () => new Date(),
  createScanId = () => randomUUID(),
  onRefreshSettled
}: CreateCatalogRuntimeOptions): CatalogRuntime {
  const database = new DatabaseSync(databasePath);
  try {
    migrateCatalogDatabase(database);
  } catch (error) {
    database.close();
    throw error;
  }

  const repository = new CatalogRepository(database, executionTargetId);
  const workspaceVisibility = new WorkspaceVisibilityService({
    repository: new WorkspaceVisibilityRepository(database, executionTargetId),
    clock
  });
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
  const geminiStorageRoot = join(
    environmentHome(env, 'GEMINI_CLI_HOME', homeDirectory),
    '.gemini',
    'tmp'
  );
  const codexHome = environmentHome(env, 'CODEX_HOME', join(homeDirectory, '.codex'));
  const copilotConfigRoot = environmentHome(
    env,
    'COPILOT_HOME',
    join(homeDirectory, '.copilot')
  );
  const configuredClaudeRoot = environmentHome(env, 'CLAUDE_CONFIG_DIR', '').trim();
  const claudeConfigRoot = configuredClaudeRoot || join(homeDirectory, '.claude');
  const configuredQwenRuntime = environmentHome(env, 'QWEN_RUNTIME_DIR', '').trim();
  const configuredQwenHome = environmentHome(env, 'QWEN_HOME', '').trim();
  const qwenRoot = configuredQwenRuntime || configuredQwenHome || join(homeDirectory, '.qwen');
  const kimiRoot = environmentHome(env, 'KIMI_CODE_HOME', join(homeDirectory, '.kimi-code'));
  const registry = createSessionCatalogRegistry([
    adapter('codex', (installation) =>
      discoverCodexSessions({
        executablePath: installation.executablePath,
        platform,
        env,
        lookupSource
      })
    ),
    adapter('claude', () => discoverClaudeSessions({ homeDirectory, env, lookupSource })),
    adapter('gemini', () =>
      discoverJsonSessions({
        provider: 'gemini',
        storageRoot: geminiStorageRoot,
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
    adapter('qwen', () => discoverQwenSessions({ qwenRoot, lookupSource })),
    adapter(
      'kimi',
      () => discoverKimiSessions({ kimiRoot, lookupSource }),
      createKimiHandoffSnapshotter()
    )
  ]);
  const transferRegistry = createTransferAdapterRegistry({
    adapters: [
      createOpenCodeTransferAdapter({ platform, env }),
      createCodexTransferAdapter({ platform, env, codexHome }),
      createCopilotTransferAdapter({
        configRoot: copilotConfigRoot,
        homeDirectory,
        env
      }),
      createGeminiTransferAdapter({
        platform,
        env,
        geminiStorageRoot
      }),
      createQwenTransferAdapter({ platform, qwenRoot }),
      createClaudeTransferAdapter({
        configRoot: claudeConfigRoot,
        homeDirectory,
        env
      }),
      createKimiTransferAdapter({ platform, kimiRoot })
    ],
    allowExperimentalRoutes: allowExperimentalTransferRoutes
  });
  const service = new CatalogService({
    scanProviders,
    enabledProviders,
    registry,
    canonicalizeWorkspace: (path) =>
      canonicalizeWorkspacePath(path, { platform }),
    repository,
    clock,
    createScanId,
    ...(onRefreshSettled === undefined ? {} : { onRefreshSettled })
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
    workspaceVisibility,
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
