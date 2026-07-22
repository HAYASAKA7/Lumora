import {
  DEFAULT_GENERAL_SETTINGS,
  GeneralSettingsSchema,
  type ProviderId
} from '../../shared/contracts';

export interface ProviderPolicy {
  providers(): readonly ProviderId[];
  isEnabled(provider: ProviderId): boolean;
  replace(providers: readonly ProviderId[]): void;
}

function canonicalProviders(providers: readonly ProviderId[]): ProviderId[] {
  if (providers.length === 0) {
    throw new Error('At least one enabled provider is required.');
  }
  return GeneralSettingsSchema.parse({
    ...DEFAULT_GENERAL_SETTINGS,
    enabledProviders: [...providers]
  }).enabledProviders;
}

export function createProviderPolicy(
  initialProviders: readonly ProviderId[] = DEFAULT_GENERAL_SETTINGS.enabledProviders
): ProviderPolicy {
  let enabled = canonicalProviders(initialProviders);

  return Object.freeze({
    providers: () => [...enabled],
    isEnabled: (provider: ProviderId) => enabled.includes(provider),
    replace(providers: readonly ProviderId[]) {
      enabled = canonicalProviders(providers);
    }
  });
}
