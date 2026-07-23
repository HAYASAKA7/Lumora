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

export class ProviderScanCoordinator {
  private readonly active = new Map<string, ActiveScan>();

  constructor(private readonly scanProviders: ScanProviders) {}

  scan(providers: readonly ProviderId[]): Promise<ProviderScanResult> {
    const key = this.keyOf(providers);
    const current = this.active.get(key);
    if (current !== undefined) {
      return current.promise;
    }
    return this.startScan(key, providers);
  }

  scanFresh(providers: readonly ProviderId[]): Promise<ProviderScanResult> {
    return this.startScan(this.keyOf(providers), providers);
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
