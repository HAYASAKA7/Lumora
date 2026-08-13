import {
  ProviderScanResultSchema,
  type ProviderId,
  type ProviderInstallation,
  type ProviderScanResult
} from '../../shared/contracts';
import {
  createUnexpectedScanFailure,
  type ProviderAdapter
} from './provider-adapter';
import { mapWithConcurrency } from '../performance/map-with-concurrency';

type Clock = () => Date;

export class ProviderRegistry {
  constructor(
    private readonly adapters: readonly ProviderAdapter[],
    private readonly now: Clock = () => new Date(),
    private readonly concurrency = 4
  ) {}

  async scan(
    enabledProviders?: readonly ProviderId[]
  ): Promise<ProviderScanResult> {
    const enabled =
      enabledProviders === undefined ? null : new Set(enabledProviders);
    const selectedAdapters = this.adapters.filter(
      (adapter) => enabled === null || enabled.has(adapter.provider)
    );
    const providers = await mapWithConcurrency(
      selectedAdapters,
      this.concurrency,
      (adapter) => this.scanIsolated(adapter)
    );

    return ProviderScanResultSchema.parse({
      scannedAt: this.now().toISOString(),
      providers
    });
  }

  private async scanIsolated(
    adapter: ProviderAdapter
  ): Promise<ProviderInstallation> {
    try {
      return await adapter.scan();
    } catch {
      return createUnexpectedScanFailure(adapter);
    }
  }
}
