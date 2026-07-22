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

type Clock = () => Date;

export class ProviderRegistry {
  constructor(
    private readonly adapters: readonly ProviderAdapter[],
    private readonly now: Clock = () => new Date()
  ) {}

  async scan(
    enabledProviders?: readonly ProviderId[]
  ): Promise<ProviderScanResult> {
    const enabled =
      enabledProviders === undefined ? null : new Set(enabledProviders);
    const providers = await Promise.all(
      this.adapters
        .filter((adapter) => enabled === null || enabled.has(adapter.provider))
        .map((adapter) => this.scanIsolated(adapter))
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
