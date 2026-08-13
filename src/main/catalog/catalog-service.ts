import {
  CatalogQuerySchema,
  type CatalogDiagnostic,
  type CatalogProviderStatus,
  type CatalogQuery,
  type CatalogSnapshot,
  type ProviderId,
  type ProviderInstallation,
  type ProviderScanResult
} from '../../shared/contracts';
import { providerDefinition } from '../../shared/provider-definitions';
import type { CanonicalWorkspacePath } from '../platform/workspace-path';
import type { CatalogTransferSession } from '../storage/catalog-repository';
import type {
  ReadyProviderInstallation,
  SessionCatalogRegistry
} from '../providers/session-catalog-adapter';
import {
  ProviderSessionRecordSchema,
  type ProviderSessionDiscoveryResult
} from '../providers/session-discovery';
import type { CatalogCandidate } from './catalog-candidate';
import { mapWithConcurrency } from '../performance/map-with-concurrency';

interface ProviderScanWrite {
  provider: ProviderId;
  scanId: string;
  scannedAt: string;
  candidates: readonly CatalogCandidate[];
  preserveMissingSources?: boolean;
}

interface SnapshotOptions {
  query: CatalogQuery;
  refreshedAt: string;
  providerStatus: readonly CatalogProviderStatus[];
  availableProviders: readonly ProviderId[];
  diagnostics: readonly CatalogDiagnostic[];
}

interface CatalogRepositoryPort {
  applyProviderScan(scan: ProviderScanWrite): void;
  registerWorkspace(
    workspace: CanonicalWorkspacePath,
    origin: 'manual' | 'discovered',
    timestamp: string
  ): void;
  getSnapshot(options: SnapshotOptions): CatalogSnapshot;
  getTransferSession(sessionId: string): CatalogTransferSession | null;
  getTransferSessionProvider(sessionId: string): ProviderId | null;
  hasNativeSession(provider: ProviderId, nativeId: string): boolean;
}

interface CatalogServiceDependencies {
  scanProviders(): Promise<ProviderScanResult>;
  enabledProviders(): readonly ProviderId[];
  registry: SessionCatalogRegistry;
  canonicalizeWorkspace(path: string): Promise<CanonicalWorkspacePath>;
  repository: CatalogRepositoryPort;
  clock(): Date;
  createScanId(provider: ProviderId): string;
  discoveryConcurrency?: number;
}

interface DiscoverySuccess {
  ok: true;
  result: ProviderSessionDiscoveryResult;
}

interface DiscoveryFailure {
  ok: false;
}

type DiscoveryOutcome = DiscoverySuccess | DiscoveryFailure;

const EMPTY_QUERY: CatalogQuery = { text: '', provider: null };

function emptyStatus(
  provider: ProviderId,
  state: CatalogProviderStatus['state']
): CatalogProviderStatus {
  return {
    provider,
    state,
    discoveredCount: 0,
    unchangedCount: 0,
    invalidCount: 0
  };
}

function providerUnavailableDiagnostic(
  installation: ProviderInstallation | undefined,
  provider: ProviderId,
  scannedAt: string
): CatalogDiagnostic {
  const displayName = providerDefinition(provider).displayName;
  return {
    code: 'CATALOG_PROVIDER_UNAVAILABLE',
    provider,
    affectedCount: 0,
    message: `${displayName} is not ready for session discovery.`,
    recovery:
      installation?.issue?.recovery ??
      `Install or repair ${displayName}, then refresh the catalog.`,
    retryable: true,
    scannedAt
  };
}

function discoveryFailureDiagnostic(
  provider: ProviderId,
  scannedAt: string
): CatalogDiagnostic {
  const displayName = providerDefinition(provider).displayName;
  return {
    code:
      provider === 'codex'
        ? 'CATALOG_PROTOCOL_FAILED'
        : 'CATALOG_SOURCE_UNAVAILABLE',
    provider,
    affectedCount: 0,
    message: `${displayName} session discovery could not be completed.`,
    recovery: `Check the ${displayName} installation and storage permissions, then refresh.`,
    retryable: true,
    scannedAt
  };
}

function incompatibleProviderDiagnostic(
  provider: ProviderId,
  recovery: string,
  scannedAt: string
): CatalogDiagnostic {
  const displayName = providerDefinition(provider).displayName;
  return {
    code: 'CATALOG_PROVIDER_INCOMPATIBLE',
    provider,
    affectedCount: 0,
    message: `${displayName} is installed, but its session interface is not compatible.`,
    recovery,
    retryable: true,
    scannedAt
  };
}

function invalidSourceDiagnostic(
  provider: ProviderId,
  affectedCount: number,
  scannedAt: string
): CatalogDiagnostic {
  const displayName = providerDefinition(provider).displayName;
  return {
    code: 'CATALOG_SOURCE_INVALID',
    provider,
    affectedCount,
    message: `${affectedCount} ${displayName} session source${
      affectedCount === 1 ? '' : 's'
    } could not be normalized.`,
    recovery: 'Refresh after the provider finishes writing its session data.',
    retryable: true,
    scannedAt
  };
}

function databaseFailureDiagnostic(
  provider: ProviderId,
  scannedAt: string
): CatalogDiagnostic {
  return {
    code: 'CATALOG_DATABASE_FAILED',
    provider,
    affectedCount: 0,
    message: 'Lumora could not update the local session catalog.',
    recovery: 'Restart Lumora and refresh the catalog.',
    retryable: true,
    scannedAt
  };
}

export class CatalogService {
  private providerStatus: CatalogProviderStatus[];
  private availableProviders: ProviderId[] = [];
  private diagnostics: CatalogDiagnostic[] = [];
  private refreshedAt: string;
  private refreshInFlight: {
    providersKey: string;
    promise: Promise<void>;
  } | null = null;

  constructor(private readonly dependencies: CatalogServiceDependencies) {
    this.providerStatus = this.currentProviders()
      .map((provider) => emptyStatus(provider, 'unavailable'));
    this.refreshedAt = dependencies.clock().toISOString();
  }

  getCatalog(query: CatalogQuery = EMPTY_QUERY): CatalogSnapshot {
    const parsedQuery = CatalogQuerySchema.parse(query);
    const enabled = new Set(this.currentProviders());
    return this.dependencies.repository.getSnapshot({
      query: parsedQuery,
      refreshedAt: this.refreshedAt,
      providerStatus: this.providerStatus.filter(({ provider }) =>
        enabled.has(provider)
      ),
      availableProviders: this.availableProviders.filter((provider) =>
        enabled.has(provider)
      ),
      diagnostics: this.diagnostics.filter(
        ({ provider }) => provider === null || enabled.has(provider)
      )
    });
  }

  getTransferSession(sessionId: string): CatalogTransferSession | null {
    return this.dependencies.repository.getTransferSession(sessionId);
  }

  getTransferSessionProvider(sessionId: string): ProviderId | null {
    return this.dependencies.repository.getTransferSessionProvider(sessionId);
  }

  hasNativeSession(provider: ProviderId, nativeId: string): boolean {
    return this.dependencies.repository.hasNativeSession(provider, nativeId);
  }

  private currentProviders(): ProviderId[] {
    const enabled = new Set(this.dependencies.enabledProviders());
    return this.dependencies.registry
      .providers()
      .filter((provider) => enabled.has(provider));
  }

  async refreshCatalog(
    query: CatalogQuery = EMPTY_QUERY
  ): Promise<CatalogSnapshot> {
    const parsedQuery = CatalogQuerySchema.parse(query);
    let providers = this.currentProviders();

    for (;;) {
      const providersKey = providers.join('\u0000');
      const currentRefresh = this.refreshInFlight;
      if (currentRefresh === null) {
        const entry = {
          providersKey,
          promise: this.refreshProviders(providers)
        };
        this.refreshInFlight = entry;
        void entry.promise
          .finally(() => {
            if (this.refreshInFlight === entry) {
              this.refreshInFlight = null;
            }
          })
          .catch(() => undefined);
        await entry.promise;
        break;
      }

      if (currentRefresh.providersKey === providersKey) {
        await currentRefresh.promise;
        break;
      }

      try {
        await currentRefresh.promise;
      } catch {
        // A policy-changing refresh must still get its own current scan.
      } finally {
        if (this.refreshInFlight === currentRefresh) {
          this.refreshInFlight = null;
        }
      }
      providers = this.currentProviders();
    }
    return this.getCatalog(parsedQuery);
  }

  private async refreshProviders(
    providers: readonly ProviderId[]
  ): Promise<void> {
    const scannedAt = this.dependencies.clock().toISOString();
    const canonicalWorkspaces = new Map<
      string,
      Promise<CanonicalWorkspacePath>
    >();
    const canonicalizeWorkspace = (
      path: string
    ): Promise<CanonicalWorkspacePath> => {
      const current = canonicalWorkspaces.get(path);
      if (current !== undefined) return current;
      const pending = this.dependencies.canonicalizeWorkspace(path);
      canonicalWorkspaces.set(path, pending);
      return pending;
    };
    const scan = await this.dependencies.scanProviders();
    const installations = new Map<ProviderId, ProviderInstallation>(
      scan.providers.map((installation) => [
        installation.provider,
        installation
      ])
    );
    const readyInstallations = new Map<ProviderId, ReadyProviderInstallation>();
    const incompatibleProviders = new Map<ProviderId, string>();
    for (const provider of providers) {
      const installation = installations.get(provider);
      if (installation?.state === 'ready') {
        const adapter = this.dependencies.registry.get(provider);
        try {
          const compatibility = adapter?.validateCompatibility(installation);
          if (compatibility?.compatible === true) {
            readyInstallations.set(provider, installation);
          } else {
            incompatibleProviders.set(
              provider,
              compatibility?.recovery ??
                `Update ${providerDefinition(provider).displayName}, then refresh.`
            );
          }
        } catch {
          incompatibleProviders.set(
            provider,
            `Update ${providerDefinition(provider).displayName}, then refresh.`
          );
        }
      }
    }
    const outcomes = new Map<ProviderId, DiscoveryOutcome>();

    await mapWithConcurrency(
      providers,
      this.dependencies.discoveryConcurrency ?? 3,
      async (provider) => {
        const installation = readyInstallations.get(provider);
        const adapter = this.dependencies.registry.get(provider);
        if (!installation || !adapter) return;
        try {
          outcomes.set(provider, {
            ok: true,
            result: await adapter.discover(installation)
          });
        } catch {
          outcomes.set(provider, { ok: false });
        }
      }
    );

    const nextStatus: CatalogProviderStatus[] = [];
    const nextDiagnostics: CatalogDiagnostic[] = [];
    for (const provider of providers) {
      const installation = installations.get(provider);
      const incompatibility = incompatibleProviders.get(provider);
      if (incompatibility !== undefined) {
        nextStatus.push(emptyStatus(provider, 'unavailable'));
        nextDiagnostics.push(
          incompatibleProviderDiagnostic(provider, incompatibility, scannedAt)
        );
        continue;
      }
      if (!readyInstallations.has(provider)) {
        nextStatus.push(emptyStatus(provider, 'unavailable'));
        nextDiagnostics.push(
          providerUnavailableDiagnostic(installation, provider, scannedAt)
        );
        continue;
      }

      const outcome = outcomes.get(provider);
      if (!outcome?.ok || outcome.result.provider !== provider) {
        nextStatus.push(emptyStatus(provider, 'failed'));
        nextDiagnostics.push(discoveryFailureDiagnostic(provider, scannedAt));
        continue;
      }

      const candidates: CatalogCandidate[] = [];
      let invalidCount = Math.max(0, Math.trunc(outcome.result.invalidCount));
      for (const rawSession of outcome.result.sessions) {
        const session = ProviderSessionRecordSchema.safeParse(rawSession);
        if (!session.success || session.data.provider !== provider) {
          invalidCount += 1;
          continue;
        }
        try {
          candidates.push({
            provider,
            nativeId: session.data.nativeId,
            workspace: await canonicalizeWorkspace(
              session.data.workspacePath
            ),
            title: session.data.title,
            createdAt: session.data.createdAt,
            updatedAt: session.data.updatedAt,
            lifetimeTokens: session.data.lifetimeTokens ?? null,
            source: session.data.source
          });
        } catch {
          invalidCount += 1;
        }
      }

      try {
        this.dependencies.repository.applyProviderScan({
          provider,
          scanId: this.dependencies.createScanId(provider),
          scannedAt,
          candidates,
          preserveMissingSources: invalidCount > 0
        });
        nextStatus.push({
          provider,
          state: 'ready',
          discoveredCount: candidates.length,
          unchangedCount: Math.max(0, Math.trunc(outcome.result.unchangedCount)),
          invalidCount
        });
        if (invalidCount > 0) {
          nextDiagnostics.push(
            invalidSourceDiagnostic(provider, invalidCount, scannedAt)
          );
        }
      } catch {
        nextStatus.push(emptyStatus(provider, 'failed'));
        nextDiagnostics.push(databaseFailureDiagnostic(provider, scannedAt));
      }
    }

    this.providerStatus = nextStatus;
    this.availableProviders = providers.filter((provider) =>
      readyInstallations.has(provider)
    );
    this.diagnostics = nextDiagnostics;
    this.refreshedAt = scannedAt;
  }

  async registerWorkspace(
    path: string,
    query: CatalogQuery = EMPTY_QUERY
  ): Promise<CatalogSnapshot> {
    const parsedQuery = CatalogQuerySchema.parse(query);
    const timestamp = this.dependencies.clock().toISOString();
    const workspace = await this.dependencies.canonicalizeWorkspace(path);
    this.dependencies.repository.registerWorkspace(workspace, 'manual', timestamp);
    this.refreshedAt = timestamp;
    return this.getCatalog(parsedQuery);
  }
}
