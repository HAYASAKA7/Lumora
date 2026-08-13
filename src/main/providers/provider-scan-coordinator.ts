import type {
  ProviderId,
  ProviderScanResult
} from '../../shared/contracts';

type ScanProviders = (
  providers: readonly ProviderId[]
) => Promise<ProviderScanResult>;

interface ActiveScan {
  promise: Promise<ProviderScanResult>;
}

interface PendingFreshScan extends ActiveScan {
  providers: readonly ProviderId[];
  resolve(value: ProviderScanResult): void;
  reject(error: unknown): void;
}

export class ProviderScanCoordinator {
  private readonly active = new Map<string, ActiveScan>();
  private readonly pendingFresh = new Map<string, PendingFreshScan>();

  constructor(private readonly scanProviders: ScanProviders) {}

  scan(providers: readonly ProviderId[]): Promise<ProviderScanResult> {
    const key = this.keyOf(providers);
    const pendingFresh = this.pendingFresh.get(key);
    if (pendingFresh !== undefined) {
      return pendingFresh.promise;
    }
    const current = this.active.get(key);
    if (current !== undefined) {
      return current.promise;
    }
    return this.startScan(key, providers);
  }

  scanFresh(providers: readonly ProviderId[]): Promise<ProviderScanResult> {
    const key = this.keyOf(providers);
    const current = this.active.get(key);
    if (current === undefined) return this.startScan(key, providers);

    const existing = this.pendingFresh.get(key);
    if (existing !== undefined) return existing.promise;

    let resolve!: (value: ProviderScanResult) => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<ProviderScanResult>((resolvePromise, rejectPromise) => {
      resolve = resolvePromise;
      reject = rejectPromise;
    });
    const pending: PendingFreshScan = {
      providers: [...providers],
      promise,
      resolve,
      reject
    };
    this.pendingFresh.set(key, pending);
    void current.promise
      .finally(() => {
        if (this.pendingFresh.get(key) !== pending) return;
        this.pendingFresh.delete(key);
        void this.startScan(key, pending.providers).then(resolve, reject);
      })
      .catch(() => undefined);
    return promise;
  }

  private keyOf(providers: readonly ProviderId[]): string {
    return providers.join('\u0000');
  }

  private startScan(
    key: string,
    providers: readonly ProviderId[]
  ): Promise<ProviderScanResult> {
    const selectedProviders = [...providers];
    const entry: ActiveScan = {
      promise: this.scanProviders(selectedProviders)
    };
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
