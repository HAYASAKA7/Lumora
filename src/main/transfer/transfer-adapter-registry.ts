import type { ProviderId, SystemInfo } from '../../shared/contracts';
import type { TransferSupport } from '../../shared/session-transfer';
import {
  SESSION_PROVIDER_IDS,
  providerDefinition
} from '../../shared/provider-definitions';
import type {
  ProviderTransferAdapter,
  VerifiedTransferRoute
} from './transfer-adapter';
import { VERIFIED_TRANSFER_ROUTES } from './verified-transfer-routes';

interface ProviderTransferState {
  installed: boolean;
  enabled: boolean;
  version: string | null;
}

export interface TransferCapabilityDescriptor {
  provider: ProviderId;
  displayName: string;
  export: TransferSupport;
  import: TransferSupport;
}

export interface TransferAdapterRegistry {
  get(provider: ProviderId): ProviderTransferAdapter | null;
  providers(): ProviderId[];
  capabilities(
    destinationPlatform: SystemInfo['platform'],
    sourcePlatform?: SystemInfo['platform']
  ): TransferCapabilityDescriptor[];
}

interface CreateTransferAdapterRegistryOptions {
  adapters?: readonly ProviderTransferAdapter[];
  verifiedRoutes?: readonly VerifiedTransferRoute[];
  providerState?: (provider: ProviderId) => ProviderTransferState;
  allowExperimentalRoutes?: boolean;
}

function stateSupport(state: ProviderTransferState): TransferSupport | null {
  if (!state.enabled) return 'provider_disabled';
  if (!state.installed) return 'provider_not_installed';
  return null;
}

export function createTransferAdapterRegistry({
  adapters = [],
  verifiedRoutes = VERIFIED_TRANSFER_ROUTES,
  providerState = () => ({ installed: true, enabled: true, version: null }),
  allowExperimentalRoutes = false
}: CreateTransferAdapterRegistryOptions = {}): TransferAdapterRegistry {
  const byProvider = new Map<ProviderId, ProviderTransferAdapter>();
  for (const adapter of adapters) {
    if (byProvider.has(adapter.provider)) {
      throw new Error(`Duplicate transfer adapter: ${adapter.provider}`);
    }
    byProvider.set(adapter.provider, adapter);
  }

  return {
    get(provider) {
      return byProvider.get(provider) ?? null;
    },
    providers() {
      return [...byProvider.keys()];
    },
    capabilities(destinationPlatform, sourcePlatform = destinationPlatform) {
      return SESSION_PROVIDER_IDS.map((provider) => {
        const definition = providerDefinition(provider);
        const state = providerState(provider);
        const unavailable = stateSupport(state);
        if (unavailable !== null) {
          return {
            provider,
            displayName: definition.displayName,
            export: unavailable,
            import: unavailable
          };
        }
        const adapter = byProvider.get(provider);
        if (adapter === undefined) {
          return {
            provider,
            displayName: definition.displayName,
            export: 'route_unverified' as const,
            import: 'route_unverified' as const
          };
        }
        if (allowExperimentalRoutes) {
          return {
            provider,
            displayName: definition.displayName,
            export: 'experimental' as const,
            import: 'experimental' as const
          };
        }
        const route = verifiedRoutes.find(
          (candidate) =>
            candidate.provider === provider &&
            candidate.sourcePlatform === sourcePlatform &&
            candidate.destinationPlatform === destinationPlatform &&
            candidate.providerVersion === state.version
        );
        if (route === undefined || state.version === null) {
          return {
            provider,
            displayName: definition.displayName,
            export: 'route_unverified' as const,
            import: 'route_unverified' as const
          };
        }
        const capability = adapter.capabilities({
          sourcePlatform,
          destinationPlatform,
          providerVersion: state.version
        });
        return {
          provider,
          displayName: definition.displayName,
          export: capability.export ? ('supported' as const) : ('route_unverified' as const),
          import: capability.import ? ('supported' as const) : ('route_unverified' as const)
        };
      });
    }
  };
}
