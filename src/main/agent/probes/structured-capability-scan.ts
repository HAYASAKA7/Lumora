import type {
  ProviderInstallation,
  ProviderScanResult,
  StructuredProviderPreference
} from '../../../shared/contracts';
import type { StructuredProviderCapabilityReport } from '../../../shared/agent/provider-capabilities';

interface StructuredCapabilityScanDependencies {
  /** What discovery already found, without starting a scan. */
  lastScan(): ProviderScanResult | null;
  scan(): Promise<ProviderScanResult>;
  scanFresh(): Promise<ProviderScanResult>;
  resolveInstallations(input: {
    scan: ProviderScanResult;
    preferences: readonly StructuredProviderPreference[];
  }): Promise<readonly ProviderInstallation[]>;
  probe(
    installations: readonly ProviderInstallation[],
    fresh: boolean
  ): Promise<readonly StructuredProviderCapabilityReport[]>;
}

/**
 * Which providers are worth interrogating. A provider with no preference row
 * yet is enabled, matching how a launch routes it.
 */
function turnedOn(
  installation: ProviderInstallation,
  preferences: readonly StructuredProviderPreference[]
): boolean {
  const preference = preferences.find(
    (candidate) => candidate.providerId === installation.provider
  );
  return preference?.useUnifiedWhenAvailable ?? true;
}

/**
 * Reports what each provider's own interface can do.
 *
 * The expensive half is the probe: it launches the agent's CLI and asks it, so
 * the check stays as narrow as it can be. It reuses the discovery the rest of
 * the app already has rather than repeating it, and it asks only the providers
 * that could actually route to the unified interface.
 */
export function createStructuredCapabilityScan(
  dependencies: StructuredCapabilityScanDependencies
): (
  fresh: boolean,
  preferences: readonly StructuredProviderPreference[]
) => Promise<readonly StructuredProviderCapabilityReport[]> {
  return async (fresh, preferences) => {
    const scan = fresh
      ? await dependencies.scanFresh()
      : dependencies.lastScan() ?? await dependencies.scan();
    const installations = await dependencies.resolveInstallations({
      scan,
      preferences
    });
    return dependencies.probe(
      installations.filter((entry) => turnedOn(entry, preferences)),
      fresh
    );
  };
}
