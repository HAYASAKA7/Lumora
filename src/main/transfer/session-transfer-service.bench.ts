import { randomUUID } from 'node:crypto';

import { afterAll, bench, describe } from 'vitest';

import type { ProviderId } from '../../shared/contracts';
import type { ProviderTransferAdapter } from './transfer-adapter';
import type { TransferAdapterRegistry } from './transfer-adapter-registry';
import {
  SessionTransferService,
  type SessionTransferServiceDependencies
} from './session-transfer-service';

const SESSION_COUNT = 1_000;
const WORKSPACE_COUNT = 100;
const MEMORY_LIMIT_BYTES = 256 * 1024 * 1024;
const PROVIDERS: readonly ProviderId[] = [
  'codex',
  'claude',
  'gemini',
  'antigravity',
  'opencode',
  'cursor',
  'copilot',
  'qwen',
  'amp',
  'crush',
  'goose',
  'aider'
];

const sessions = new Map(
  Array.from({ length: SESSION_COUNT }, (_, index) => {
    const id = index.toString(16).padStart(64, '0');
    const workspaceIndex = index % WORKSPACE_COUNT;
    const provider = PROVIDERS[index % PROVIDERS.length] as ProviderId;
    return [
      id,
      {
        id,
        provider,
        nativeId: `benchmark-${provider}-${index}`,
        title: `Benchmark session ${index}`,
        workspaceId: (workspaceIndex + SESSION_COUNT)
          .toString(16)
          .padStart(64, '0'),
        workspacePath: `/benchmark/workspace-${workspaceIndex}`,
        sourceKeys: [`${provider}:benchmark-${index}`]
      }
    ] as const;
  })
);

const adapters = new Map(
  PROVIDERS.map((provider) => [
    provider,
    { provider } as ProviderTransferAdapter
  ])
);
const registry: TransferAdapterRegistry = {
  get: (provider) => adapters.get(provider) ?? null,
  providers: () => [...PROVIDERS],
  capabilities: () =>
    PROVIDERS.map((provider) => ({
      provider,
      displayName: provider,
      export: 'supported' as const,
      import: 'supported' as const
    }))
};

const dependencies: SessionTransferServiceDependencies = {
  platform: 'linux',
  adapters: registry,
  catalog: {
    getTransferSession: (sessionId) => sessions.get(sessionId) ?? null,
    getTransferSessionProvider: (sessionId) =>
      sessions.get(sessionId)?.provider ?? null,
    hasNativeSession: () => false
  },
  activeSessions: () => ({ sessionIds: [], unresolvedScopes: [] }),
  scanProviders: async () => ({
    scannedAt: '2026-07-29T08:00:00.000Z',
    providers: []
  }),
  workspaceById: () => null,
  workspaceCandidates: async () => [],
  workspaceProbes: { isDirectory: async () => false },
  stagingRoot: '/benchmark/staging',
  runOperation: async () => {
    throw new Error('The planning benchmark must not start an operation.');
  },
  cancelOperation: () => false,
  history: {
    getLastDirectory: () => null,
    saveLastDirectory: (_direction, path) => path,
    listHistory: () => [],
    recordHistory: () => []
  },
  refreshCatalog: async () => undefined,
  freeDiskBytes: async () => Number.MAX_SAFE_INTEGER,
  clock: () => new Date('2026-07-29T08:00:00.000Z'),
  createToken: randomUUID,
  onProgress: () => undefined
};

const service = new SessionTransferService(dependencies);
let largestHeapGrowth = 0;

describe('session transfer planning', () => {
  bench(
    '1,000 sessions across 100 workspaces and 12 providers',
    async () => {
      const before = process.memoryUsage().heapUsed;
      const plan = await service.prepareExport({
        sessionIds: [...sessions.keys()]
      });
      const heapGrowth = Math.max(0, process.memoryUsage().heapUsed - before);
      largestHeapGrowth = Math.max(largestHeapGrowth, heapGrowth);
      if (plan.sessions.length !== SESSION_COUNT) {
        throw new Error('The transfer benchmark did not plan every session.');
      }
      if (heapGrowth > MEMORY_LIMIT_BYTES) {
        throw new Error(
          `Transfer planning exceeded the ${MEMORY_LIMIT_BYTES} byte heap-growth limit.`
        );
      }
    },
    { iterations: 1, warmupIterations: 0, time: 0, warmupTime: 0 }
  );
});

afterAll(async () => {
  await service.dispose();
  console.info(
    `Transfer benchmark maximum heap growth: ${largestHeapGrowth} bytes for ${SESSION_COUNT} sessions, ${WORKSPACE_COUNT} workspaces, and ${PROVIDERS.length} providers.`
  );
});
