import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  ProviderId,
  ProviderInstallation,
  ProviderScanResult
} from '../../shared/contracts';
import type { TransferSupport } from '../../shared/session-transfer';
import { writeSessionArchive } from './archive-format';
import {
  SessionTransferService,
  type SessionTransferServiceDependencies
} from './session-transfer-service';
import type {
  ProviderImportInspection,
  ProviderTransferAdapter
} from './transfer-adapter';
import type {
  TransferAdapterRegistry,
  TransferCapabilityDescriptor
} from './transfer-adapter-registry';

const NOW = '2026-07-29T08:00:00.000Z';
const SESSION_ID = 'a'.repeat(64);
const WORKSPACE_ID = 'b'.repeat(64);
const PROFILE_WORKSPACE = '/work/Lumora';

function ready(provider: ProviderId): ProviderInstallation {
  return {
    provider,
    displayName: provider === 'opencode' ? 'OpenCode' : provider,
    state: 'ready',
    executablePath: `/tools/${provider}`,
    version: `${provider} 1.0.0`,
    issue: null
  };
}

function scan(providers: readonly ProviderInstallation[]): ProviderScanResult {
  return { scannedAt: NOW, providers: [...providers] };
}

function descriptor(
  provider: ProviderId,
  support: TransferSupport
): TransferCapabilityDescriptor {
  return {
    provider,
    displayName: provider === 'opencode' ? 'OpenCode' : provider,
    export: support,
    import: support
  };
}

function registry(
  adapter: ProviderTransferAdapter,
  support: Partial<Record<ProviderId, TransferSupport>> = {}
): TransferAdapterRegistry {
  return {
    get: (provider) => (provider === adapter.provider ? adapter : null),
    providers: () => [adapter.provider],
    capabilities: () =>
      (Object.entries(support) as [ProviderId, TransferSupport][]).map(
        ([provider, state]) => descriptor(provider, state)
      ).concat(
        support.opencode === undefined
          ? [descriptor('opencode', 'supported')]
          : []
      )
  };
}

function operationRunner(root: string) {
  const controllers = new Map<string, AbortController>();
  return {
    async runOperation<T>(
      work: (context: {
        operationId: string;
        stagingDirectory: string;
        signal: AbortSignal;
      }) => Promise<T>
    ): Promise<T> {
      const operationId = randomUUID();
      const stagingDirectory = join(root, `transfer-${operationId}`);
      const controller = new AbortController();
      controllers.set(operationId, controller);
      await mkdir(stagingDirectory, { recursive: true });
      try {
        return await work({
          operationId,
          stagingDirectory,
          signal: controller.signal
        });
      } finally {
        controllers.delete(operationId);
        await rm(stagingDirectory, { recursive: true, force: true });
      }
    },
    cancelOperation(operationId: string): boolean {
      const controller = controllers.get(operationId);
      if (controller === undefined) return false;
      controller.abort();
      return true;
    }
  };
}

function fakeAdapter() {
  const importInspection = async (
    payloadPath: string
  ): Promise<ProviderImportInspection> => {
    const value = JSON.parse(await readFile(payloadPath, 'utf8')) as {
      nativeSessionId: string;
      workspacePath: string;
      title: string;
    };
    return {
      provider: 'opencode',
      nativeSessionId: value.nativeSessionId,
      workspacePath: value.workspacePath,
      title: value.title,
      payloadPath
    };
  };
  const adapter: ProviderTransferAdapter = {
    provider: 'opencode',
    capabilities: () => ({ export: true, import: true }),
    exportSession: vi.fn(async (input) => {
      const payloadPath = join(input.stagingDirectory, 'session.json');
      const body = JSON.stringify({
        nativeSessionId: input.nativeSessionId,
        workspacePath: input.expectedWorkspacePath,
        title: input.expectedTitle
      });
      await writeFile(payloadPath, body, { flag: 'wx' });
      return {
        provider: 'opencode' as const,
        nativeSessionId: input.nativeSessionId,
        workspacePath: input.expectedWorkspacePath,
        title: input.expectedTitle,
        payloadPath,
        size: Buffer.byteLength(body)
      };
    }),
    inspectImport: vi.fn((input) => importInspection(input.payloadPath)),
    importSession: vi.fn(async (input) => ({
      status: 'imported' as const,
      nativeSessionId: input.inspection.nativeSessionId,
      payloadPath: input.inspection.payloadPath
    })),
    verifyImportedSession: vi.fn(async () => true),
    rollbackImport: vi.fn(async () => undefined)
  };
  return adapter;
}

function transferSession(overrides: Record<string, unknown> = {}) {
  return {
    id: SESSION_ID,
    provider: 'opencode' as const,
    nativeId: 'ses_transfer',
    title: 'Transfer session',
    workspaceId: WORKSPACE_ID,
    workspacePath: PROFILE_WORKSPACE,
    sourceKeys: ['opencode:ses_transfer'],
    ...overrides
  };
}

describe('SessionTransferService', () => {
  let root: string;
  let clockMs: number;
  let activeSessionIds: Set<string>;
  let activeScopes: { provider: ProviderId; workspaceId: string }[];
  let nativeDuplicates: Set<string>;
  let adapter: ProviderTransferAdapter;
  let dependencies: SessionTransferServiceDependencies;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'lumora-transfer-service-'));
    clockMs = Date.parse(NOW);
    activeSessionIds = new Set();
    activeScopes = [];
    nativeDuplicates = new Set();
    adapter = fakeAdapter();
    const operations = operationRunner(join(root, 'operations'));
    dependencies = {
      platform: 'linux',
      adapters: registry(adapter),
      catalog: {
        getTransferSession: (id) =>
          id === SESSION_ID ? transferSession() : null,
        getTransferSessionProvider: (id) =>
          id === SESSION_ID ? 'opencode' : null,
        hasNativeSession: (_provider, nativeId) =>
          nativeDuplicates.has(nativeId)
      },
      activeSessions: () => ({
        sessionIds: [...activeSessionIds],
        unresolvedScopes: activeScopes
      }),
      scanProviders: async () => scan([ready('opencode')]),
      workspaceById: (id) =>
        id === WORKSPACE_ID
          ? { id, canonicalPath: PROFILE_WORKSPACE, displayName: 'Lumora' }
          : null,
      workspaceCandidates: async () => [
        {
          workspaceId: WORKSPACE_ID,
          canonicalPath: PROFILE_WORKSPACE,
          displayName: 'Lumora',
          gitRemote: null,
          markers: ['.git']
        }
      ],
      workspaceProbes: {
        isDirectory: async (path) => path === PROFILE_WORKSPACE
      },
      stagingRoot: join(root, 'retained'),
      runOperation: operations.runOperation,
      cancelOperation: operations.cancelOperation,
      history: {
        getLastDirectory: () => null,
        saveLastDirectory: (_direction, path) => path,
        listHistory: () => [],
        recordHistory: () => []
      },
      refreshCatalog: vi.fn(async () => undefined),
      freeDiskBytes: vi.fn(async () => 1024 * 1024 * 1024),
      clock: () => new Date(clockMs),
      createToken: () => randomUUID(),
      onProgress: vi.fn()
    };
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('classifies stale, running, unresolved-scope, unsupported, and ready sessions', async () => {
    const staleId = 'c'.repeat(64);
    const unsupportedId = 'd'.repeat(64);
    const scopedId = 'e'.repeat(64);
    dependencies.catalog.getTransferSession = (id) => {
      if (id === staleId) return null;
      if (id === unsupportedId) {
        return transferSession({
          id,
          provider: 'codex',
          nativeId: 'codex-native'
        });
      }
      if (id === scopedId) {
        return transferSession({ id, nativeId: 'scope-native' });
      }
      return transferSession({ id });
    };
    dependencies.catalog.getTransferSessionProvider = (id) =>
      id === staleId ? 'claude' : 'opencode';
    dependencies.adapters = registry(adapter, {
      opencode: 'supported',
      codex: 'route_unverified'
    });
    activeSessionIds.add(SESSION_ID);
    activeScopes = [{ provider: 'opencode', workspaceId: WORKSPACE_ID }];

    const plan = await new SessionTransferService(dependencies).prepareExport({
      sessionIds: [SESSION_ID, staleId, unsupportedId, scopedId]
    });

    expect(plan.sessions).toEqual([]);
    expect(
      plan.skipped.map(({ sessionId, provider, reason }) => ({
        sessionId,
        provider,
        reason
      }))
    ).toEqual([
      { sessionId: SESSION_ID, provider: 'opencode', reason: 'running' },
      { sessionId: staleId, provider: 'claude', reason: 'source_unavailable' },
      { sessionId: unsupportedId, provider: 'codex', reason: 'route_unverified' },
      { sessionId: scopedId, provider: 'opencode', reason: 'running' }
    ]);
  });

  it('rechecks activity before export and leaves no final or partial archive', async () => {
    const service = new SessionTransferService(dependencies);
    const plan = await service.prepareExport({ sessionIds: [SESSION_ID] });
    activeSessionIds.add(SESSION_ID);
    const outputPath = join(root, 'sessions.lumora-sessions');

    await expect(
      service.executeExport(
        { planToken: plan.planToken, protection: { encrypted: false } },
        outputPath
      )
    ).rejects.toMatchObject({ code: 'SESSION_BECAME_ACTIVE' });
    await expect(stat(outputPath)).rejects.toMatchObject({ code: 'ENOENT' });
    expect((await readdir(root)).some((name) => name.includes('.partial-')))
      .toBe(false);
  });

  it('exports through a provider adapter into an authenticated archive', async () => {
    const service = new SessionTransferService(dependencies);
    const plan = await service.prepareExport({ sessionIds: [SESSION_ID] });
    const outputPath = join(root, 'sessions.lumora-sessions');
    const result = await service.executeExport(
      { planToken: plan.planToken, protection: { encrypted: true, password: 'secret' } },
      outputPath
    );

    expect(result).toMatchObject({
      status: 'completed',
      exportedCount: 1,
      failedCount: 0
    });
    await expect(stat(outputPath)).resolves.toMatchObject({ isFile: expect.any(Function) });
    expect(adapter.exportSession).toHaveBeenCalledOnce();
  });

  it('rejects expired plans and insufficient destination disk space', async () => {
    const service = new SessionTransferService(dependencies);
    const expired = await service.prepareExport({ sessionIds: [SESSION_ID] });
    clockMs += 16 * 60 * 1000;
    await expect(
      service.executeExport(
        { planToken: expired.planToken, protection: { encrypted: false } },
        join(root, 'expired.lumora-sessions')
      )
    ).rejects.toMatchObject({ code: 'TRANSFER_PLAN_EXPIRED' });

    clockMs = Date.parse(NOW);
    dependencies.freeDiskBytes = vi.fn(async () => 0);
    const lowDiskService = new SessionTransferService(dependencies);
    const lowDisk = await lowDiskService.prepareExport({ sessionIds: [SESSION_ID] });
    await expect(
      lowDiskService.executeExport(
        { planToken: lowDisk.planToken, protection: { encrypted: false } },
        join(root, 'low-disk.lumora-sessions')
      )
    ).rejects.toMatchObject({ code: 'INSUFFICIENT_DISK_SPACE' });
  });

  it('inspects a mixed archive, skips a missing provider, and rolls back failed verification', async () => {
    const archivePath = join(root, 'mixed.lumora-sessions');
    const manifest = {
      formatVersion: 1,
      createdAt: NOW,
      sourcePlatform: 'linux',
      sessions: [
        {
          sessionId: SESSION_ID,
          provider: 'opencode',
          nativeSessionId: 'ses_transfer',
          title: 'Transfer session',
          workspace: {
            key: 'workspace:lumora',
            path: PROFILE_WORKSPACE,
            displayName: 'Lumora',
            gitRemote: null,
            markers: ['.git']
          },
          entryName: 'providers/opencode/session.json',
          providerVersion: 'opencode 1.0.0',
          adapterSchemaVersion: 1
        },
        {
          sessionId: 'c'.repeat(64),
          provider: 'claude',
          nativeSessionId: 'claude-transfer',
          title: 'Claude transfer',
          workspace: {
            key: 'workspace:lumora',
            path: PROFILE_WORKSPACE,
            displayName: 'Lumora',
            gitRemote: null,
            markers: ['.git']
          },
          entryName: 'providers/claude/session.json',
          providerVersion: 'claude 1.0.0',
          adapterSchemaVersion: 1
        }
      ]
    } as const;
    await writeSessionArchive({
      outputPath: archivePath,
      protection: { encrypted: false },
      manifest,
      entries: [
        {
          name: 'providers/opencode/session.json',
          body: JSON.stringify({
            nativeSessionId: 'ses_transfer',
            workspacePath: PROFILE_WORKSPACE,
            title: 'Transfer session'
          })
        },
        { name: 'providers/claude/session.json', body: '{}' }
      ]
    });
    dependencies.adapters = registry(adapter, {
      opencode: 'supported',
      claude: 'provider_not_installed'
    });
    const service = new SessionTransferService(dependencies);
    const selection = await service.chooseImportArchive(archivePath);
    const inspection = await service.inspectImport({
      selectionToken: selection.selectionToken
    });

    expect(inspection.providers).toEqual([
      expect.objectContaining({ provider: 'claude', support: 'provider_not_installed' }),
      expect.objectContaining({ provider: 'opencode', support: 'supported' })
    ]);
    await expect(
      service.planImport({
        inspectionToken: inspection.inspectionToken,
        providers: ['codex'],
        workspaceMappings: []
      })
    ).rejects.toMatchObject({ code: 'TRANSFER_PROVIDER_NOT_IN_ARCHIVE' });

    const plan = await service.planImport({
      inspectionToken: inspection.inspectionToken,
      providers: ['opencode', 'claude'],
      workspaceMappings: [
        {
          sourceWorkspaceKey: 'workspace:lumora',
          action: 'map',
          destinationWorkspaceId: WORKSPACE_ID
        }
      ]
    });
    expect(plan.ready).toHaveLength(1);
    expect(plan.skipped).toEqual([
      expect.objectContaining({
        provider: 'claude',
        reason: 'provider_not_installed'
      })
    ]);

    vi.mocked(adapter.verifyImportedSession).mockResolvedValue(false);
    const result = await service.executeImport({ planToken: plan.planToken });
    expect(result).toMatchObject({
      status: 'failed',
      failedCount: 1,
      importedCount: 0,
      skippedCount: 1
    });
    expect(adapter.rollbackImport).toHaveBeenCalledOnce();
  });

  it('skips an existing native session without invoking the provider import', async () => {
    nativeDuplicates.add('ses_transfer');
    const archivePath = join(root, 'duplicate.lumora-sessions');
    await writeSessionArchive({
      outputPath: archivePath,
      protection: { encrypted: false },
      manifest: {
        formatVersion: 1,
        createdAt: NOW,
        sourcePlatform: 'linux',
        sessions: [
          {
            sessionId: SESSION_ID,
            provider: 'opencode',
            nativeSessionId: 'ses_transfer',
            title: 'Transfer session',
            workspace: {
              key: 'workspace:lumora',
              path: PROFILE_WORKSPACE,
              displayName: 'Lumora',
              gitRemote: null,
              markers: ['.git']
            },
            entryName: 'providers/opencode/session.json',
            providerVersion: 'opencode 1.0.0',
            adapterSchemaVersion: 1
          }
        ]
      },
      entries: [
        {
          name: 'providers/opencode/session.json',
          body: JSON.stringify({
            nativeSessionId: 'ses_transfer',
            workspacePath: PROFILE_WORKSPACE,
            title: 'Transfer session'
          })
        }
      ]
    });
    const service = new SessionTransferService(dependencies);
    const selection = await service.chooseImportArchive(archivePath);
    const inspection = await service.inspectImport({
      selectionToken: selection.selectionToken
    });
    const plan = await service.planImport({
      inspectionToken: inspection.inspectionToken,
      providers: ['opencode'],
      workspaceMappings: [
        {
          sourceWorkspaceKey: 'workspace:lumora',
          action: 'map',
          destinationWorkspaceId: WORKSPACE_ID
        }
      ]
    });

    expect(plan.ready).toEqual([]);
    expect(plan.skipped).toEqual([
      expect.objectContaining({ reason: 'duplicate' })
    ]);
    expect(adapter.importSession).not.toHaveBeenCalled();
  });
});
