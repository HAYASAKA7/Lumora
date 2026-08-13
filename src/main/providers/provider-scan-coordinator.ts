import type {
  ProviderId,
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
}

interface ProviderScanCoordinatorOptions {
  monotonicClock?: () => number;
  onSettled?: (measurement: ProviderScanMeasurement) => void;
}

export class ProviderScanCoordinator {
  private readonly active = new Map<string, ActiveScan>();
  private readonly pendingFresh = new Map<string, PendingFreshScan>();

  constructor(
    private readonly scanProviders: ScanProviders,
    private readonly options: ProviderScanCoordinatorOptions = {}
  ) {}

  scan(providers: readonly ProviderId[]): Promise<ProviderScanResult> {
    const key = this.keyOf(providers);
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
    return this.startScan(key, providers);
  }

  scanFresh(providers: readonly ProviderId[]): Promise<ProviderScanResult> {
    const key = this.keyOf(providers);
    const current = this.active.get(key);
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

  private keyOf(providers: readonly ProviderId[]): string {
    return providers.join('\u0000');
  }

  private startScan(
    key: string,
    providers: readonly ProviderId[],
    cacheHits = 0,
    queued = 0
  ): Promise<ProviderScanResult> {
    const selectedProviders = [...providers];
    const monotonicClock = this.options.monotonicClock ?? (() => performance.now());
    const startedAt = monotonicClock();
    let entry!: ActiveScan;
    const promise = (async () => {
      let outcome: ProviderScanMeasurement['outcome'] = 'succeeded';
      try {
        return await this.scanProviders(selectedProviders);
      } catch (error) {
        outcome = 'failed';
        throw error;
      } finally {
        try {
          this.options.onSettled?.({
            outcome,
            durationMs: Math.max(
              0,
              Math.min(86_400_000, Math.round(monotonicClock() - startedAt))
            ),
            cacheHits: entry.cacheHits,
            queued: entry.queued
          });
        } catch {
          // Measurement consumers cannot change discovery behavior.
        }
      }
    })();
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
}
