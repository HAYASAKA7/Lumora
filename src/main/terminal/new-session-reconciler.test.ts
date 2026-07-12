import { describe, expect, it, vi } from 'vitest';

import type { RuntimeReconciliationResult } from '../storage/terminal-repository';
import { NewSessionReconciler } from './new-session-reconciler';

const request = {
  runtimeId: '0198f8b6-18f3-7ca0-9f0f-123456789abc',
  provider: 'codex' as const,
  workspaceId: 'a'.repeat(64),
  baselineNativeIds: ['known-native']
};

function harness(sessionSnapshots: Array<Array<{ id: string; nativeId: string }>>) {
  let snapshot = 0;
  const results: RuntimeReconciliationResult[] = [];
  const refreshCatalog = vi.fn(async () => {
    snapshot += 1;
  });
  const wait = vi.fn(async () => undefined);
  const reconciler = new NewSessionReconciler({
    refreshCatalog,
    listCurrentSessionIdentities: vi.fn(() =>
      sessionSnapshots[Math.min(snapshot - 1, sessionSnapshots.length - 1)] ?? []
    ),
    applyResult: vi.fn((_runtimeId, result) => results.push(result)),
    wait,
    delays: [10, 20, 30]
  });
  return { reconciler, refreshCatalog, wait, results };
}

describe('NewSessionReconciler', () => {
  it('links exactly one native ID that was absent from the baseline', async () => {
    const { reconciler, results } = harness([
      [
        { id: 'b'.repeat(64), nativeId: 'known-native' },
        { id: 'c'.repeat(64), nativeId: 'new-native' }
      ]
    ]);

    await reconciler.start(request);

    expect(results).toEqual([
      {
        state: 'linked',
        sessionId: 'c'.repeat(64),
        nativeSessionId: 'new-native'
      }
    ]);
  });

  it('marks multiple new provider identities ambiguous without choosing', async () => {
    const { reconciler, results } = harness([
      [
        { id: 'c'.repeat(64), nativeId: 'new-one' },
        { id: 'd'.repeat(64), nativeId: 'new-two' }
      ]
    ]);

    await reconciler.start(request);

    expect(results).toEqual([{ state: 'ambiguous' }]);
  });

  it('retries empty and failed refreshes, then records unresolved', async () => {
    const { reconciler, refreshCatalog, wait, results } = harness([[], [], []]);
    refreshCatalog.mockRejectedValueOnce(new Error('provider unavailable'));

    await reconciler.start(request);

    expect(wait).toHaveBeenCalledTimes(3);
    expect(refreshCatalog).toHaveBeenCalledTimes(3);
    expect(results).toEqual([{ state: 'unresolved' }]);
  });

  it('cancels outstanding waits during shutdown and records unresolved', async () => {
    const results: RuntimeReconciliationResult[] = [];
    const reconciler = new NewSessionReconciler({
      refreshCatalog: vi.fn(async () => undefined),
      listCurrentSessionIdentities: vi.fn(() => []),
      applyResult: vi.fn((_runtimeId, result) => results.push(result)),
      wait: (_delay, signal) =>
        new Promise<void>((resolve) => {
          signal.addEventListener('abort', () => resolve(), { once: true });
        }),
      delays: [30_000]
    });

    const task = reconciler.start(request);
    await reconciler.shutdown();
    await task;

    expect(results).toEqual([{ state: 'unresolved' }]);
  });
});
