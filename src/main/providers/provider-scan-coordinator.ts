import type {
  ProviderId,
  ProviderInstallation,
  ProviderScanResult
} from '../../shared/contracts';

type ScanProviders = (
  providers: readonly ProviderId[]
) => Promise<ProviderScanResult>;

interface ActiveScan {
  promise: Promise<ProviderScanResult>;
  cacheHits: number;
  queued: number;
}

interface PendingFreshScan extends ActiveScan {
  providers: readonly ProviderId[];
  resolve(value: ProviderScanResult): void;
  reject(error: unknown): void;
}

interface ProviderScanMeasurement {
  outcome: 'succeeded' | 'failed';
  durationMs: number;
  cacheHits: number;
  queued: number;
  /** Per-provider states, so a scan that found nothing leaves a trace. */
  ready: number;
  notFound: number;
  probeFailed: number;
}

interface ProviderScanCoordinatorOptions {
  monotonicClock?: () => number;
  onSettled?: (measurement: ProviderScanMeasurement) => void;
  cacheTtlMs?: number;
  /**
   * How long a scan whose probe failed may be reused. That miss is often
   * transient — a busy machine, a slow CLI — and caching it for the full term
   * leaves the provider marked broken long after it recovered.
   */
  failedCacheTtlMs?: number;
}

/**
 * Long enough to still absorb the burst of scans the catalog, the terminal and
 * the launch gate fire at each other, short enough that a broken install
 * clears itself.
 */
const DEFAULT_FAILED_CACHE_TTL_MS = 10_000;

/** Enabled-provider lists kept: the current one and a few recent changes. */
const MAX_REMEMBERED_PROVIDER_LISTS = 4;

type ProviderStateCounts = Pick<
  ProviderScanMeasurement,
  'ready' | 'notFound' | 'probeFailed'
>;

const EMPTY_STATE_COUNTS: ProviderStateCounts = Object.freeze({
  ready: 0,
  notFound: 0,
  probeFailed: 0
});

function countStates(result: ProviderScanResult): ProviderStateCounts {
  let ready = 0;
  let notFound = 0;
  let probeFailed = 0;
  for (const provider of result.providers) {
    if (provider.state === 'ready') ready += 1;
    else if (provider.state === 'not_found') notFound += 1;
    else probeFailed += 1;
  }
  return { ready, notFound, probeFailed };
}

function failedProviders(result: ProviderScanResult): ProviderId[] {
  return result.providers
    .filter(({ state }) => state === 'probe_failed')
    .map(({ provider }) => provider);
}

interface CachedScan {
  result: ProviderScanResult;
  /** When the next reader rescans: early when a probe failed. */
  expiresAt: number;
  /** When the providers that answered are due for discovery again. */
  fullExpiresAt: number;
}

export class ProviderScanCoordinator {
  private readonly active = new Map<string, ActiveScan>();
  private readonly pendingFresh = new Map<string, PendingFreshScan>();
  private readonly cache = new Map<string, CachedScan>();
  private readonly completed = new Map<string, ProviderScanResult>();
  /** The latest answer for each provider, from full scans and single probes alike. */
  private readonly known = new Map<string, Map<ProviderId, ProviderInstallation>>();
  private readonly knownAt = new Map<string, Map<ProviderId, number>>();
  /** The order in which the scan behind each known answer started. */
  private readonly knownGeneration = new Map<string, Map<ProviderId, number>>();
  private readonly probing = new Map<string, Promise<ProviderScanResult>>();
  private readonly invalidated = new Map<string, Set<ProviderId>>();
  /** Enabled-provider lists in use, oldest first; older lists are let go. */
  private readonly recentKeys: string[] = [];
  private generation = 0;
  private readonly monotonicClock: () => number;
  private readonly cacheTtlMs: number;
  private readonly failedCacheTtlMs: number;

  constructor(
    private readonly scanProviders: ScanProviders,
    private readonly options: ProviderScanCoordinatorOptions = {}
  ) {
    this.monotonicClock = options.monotonicClock ?? (() => performance.now());
    this.cacheTtlMs = Math.max(
      0,
      Math.min(5 * 60_000, options.cacheTtlMs ?? 5 * 60_000)
    );
    this.failedCacheTtlMs = Math.min(
      this.cacheTtlMs,
      Math.max(
        0,
        options.failedCacheTtlMs ?? DEFAULT_FAILED_CACHE_TTL_MS
      )
    );
  }

  scan(providers: readonly ProviderId[]): Promise<ProviderScanResult> {
    const key = this.keyOf(providers);
    this.touch(key);
    const pendingFresh = this.pendingFresh.get(key);
    if (pendingFresh !== undefined) {
      pendingFresh.cacheHits += 1;
      return pendingFresh.promise;
    }
    const current = this.active.get(key);
    if (current !== undefined) {
      current.cacheHits += 1;
      return current.promise;
    }
    const cached = this.cache.get(key);
    if (cached !== undefined) {
      const now = this.monotonicClock();
      if (cached.expiresAt >= now) {
        return Promise.resolve(cached.result);
      }
      // Only the providers whose probe failed are due; the rest keep their term.
      const failed = failedProviders(cached.result);
      if (cached.fullExpiresAt >= now && failed.length > 0) {
        return this.startScan(key, providers, 0, 0, failed);
      }
      this.cache.delete(key);
    }
    return this.startScan(key, providers);
  }

  /**
   * What discovery last found, with no scan of its own. A reader that only
   * needs the picture the rest of the app is already showing — the capability
   * check behind the interface list, say — should not walk the filesystem
   * again to draw it.
   */
  lastScan(providers: readonly ProviderId[]): ProviderScanResult | null {
    return this.completed.get(this.keyOf(providers)) ?? null;
  }

  scanFresh(providers: readonly ProviderId[]): Promise<ProviderScanResult> {
    const key = this.keyOf(providers);
    this.touch(key);
    const current = this.active.get(key);
    this.cache.delete(key);
    if (current === undefined) return this.startScan(key, providers);

    const existing = this.pendingFresh.get(key);
    if (existing !== undefined) {
      existing.cacheHits += 1;
      return existing.promise;
    }

    let resolve!: (value: ProviderScanResult) => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<ProviderScanResult>((resolvePromise, rejectPromise) => {
      resolve = resolvePromise;
      reject = rejectPromise;
    });
    const pending: PendingFreshScan = {
      providers: [...providers],
      promise,
      cacheHits: 0,
      queued: 1,
      resolve,
      reject
    };
    this.pendingFresh.set(key, pending);
    void current.promise
      .finally(() => {
        if (this.pendingFresh.get(key) !== pending) return;
        this.pendingFresh.delete(key);
        this.cache.delete(key);
        void this.startScan(
          key,
          pending.providers,
          pending.cacheHits,
          pending.queued
        ).then(resolve, reject);
      })
      .catch(() => undefined);
    return promise;
  }

  /**
   * The installations one launch needs, out of the enabled `providers`.
   *
   * A launch answers from what discovery last found for each provider it
   * needs, and refreshes an answer past its term in the background instead of
   * making the launch wait. Only a provider with no ready answer — never found,
   * last probe failed, or reported broken — is probed now, on its own. Other
   * providers are never scanned for it.
   */
  async installations(
    providers: readonly ProviderId[],
    wanted: readonly ProviderId[],
    options: { fresh?: boolean } = {}
  ): Promise<ProviderScanResult> {
    const key = this.keyOf(providers);
    this.touch(key);
    const needed = wanted.filter((provider) => providers.includes(provider));
    if (needed.length === 0) return this.pick(key, needed);
    if (options.fresh === true) {
      await this.probe(key, needed);
      return this.pick(key, needed);
    }
    const known = this.known.get(key);
    const invalidated = this.invalidated.get(key);
    const due = needed.filter((provider) => (
      known?.get(provider)?.state !== 'ready' || invalidated?.has(provider) === true
    ));
    if (due.length > 0) {
      await this.probe(key, due);
    }
    const now = this.monotonicClock();
    const stale = needed.filter((provider) => (
      !due.includes(provider) &&
      (this.knownAt.get(key)?.get(provider) ?? -Infinity) + this.cacheTtlMs < now
    ));
    if (stale.length > 0) {
      void this.probe(key, stale).catch(() => undefined);
    }
    return this.pick(key, needed);
  }

  /** Marks a provider a launch found broken, so the next launch probes it again. */
  invalidate(providers: readonly ProviderId[], provider: ProviderId): void {
    const key = this.keyOf(providers);
    const invalidated = this.invalidated.get(key) ?? new Set<ProviderId>();
    invalidated.add(provider);
    this.invalidated.set(key, invalidated);
  }

  private keyOf(providers: readonly ProviderId[]): string {
    return providers.join('\u0000');
  }

  /**
   * Marks a list of enabled providers as in use. Changing which providers are
   * enabled starts a new list, so only the few most recent keep their state.
   */
  private touch(key: string): void {
    const index = this.recentKeys.indexOf(key);
    if (index >= 0) this.recentKeys.splice(index, 1);
    this.recentKeys.push(key);
    while (this.recentKeys.length > MAX_REMEMBERED_PROVIDER_LISTS) {
      const evicted = this.recentKeys.shift()!;
      for (const state of [
        this.cache, this.completed, this.known, this.knownAt, this.knownGeneration, this.invalidated
      ]) {
        state.delete(evicted);
      }
    }
  }

  private pick(key: string, providers: readonly ProviderId[]): ProviderScanResult {
    const known = this.known.get(key);
    return {
      scannedAt: new Date().toISOString(),
      providers: providers.flatMap((provider) => {
        const installation = known?.get(provider);
        return installation === undefined ? [] : [installation];
      })
    };
  }

  /** Probes some providers on their own, sharing a probe already under way. */
  private probe(key: string, providers: readonly ProviderId[]): Promise<ProviderScanResult> {
    const probeKey = `${key}::${providers.join(',')}`;
    const current = this.probing.get(probeKey);
    if (current !== undefined) return current;
    const promise = this.measure(providers, 0, 0, async () => {
      const generation = ++this.generation;
      const result = await this.scanProviders(providers);
      this.remember(key, result, generation);
      return result;
    }).finally(() => {
      if (this.probing.get(probeKey) === promise) this.probing.delete(probeKey);
    });
    this.probing.set(probeKey, promise);
    return promise;
  }

  /**
   * Records each provider's answer from a scan that started as `generation`.
   * Scans overlap, and the one that finishes last is not always the newest, so
   * an answer only replaces one from a scan that started earlier.
   */
  private recordKnown(
    key: string,
    result: ProviderScanResult,
    generation: number
  ): Map<ProviderId, ProviderInstallation> {
    const now = this.monotonicClock();
    const known = this.known.get(key) ?? new Map<ProviderId, ProviderInstallation>();
    const knownAt = this.knownAt.get(key) ?? new Map<ProviderId, number>();
    const knownGeneration = this.knownGeneration.get(key) ?? new Map<ProviderId, number>();
    const invalidated = this.invalidated.get(key);
    for (const installation of result.providers) {
      if ((knownGeneration.get(installation.provider) ?? 0) > generation) continue;
      known.set(installation.provider, installation);
      knownAt.set(installation.provider, now);
      knownGeneration.set(installation.provider, generation);
      invalidated?.delete(installation.provider);
    }
    this.known.set(key, known);
    this.knownAt.set(key, knownAt);
    this.knownGeneration.set(key, knownGeneration);
    return known;
  }

  /** Records a probe of some providers and folds it into the whole scan they belong to. */
  private remember(key: string, result: ProviderScanResult, generation: number): void {
    const now = this.monotonicClock();
    const known = this.recordKnown(key, result, generation);
    const merge = (base: ProviderScanResult): ProviderScanResult => ({
      scannedAt: result.scannedAt,
      providers: base.providers.map((installation) => known.get(installation.provider) ?? installation)
    });
    const completed = this.completed.get(key);
    if (completed !== undefined) this.completed.set(key, merge(completed));
    const cached = this.cache.get(key);
    if (cached !== undefined) {
      const merged = merge(cached.result);
      this.cache.set(key, {
        result: merged,
        fullExpiresAt: cached.fullExpiresAt,
        expiresAt: failedProviders(merged).length === 0
          ? cached.fullExpiresAt
          : Math.min(cached.fullExpiresAt, now + this.failedCacheTtlMs)
      });
    }
  }

  private startScan(
    key: string,
    providers: readonly ProviderId[],
    cacheHits = 0,
    queued = 0,
    onlyFailed?: readonly ProviderId[]
  ): Promise<ProviderScanResult> {
    const selectedProviders = [...providers];
    let entry!: ActiveScan;
    const promise = this.measure(onlyFailed ?? selectedProviders, cacheHits, queued, async () => {
      const generation = ++this.generation;
      if (onlyFailed !== undefined) {
        this.remember(key, await this.scanProviders(onlyFailed), generation);
        // A fresh scan may have dropped the cache meanwhile; it scans everything
        // itself, so this retry answers from the scan it just updated.
        const merged = this.cache.get(key)?.result ?? this.completed.get(key);
        if (merged !== undefined) return merged;
      }
      const scanned = await this.scanProviders(selectedProviders);
      const known = this.recordKnown(key, scanned, generation);
      const result = scanned.providers.every((installation) => known.get(installation.provider) === installation)
        ? scanned
        : { ...scanned, providers: scanned.providers.map((installation) => known.get(installation.provider) ?? installation) };
      this.completed.set(key, result);
      this.cache.delete(key);
      // Only a failed probe is worth retrying soon. A provider that is
      // simply not installed will not appear ten seconds later, and letting
      // its absence shorten the term made every reader of this cache pay for
      // a rescan whenever one uninstalled CLI was enabled.
      const now = this.monotonicClock();
      if (this.cacheTtlMs > 0) {
        const fullExpiresAt = now + this.cacheTtlMs;
        this.cache.set(key, {
          result,
          fullExpiresAt,
          expiresAt: failedProviders(result).length === 0
            ? fullExpiresAt
            : now + this.failedCacheTtlMs
        });
      }
      return result;
    }, () => entry);
    entry = { promise, cacheHits, queued };
    this.active.set(key, entry);
    void entry.promise
      .finally(() => {
        if (this.active.get(key) === entry) {
          this.active.delete(key);
        }
      })
      .catch(() => undefined);
    return entry.promise;
  }

  private measure(
    providers: readonly ProviderId[],
    cacheHits: number,
    queued: number,
    run: () => Promise<ProviderScanResult>,
    entry?: () => ActiveScan
  ): Promise<ProviderScanResult> {
    const startedAt = this.monotonicClock();
    return (async () => {
      let outcome: ProviderScanMeasurement['outcome'] = 'succeeded';
      let states = EMPTY_STATE_COUNTS;
      try {
        const result = await run();
        states = countStates({
          ...result,
          providers: result.providers.filter(({ provider }) => providers.includes(provider))
        });
        return result;
      } catch (error) {
        outcome = 'failed';
        throw error;
      } finally {
        try {
          const active = entry?.();
          this.options.onSettled?.({
            outcome,
            durationMs: Math.max(
              0,
              Math.min(
                86_400_000,
                Math.round(this.monotonicClock() - startedAt)
              )
            ),
            cacheHits: active?.cacheHits ?? cacheHits,
            queued: active?.queued ?? queued,
            ...states
          });
        } catch {
          // Measurement consumers cannot change discovery behavior.
        }
      }
    })();
  }
}
