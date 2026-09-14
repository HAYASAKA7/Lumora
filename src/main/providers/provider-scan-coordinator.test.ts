import { describe, expect, it, vi } from 'vitest';

import type {
  ProviderId,
  ProviderScanResult
} from '../../shared/contracts';
import { ProviderScanCoordinator } from './provider-scan-coordinator';

function result(providers: readonly ProviderId[]): ProviderScanResult {
  return {
    scannedAt: '2026-07-23T07:30:00.000Z',
    providers: providers.map((provider) => ({
      provider,
      displayName: provider,
      state: 'not_found' as const,
      executablePath: null,
      version: null,
      issue: {
        code: 'PROVIDER_NOT_FOUND' as const,
        message: 'missing',
        recovery: 'install',
        retryable: true
      }
    }))
  };
}

function probeFailedResult(providers: readonly ProviderId[]): ProviderScanResult {
  return {
    scannedAt: '2026-07-23T07:30:00.000Z',
    providers: providers.map((provider) => ({
      provider,
      displayName: provider,
      state: 'probe_failed' as const,
      executablePath: `/usr/bin/${provider}`,
      version: null,
      issue: {
        code: 'PROVIDER_VERSION_PROBE_FAILED' as const,
        message: 'could not read version',
        recovery: 'retry',
        retryable: true
      }
    }))
  };
}

function readyResult(providers: readonly ProviderId[]): ProviderScanResult {
  return {
    scannedAt: '2026-07-23T07:30:00.000Z',
    providers: providers.map((provider) => ({
      provider,
      displayName: provider,
      state: 'ready' as const,
      executablePath: `/usr/bin/${provider}`,
      version: '1.0.0',
      issue: null
    }))
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

describe('ProviderScanCoordinator', () => {
  it('reports one measurement with coalesced caller counts', async () => {
    const onSettled = vi.fn();
    let elapsed = 10;
    const pending = deferred<ProviderScanResult>();
    const coordinator = new ProviderScanCoordinator(
      () => pending.promise,
      { monotonicClock: () => elapsed, onSettled }
    );

    const first = coordinator.scan(['codex']);
    const second = coordinator.scan(['codex']);
    elapsed = 42;
    pending.resolve(result(['codex']));
    await Promise.all([first, second]);

    expect(onSettled).toHaveBeenCalledOnce();
    expect(onSettled).toHaveBeenCalledWith({
      outcome: 'succeeded',
      durationMs: 32,
      cacheHits: 1,
      queued: 0,
      ready: 0,
      notFound: 1,
      probeFailed: 0
    });
  });

  it('shares one active scan for the same enabled-provider set', async () => {
    const pending = deferred<ProviderScanResult>();
    const scan = vi.fn(() => pending.promise);
    const coordinator = new ProviderScanCoordinator(scan);

    const first = coordinator.scan(['codex', 'claude']);
    const second = coordinator.scan(['codex', 'claude']);

    expect(scan).toHaveBeenCalledOnce();
    pending.resolve(result(['codex', 'claude']));
    await expect(Promise.all([first, second])).resolves.toHaveLength(2);
    expect(scan).toHaveBeenCalledOnce();
  });

  it('does not share scans across different provider policies', async () => {
    const scan = vi.fn(async (providers: readonly ProviderId[]) =>
      result(providers)
    );
    const coordinator = new ProviderScanCoordinator(scan);

    await Promise.all([
      coordinator.scan(['codex']),
      coordinator.scan(['codex', 'claude'])
    ]);

    expect(scan).toHaveBeenCalledTimes(2);
  });

  it('reuses a successful scan until its cache TTL expires', async () => {
    let elapsed = 100;
    const scan = vi.fn(async (providers: readonly ProviderId[]) =>
      readyResult(providers)
    );
    const coordinator = new ProviderScanCoordinator(scan, {
      cacheTtlMs: 500,
      monotonicClock: () => elapsed
    });

    const first = await coordinator.scan(['codex']);
    elapsed = 599;
    const cached = await coordinator.scan(['codex']);

    expect(cached).toBe(first);
    expect(scan).toHaveBeenCalledOnce();

    elapsed = 601;
    await coordinator.scan(['codex']);
    expect(scan).toHaveBeenCalledTimes(2);
  });

  it('lets a scan whose probe failed expire early', async () => {
    let elapsed = 100;
    const scan = vi.fn(async (providers: readonly ProviderId[]) =>
      probeFailedResult(providers)
    );
    const coordinator = new ProviderScanCoordinator(scan, {
      cacheTtlMs: 300_000,
      failedCacheTtlMs: 10_000,
      monotonicClock: () => elapsed
    });

    const first = await coordinator.scan(['codex']);
    elapsed = 10_099;
    expect(await coordinator.scan(['codex'])).toBe(first);
    expect(scan).toHaveBeenCalledOnce();

    // Well inside the 300s term a healthy scan would have kept, but past the
    // shortened one a miss gets.
    elapsed = 10_101;
    await coordinator.scan(['codex']);
    expect(scan).toHaveBeenCalledTimes(2);
  });

  it('keeps a scan that found a provider absent for the full term', async () => {
    let elapsed = 100;
    const scan = vi.fn(async (providers: readonly ProviderId[]) =>
      result(providers)
    );
    const coordinator = new ProviderScanCoordinator(scan, {
      cacheTtlMs: 300_000,
      failedCacheTtlMs: 10_000,
      monotonicClock: () => elapsed
    });

    const first = await coordinator.scan(['codex']);

    // A CLI that is not installed will not appear ten seconds later, so the
    // absence is worth the same term as a healthy scan.
    elapsed = 10_101;
    expect(await coordinator.scan(['codex'])).toBe(first);
    expect(scan).toHaveBeenCalledOnce();

    elapsed = 300_101;
    await coordinator.scan(['codex']);
    expect(scan).toHaveBeenCalledTimes(2);
  });

  it('hands back the last completed scan without starting another', async () => {
    let elapsed = 100;
    const scan = vi.fn(async (providers: readonly ProviderId[]) =>
      readyResult(providers)
    );
    const coordinator = new ProviderScanCoordinator(scan, {
      cacheTtlMs: 300_000,
      monotonicClock: () => elapsed
    });

    expect(coordinator.lastScan(['codex'])).toBeNull();

    const first = await coordinator.scan(['codex']);
    expect(coordinator.lastScan(['codex'])).toBe(first);

    // A reader that only wants to know what discovery already found must not
    // start discovery of its own, even once the cache term has passed.
    elapsed = 300_101;
    expect(coordinator.lastScan(['codex'])).toBe(first);
    expect(scan).toHaveBeenCalledOnce();
  });

  it('counts what each scan actually found', async () => {
    const onSettled = vi.fn();
    const coordinator = new ProviderScanCoordinator(
      async (providers) => ({
        ...result(providers),
        providers: [
          readyResult(['codex']).providers[0]!,
          result(['claude']).providers[0]!
        ]
      }),
      { onSettled }
    );

    await coordinator.scan(['codex', 'claude']);

    expect(onSettled).toHaveBeenCalledWith(
      expect.objectContaining({ ready: 1, notFound: 1, probeFailed: 0 })
    );
  });

  it('bypasses and replaces a completed cached scan when freshness is requested', async () => {
    let generation = 0;
    const scan = vi.fn(async (providers: readonly ProviderId[]) => ({
      ...readyResult(providers),
      scannedAt: `2026-07-23T07:30:0${generation++}.000Z`
    }));
    const coordinator = new ProviderScanCoordinator(scan, {
      cacheTtlMs: 30_000
    });

    const cached = await coordinator.scan(['codex']);
    expect(await coordinator.scan(['codex'])).toBe(cached);

    const refreshed = await coordinator.scanFresh(['codex']);
    expect(refreshed).not.toBe(cached);
    expect(await coordinator.scan(['codex'])).toBe(refreshed);
    expect(scan).toHaveBeenCalledTimes(2);
  });

  it('queues one force-fresh follow-up instead of overlapping older work', async () => {
    const older = deferred<ProviderScanResult>();
    const fresh = deferred<ProviderScanResult>();
    const scan = vi
      .fn<(providers: readonly ProviderId[]) => Promise<ProviderScanResult>>()
      .mockReturnValueOnce(older.promise)
      .mockReturnValueOnce(fresh.promise)
      .mockResolvedValue(result(['codex']));
    const coordinator = new ProviderScanCoordinator(scan);

    const olderRequest = coordinator.scan(['codex']);
    const freshRequest = coordinator.scanFresh(['codex']);
    const duplicateFreshRequest = coordinator.scanFresh(['codex']);
    const sharedFreshRequest = coordinator.scan(['codex']);

    expect(scan).toHaveBeenCalledOnce();
    older.resolve(result(['codex']));
    await expect(olderRequest).resolves.toEqual(result(['codex']));
    await vi.waitFor(() => expect(scan).toHaveBeenCalledTimes(2));

    fresh.resolve(result(['codex']));
    await expect(
      Promise.all([freshRequest, duplicateFreshRequest, sharedFreshRequest])
    ).resolves.toHaveLength(3);

    await coordinator.scan(['codex']);
    expect(scan).toHaveBeenCalledTimes(2);
  });

  it('rescans only the providers whose probe failed', async () => {
    let elapsed = 100;
    const scan = vi.fn(async (providers: readonly ProviderId[]) => ({
      scannedAt: '2026-07-23T07:30:00.000Z',
      providers: providers.map((provider) => (provider === 'claude' && scan.mock.calls.length === 1
        ? probeFailedResult([provider]).providers[0]!
        : readyResult([provider]).providers[0]!))
    }));
    const coordinator = new ProviderScanCoordinator(scan, {
      cacheTtlMs: 300_000,
      failedCacheTtlMs: 10_000,
      monotonicClock: () => elapsed
    });

    await coordinator.scan(['codex', 'claude']);
    elapsed = 10_101;
    const retried = await coordinator.scan(['codex', 'claude']);

    // One slow CLI must not send every other provider through discovery again.
    expect(scan.mock.calls.map(([providers]) => providers)).toEqual([
      ['codex', 'claude'],
      ['claude']
    ]);
    expect(retried.providers.map(({ provider, state }) => [provider, state])).toEqual([
      ['codex', 'ready'],
      ['claude', 'ready']
    ]);
    // With the miss resolved, the scan keeps the rest of its term.
    elapsed = 200_000;
    await coordinator.scan(['codex', 'claude']);
    expect(scan).toHaveBeenCalledTimes(2);
  });

  it('answers a launch from what discovery found, without scanning', async () => {
    const scan = vi.fn(async (providers: readonly ProviderId[]) => readyResult(providers));
    const coordinator = new ProviderScanCoordinator(scan);

    await coordinator.scan(['codex', 'claude', 'gemini']);
    const launch = await coordinator.installations(['codex', 'claude', 'gemini'], ['claude']);

    expect(launch.providers.map(({ provider }) => provider)).toEqual(['claude']);
    expect(scan).toHaveBeenCalledOnce();
  });

  it('probes only the launched provider when discovery has no ready answer for it', async () => {
    const scan = vi.fn(async (providers: readonly ProviderId[]) => readyResult(providers));
    const coordinator = new ProviderScanCoordinator(scan);

    const launch = await coordinator.installations(['codex', 'claude', 'gemini'], ['claude']);

    expect(scan.mock.calls.map(([providers]) => providers)).toEqual([['claude']]);
    expect(launch.providers.map(({ provider, state }) => [provider, state])).toEqual([['claude', 'ready']]);
    // A probe of one provider is not a scan of them all.
    expect(coordinator.lastScan(['codex', 'claude', 'gemini'])).toBeNull();
    // A provider the policy leaves out is not probed for a launch.
    await expect(coordinator.installations(['codex'], ['claude'])).resolves.toMatchObject({ providers: [] });
    expect(scan).toHaveBeenCalledOnce();
  });

  it('answers a stale launch at once and refreshes that provider in the background', async () => {
    let elapsed = 100;
    const pending = deferred<ProviderScanResult>();
    const scan = vi.fn()
      .mockImplementationOnce(async (providers: readonly ProviderId[]) => readyResult(providers))
      .mockImplementationOnce(() => pending.promise);
    const coordinator = new ProviderScanCoordinator(scan, {
      cacheTtlMs: 1_000,
      monotonicClock: () => elapsed
    });

    await coordinator.scan(['codex', 'claude']);
    elapsed = 5_000;
    const launch = await coordinator.installations(['codex', 'claude'], ['claude']);

    expect(launch.providers.map(({ provider }) => provider)).toEqual(['claude']);
    expect(scan.mock.calls.map(([providers]) => providers)).toEqual([['codex', 'claude'], ['claude']]);
    pending.resolve(readyResult(['claude']));
  });

  it('probes a provider again once a launch reports it broken, and on request', async () => {
    const scan = vi.fn(async (providers: readonly ProviderId[]) => readyResult(providers));
    const coordinator = new ProviderScanCoordinator(scan);

    await coordinator.scan(['codex', 'claude']);
    coordinator.invalidate(['codex', 'claude'], 'claude');
    await coordinator.installations(['codex', 'claude'], ['claude']);
    await coordinator.installations(['codex', 'claude'], ['claude']);
    await coordinator.installations(['codex', 'claude'], ['codex'], { fresh: true });

    expect(scan.mock.calls.map(([providers]) => providers)).toEqual([
      ['codex', 'claude'],
      ['claude'],
      ['codex']
    ]);
  });

  it('keeps the newer answer when an older probe of the same provider finishes last', async () => {
    const olderProbe = deferred<ProviderScanResult>();
    const newerScan = deferred<ProviderScanResult>();
    const scan = vi.fn()
      .mockImplementationOnce(() => olderProbe.promise)
      .mockImplementationOnce(() => newerScan.promise);
    const coordinator = new ProviderScanCoordinator(scan);

    const launch = coordinator.installations(['codex', 'claude'], ['codex']);
    const catalog = coordinator.scan(['codex', 'claude']);
    newerScan.resolve(readyResult(['codex', 'claude']));
    await catalog;
    olderProbe.resolve(probeFailedResult(['codex']));
    await launch;

    // The probe started first; its miss must not replace what the later scan found.
    await expect(coordinator.installations(['codex', 'claude'], ['codex'])).resolves
      .toMatchObject({ providers: [{ provider: 'codex', state: 'ready' }] });
    expect(coordinator.lastScan(['codex', 'claude'])?.providers[0]?.state).toBe('ready');
    expect(scan).toHaveBeenCalledTimes(2);
  });

  it('does not rescan every provider when a fresh scan interrupts a retry of failed ones', async () => {
    let elapsed = 100;
    const retry = deferred<ProviderScanResult>();
    const scan = vi.fn()
      .mockImplementationOnce(async () => ({
        scannedAt: '2026-07-23T07:30:00.000Z',
        providers: [readyResult(['codex']).providers[0]!, probeFailedResult(['claude']).providers[0]!]
      }))
      .mockImplementationOnce(() => retry.promise)
      .mockImplementation(async (providers: readonly ProviderId[]) => readyResult(providers));
    const coordinator = new ProviderScanCoordinator(scan, {
      cacheTtlMs: 300_000,
      failedCacheTtlMs: 10_000,
      monotonicClock: () => elapsed
    });

    await coordinator.scan(['codex', 'claude']);
    elapsed = 10_101;
    const retrying = coordinator.scan(['codex', 'claude']);
    const fresh = coordinator.scanFresh(['codex', 'claude']);
    retry.resolve(readyResult(['claude']));
    await Promise.all([retrying, fresh]);

    // The first scan, the retry of the failed provider, and the one fresh scan asked for.
    expect(scan.mock.calls.map(([providers]) => providers)).toEqual([
      ['codex', 'claude'],
      ['claude'],
      ['codex', 'claude']
    ]);
  });

  it('keeps state for only the few most recent enabled-provider lists', async () => {
    const scan = vi.fn(async (providers: readonly ProviderId[]) => readyResult(providers));
    const coordinator = new ProviderScanCoordinator(scan);

    await coordinator.scan(['codex']);
    for (const providers of [['claude'], ['gemini'], ['qwen'], ['kimi']] as ProviderId[][]) {
      await coordinator.scan(providers);
    }

    // Each change to the enabled providers starts a new list; old ones are let go.
    expect(coordinator.lastScan(['codex'])).toBeNull();
    expect(coordinator.lastScan(['kimi'])).not.toBeNull();
  });

  it('starts a fresh scan after an active scan rejects', async () => {
    const scan = vi
      .fn<(providers: readonly ProviderId[]) => Promise<ProviderScanResult>>()
      .mockRejectedValueOnce(new Error('scan failed'))
      .mockResolvedValueOnce(result(['codex']));
    const coordinator = new ProviderScanCoordinator(scan);

    await expect(coordinator.scan(['codex'])).rejects.toThrow('scan failed');
    await expect(coordinator.scan(['codex'])).resolves.toEqual(
      result(['codex'])
    );

    expect(scan).toHaveBeenCalledTimes(2);
  });
});
