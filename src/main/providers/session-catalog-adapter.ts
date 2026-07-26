import type { ProviderId, ProviderInstallation } from '../../shared/contracts';
import {
  SESSION_PROVIDER_IDS,
  hasCompleteSessionSupport
} from '../../shared/provider-definitions';
import type { ProviderSessionDiscoveryResult } from './session-discovery';

export type ReadyProviderInstallation = Extract<
  ProviderInstallation,
  { state: 'ready' }
>;

export type SessionAdapterCompatibility =
  | { compatible: true }
  | { compatible: false; recovery: string };

export function validateInstalledProviderCompatibility(
  installation: ReadyProviderInstallation
): SessionAdapterCompatibility {
  const version = installation.version.trim();
  if (!/\d+\.\d+(?:\.\d+)?(?:[-+][0-9A-Za-z.-]+)?/.test(version)) {
    return {
      compatible: false,
      recovery: `Update ${installation.displayName}, then refresh provider discovery.`
    };
  }
  return { compatible: true };
}

export interface SessionCatalogAdapter {
  readonly provider: ProviderId;
  discover(
    installation: ReadyProviderInstallation
  ): Promise<ProviderSessionDiscoveryResult>;
  validateCompatibility(
    installation: ReadyProviderInstallation
  ): SessionAdapterCompatibility;
  buildResumeArguments(
    nativeSessionId: string,
    startPrompt: string
  ): readonly string[];
  buildForkArguments?(
    nativeSessionId: string,
    startPrompt: string
  ): readonly string[];
  snapshotHandoff: SessionHandoffSnapshotter;
}

export interface SessionHandoffSnapshotRequest {
  nativeSessionId: string;
  sourceKeys: readonly string[];
  installation: ReadyProviderInstallation;
  sourceDirectory: string;
}

export interface SessionHandoffSnapshot {
  raw: string;
  sourceFiles: string[];
}

export type SessionHandoffSnapshotter = (
  request: SessionHandoffSnapshotRequest
) => Promise<SessionHandoffSnapshot>;

export interface SessionCatalogRegistry {
  providers(): readonly ProviderId[];
  get(provider: ProviderId): SessionCatalogAdapter | null;
}

export function createSessionCatalogRegistry(
  adapters: readonly SessionCatalogAdapter[]
): SessionCatalogRegistry {
  const adaptersByProvider = new Map<ProviderId, SessionCatalogAdapter>();

  for (const adapter of adapters) {
    if (!hasCompleteSessionSupport(adapter.provider)) {
      throw new Error(
        'Launch-only provider cannot register a session catalog adapter'
      );
    }
    if (adaptersByProvider.has(adapter.provider)) {
      throw new Error(
        `Duplicate session catalog adapter for ${adapter.provider}`
      );
    }
    adaptersByProvider.set(adapter.provider, adapter);
  }

  for (const provider of SESSION_PROVIDER_IDS) {
    if (!adaptersByProvider.has(provider)) {
      throw new Error(`Missing session catalog adapter for ${provider}`);
    }
  }

  const providers = Object.freeze([...SESSION_PROVIDER_IDS]);
  return Object.freeze({
    providers: () => providers,
    get: (provider: ProviderId) => adaptersByProvider.get(provider) ?? null
  });
}
