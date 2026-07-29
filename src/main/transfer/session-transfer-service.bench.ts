import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';

import { afterAll, bench, describe } from 'vitest';

import type { ProviderId } from '../../shared/contracts';
import { writeSessionArchive } from './archive-format';
import type { ProviderTransferAdapter } from './transfer-adapter';
import type { TransferAdapterRegistry } from './transfer-adapter-registry';
import {
  SessionTransferService,
  type SessionTransferServiceDependencies
} from './session-transfer-service';

const SESSION_COUNT = 1_000;
const WORKSPACE_COUNT = 100;
const MEMORY_LIMIT_BYTES = 256 * 1024 * 1024;
const STREAM_PAYLOAD_BYTES = 512 * 1024 * 1024;
const STREAM_CHUNK_BYTES = 1024 * 1024;
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

describe('session archive streaming', () => {
  bench(
    'streams a generated 512 MiB provider payload without retaining it',
    async () => {
      const root = await mkdtemp(join(tmpdir(), 'lumora-transfer-benchmark-'));
      const archivePath = join(root, 'stream.lumora-sessions');
      const baseline = process.memoryUsage().rss;
      let peakGrowth = 0;
      const chunk = Buffer.alloc(STREAM_CHUNK_BYTES, 0x61);
      const body = Readable.from(
        (async function* generatePayload() {
          let remaining = STREAM_PAYLOAD_BYTES;
          while (remaining > 0) {
            const size = Math.min(remaining, chunk.length);
            peakGrowth = Math.max(
              peakGrowth,
              Math.max(0, process.memoryUsage().rss - baseline)
            );
            yield chunk.subarray(0, size);
            remaining -= size;
          }
        })()
      );
      try {
        const result = await writeSessionArchive({
          outputPath: archivePath,
          protection: { encrypted: false },
          manifest: {
            formatVersion: 1,
            createdAt: '2026-07-29T08:00:00.000Z',
            sourcePlatform: 'linux',
            sessions: [{ provider: 'opencode', nativeSessionId: 'benchmark' }]
          },
          entries: [
            {
              name: 'sessions/opencode/benchmark.json',
              body,
              declaredSize: STREAM_PAYLOAD_BYTES
            }
          ]
        });
        if (result.entryCount !== 1) {
          throw new Error('The streaming benchmark did not archive its payload.');
        }
        if (peakGrowth > MEMORY_LIMIT_BYTES) {
          throw new Error(
            `Transfer streaming exceeded the ${MEMORY_LIMIT_BYTES} byte RSS-growth limit.`
          );
        }
      } finally {
        await rm(root, { recursive: true, force: true });
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
