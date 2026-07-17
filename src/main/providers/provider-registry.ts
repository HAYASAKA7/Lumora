import {
  ProviderScanResultSchema,
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

  async scan(): Promise<ProviderScanResult> {
    const providers = await Promise.all(
      this.adapters.map((adapter) => this.scanIsolated(adapter))
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
