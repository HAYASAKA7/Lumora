import { describe, expect, it, vi } from 'vitest';

import {
  createUnifiedLaunchUsageStore,
  scheduleUnifiedCapabilityWarmup
} from './unified-capability-warmup';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe('unified launch usage', () => {
  it('remembers the providers opened in Unified UI recently, newest first', async () => {
    let now = new Date('2026-09-14T10:00:00.000Z');
    const writes: string[] = [];
    const store = createUnifiedLaunchUsageStore({
      readFile: async () => JSON.stringify({
        version: 1,
        lastLaunchedAt: { gemini: '2026-08-01T10:00:00.000Z', codex: '2026-09-13T10:00:00.000Z' }
      }),
      writeFile: async (data) => {
        writes.push(data);
      },
      clock: () => now
    });

    await store.load();
    now = new Date('2026-09-14T11:00:00.000Z');
    store.record('claude');
    await store.flush();

    // Gemini was last opened six weeks ago, past the window worth warming.
    expect(store.recentProviders(14 * 24 * 60 * 60_000, 3)).toEqual(['claude', 'codex']);
    expect(store.recentProviders(14 * 24 * 60 * 60_000, 1)).toEqual(['claude']);
    expect(JSON.parse(writes.at(-1)!)).toEqual({
      version: 1,
      lastLaunchedAt: {
        gemini: '2026-08-01T10:00:00.000Z',
        codex: '2026-09-13T10:00:00.000Z',
        claude: '2026-09-14T11:00:00.000Z'
      }
    });
  });

  it('starts empty from a missing or unreadable file, and keeps unknown providers out', async () => {
    const missing = createUnifiedLaunchUsageStore({
      readFile: async () => {
        throw Object.assign(new Error('missing'), { code: 'ENOENT' });
      },
      writeFile: async () => undefined
    });
    await missing.load();
    expect(missing.recentProviders(60_000, 3)).toEqual([]);

    const tampered = createUnifiedLaunchUsageStore({
      readFile: async () => JSON.stringify({ version: 1, lastLaunchedAt: { 'not-a-provider': '2026-09-14T10:00:00.000Z' } }),
      writeFile: async () => undefined
    });
    await tampered.load();
    expect(tampered.recentProviders(60_000 * 60 * 24 * 365 * 10, 3)).toEqual([]);
  });
});

describe('unified capability warm-up', () => {
  it('checks the recent providers one at a time after a delay', async () => {
    vi.useFakeTimers();
    try {
      const gates = [deferred(), deferred()];
      const check = vi.fn((providerId: string) => gates[providerId === 'claude' ? 0 : 1]!.promise);
      scheduleUnifiedCapabilityWarmup({
        delayMs: 20_000,
        providers: () => ['claude', 'codex'],
        isEnabled: () => true,
        check
      });

      await vi.advanceTimersByTimeAsync(19_999);
      expect(check).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      expect(check.mock.calls).toEqual([['claude']]);

      gates[0]!.resolve();
      await vi.advanceTimersByTimeAsync(0);
      expect(check.mock.calls).toEqual([['claude'], ['codex']]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does nothing once cancelled, while Unified UI is off, or when a check fails', async () => {
    vi.useFakeTimers();
    try {
      const check = vi.fn(async () => {
        throw new Error('probe failed');
      });
      const cancel = scheduleUnifiedCapabilityWarmup({
        delayMs: 1_000, providers: () => ['claude'], isEnabled: () => true, check
      });
      cancel();
      await vi.advanceTimersByTimeAsync(5_000);
      expect(check).not.toHaveBeenCalled();

      scheduleUnifiedCapabilityWarmup({
        delayMs: 1_000, providers: () => ['claude'], isEnabled: () => false, check
      });
      await vi.advanceTimersByTimeAsync(5_000);
      expect(check).not.toHaveBeenCalled();

      scheduleUnifiedCapabilityWarmup({
        delayMs: 1_000, providers: () => ['claude', 'codex'], isEnabled: () => true, check
      });
      await vi.advanceTimersByTimeAsync(5_000);
      // A failed check is the launch's to report; the warm-up just moves on.
      expect(check).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });
});
