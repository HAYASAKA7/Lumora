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
      queued: 0
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

  it('starts a fresh scan after the previous scan settles', async () => {
    const scan = vi.fn(async (providers: readonly ProviderId[]) =>
      result(providers)
    );
    const coordinator = new ProviderScanCoordinator(scan);

    await coordinator.scan(['codex']);
    await coordinator.scan(['codex']);

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
    expect(scan).toHaveBeenCalledTimes(3);
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
