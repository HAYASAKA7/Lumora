import type {
  ProviderInstallation,
  ProviderScanResult,
  StructuredProviderPreference
} from '../../../shared/contracts';
import { providerDefinition } from '../../../shared/provider-definitions';
import {
  STRUCTURED_AGENT_PROVIDER_IDS,
  type StructuredAgentProviderId
} from '../../../shared/agent/contracts';

interface ResolveStructuredProviderInstallationsOptions {
  scan: ProviderScanResult;
  preferences: readonly StructuredProviderPreference[];
  probeVersion(
    executablePath: string,
    args: readonly string[]
  ): Promise<string>;
}

function isStructuredProvider(
  providerId: ProviderInstallation['provider']
): providerId is StructuredAgentProviderId {
  return STRUCTURED_AGENT_PROVIDER_IDS.some(
    (candidate) => candidate === providerId
  );
}

export async function resolveStructuredProviderInstallations({
  scan,
  preferences,
  probeVersion
}: ResolveStructuredProviderInstallationsOptions): Promise<ProviderInstallation[]> {
  const overrides = new Map(
    preferences.flatMap((preference) =>
      preference.executablePathOverride === null
        ? []
        : [[preference.providerId, preference.executablePathOverride] as const]
    )
  );

  return Promise.all(scan.providers.map(async (installation) => {
    if (!isStructuredProvider(installation.provider)) return installation;
    const override = overrides.get(installation.provider);
    if (override === undefined) return installation;
    const definition = providerDefinition(installation.provider);
    try {
      const version = await probeVersion(override, definition.versionArgs);
      return {
        provider: installation.provider,
        displayName: definition.displayName,
        state: 'ready' as const,
        executablePath: override,
        version,
        issue: null
      };
    } catch {
      return {
        provider: installation.provider,
        displayName: definition.displayName,
        state: 'probe_failed' as const,
        executablePath: override,
        version: null,
        issue: {
          code: 'PROVIDER_VERSION_PROBE_FAILED' as const,
          message: `Lumora found the structured ${definition.displayName} override but could not read its version.`,
          recovery: 'Choose a compatible executable path or clear the structured override, then check interfaces again.',
          retryable: true
        }
      };
    }
  }));
}
