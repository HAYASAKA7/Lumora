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
import type {
  ReadyProviderInstallation,
  SessionCatalogRegistry
} from '../providers/session-catalog-adapter';
import {
  ProviderSessionRecordSchema,
  type ProviderSessionDiscoveryResult
} from '../providers/session-discovery';
import type { CatalogCandidate } from './catalog-candidate';

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
}

interface CatalogServiceDependencies {
  scanProviders(): Promise<ProviderScanResult>;
  registry: SessionCatalogRegistry;
  canonicalizeWorkspace(path: string): Promise<CanonicalWorkspacePath>;
  repository: CatalogRepositoryPort;
  clock(): Date;
  createScanId(provider: ProviderId): string;
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

  constructor(private readonly dependencies: CatalogServiceDependencies) {
    this.providerStatus = dependencies.registry
      .providers()
      .map((provider) => emptyStatus(provider, 'unavailable'));
    this.refreshedAt = dependencies.clock().toISOString();
  }

  getCatalog(query: CatalogQuery = EMPTY_QUERY): CatalogSnapshot {
    const parsedQuery = CatalogQuerySchema.parse(query);
    return this.dependencies.repository.getSnapshot({
      query: parsedQuery,
      refreshedAt: this.refreshedAt,
      providerStatus: this.providerStatus,
      availableProviders: this.availableProviders,
      diagnostics: this.diagnostics
    });
  }

  async refreshCatalog(
    query: CatalogQuery = EMPTY_QUERY
  ): Promise<CatalogSnapshot> {
    const parsedQuery = CatalogQuerySchema.parse(query);
    const scannedAt = this.dependencies.clock().toISOString();
    const scan = await this.dependencies.scanProviders();
    const installations = new Map<ProviderId, ProviderInstallation>(
      scan.providers.map((installation) => [
        installation.provider,
        installation
      ])
    );
    const providers = this.dependencies.registry.providers();
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

    await Promise.all(
      providers.map(async (provider) => {
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
      })
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
            workspace: await this.dependencies.canonicalizeWorkspace(
              session.data.workspacePath
            ),
            title: session.data.title,
            createdAt: session.data.createdAt,
            updatedAt: session.data.updatedAt,
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
    return this.getCatalog(parsedQuery);
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
