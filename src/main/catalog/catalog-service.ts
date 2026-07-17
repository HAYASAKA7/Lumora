import {
  CatalogQuerySchema,
  type CatalogDiagnostic,
  type CatalogProviderId,
  type CatalogProviderStatus,
  type CatalogQuery,
  type CatalogSnapshot,
  type ProviderInstallation,
  type ProviderScanResult
} from '../../shared/contracts';
import type { CanonicalWorkspacePath } from '../platform/workspace-path';
import {
  ProviderSessionRecordSchema,
  type ProviderSessionDiscoveryResult
} from '../providers/session-discovery';
import type { CatalogCandidate } from './catalog-candidate';

type ReadyProviderInstallation = Extract<
  ProviderInstallation,
  { state: 'ready' }
>;

interface ProviderScanWrite {
  provider: CatalogProviderId;
  scanId: string;
  scannedAt: string;
  candidates: readonly CatalogCandidate[];
}

interface SnapshotOptions {
  query: CatalogQuery;
  refreshedAt: string;
  providerStatus: readonly [CatalogProviderStatus, CatalogProviderStatus];
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

type ProviderDiscoverer = (
  installation: ReadyProviderInstallation
) => Promise<ProviderSessionDiscoveryResult>;

interface CatalogServiceDependencies {
  scanProviders(): Promise<ProviderScanResult>;
  discoverCodex: ProviderDiscoverer;
  discoverClaude: ProviderDiscoverer;
  canonicalizeWorkspace(path: string): Promise<CanonicalWorkspacePath>;
  repository: CatalogRepositoryPort;
  clock(): Date;
  createScanId(): string;
}

interface DiscoverySuccess {
  ok: true;
  result: ProviderSessionDiscoveryResult;
}

interface DiscoveryFailure {
  ok: false;
}

type DiscoveryOutcome = DiscoverySuccess | DiscoveryFailure;

const PROVIDER_ORDER = ['codex', 'claude'] as const;
const EMPTY_QUERY: CatalogQuery = { text: '', provider: null };

function emptyStatus(
  provider: CatalogProviderId,
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
  provider: CatalogProviderId,
  scannedAt: string
): CatalogDiagnostic {
  const displayName = provider === 'codex' ? 'Codex' : 'Claude Code';
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
  provider: CatalogProviderId,
  scannedAt: string
): CatalogDiagnostic {
  return provider === 'codex'
    ? {
        code: 'CATALOG_PROTOCOL_FAILED',
        provider,
        affectedCount: 0,
        message: 'Codex session discovery could not be completed.',
        recovery: 'Check the Codex installation, then refresh the catalog.',
        retryable: true,
        scannedAt
      }
    : {
        code: 'CATALOG_SOURCE_UNAVAILABLE',
        provider,
        affectedCount: 0,
        message: 'Claude Code session storage could not be read.',
        recovery: 'Check Claude Code storage permissions, then refresh.',
        retryable: true,
        scannedAt
      };
}

function invalidSourceDiagnostic(
  provider: CatalogProviderId,
  affectedCount: number,
  scannedAt: string
): CatalogDiagnostic {
  const displayName = provider === 'codex' ? 'Codex' : 'Claude Code';
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
  provider: CatalogProviderId,
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
  private providerStatus: [CatalogProviderStatus, CatalogProviderStatus];
  private diagnostics: CatalogDiagnostic[] = [];
  private refreshedAt: string;

  constructor(private readonly dependencies: CatalogServiceDependencies) {
    this.providerStatus = [
      emptyStatus('codex', 'unavailable'),
      emptyStatus('claude', 'unavailable')
    ];
    this.refreshedAt = dependencies.clock().toISOString();
  }

  getCatalog(query: CatalogQuery = EMPTY_QUERY): CatalogSnapshot {
    const parsedQuery = CatalogQuerySchema.parse(query);
    return this.dependencies.repository.getSnapshot({
      query: parsedQuery,
      refreshedAt: this.refreshedAt,
      providerStatus: this.providerStatus,
      diagnostics: this.diagnostics
    });
  }

  async refreshCatalog(query: CatalogQuery = EMPTY_QUERY): Promise<CatalogSnapshot> {
    const parsedQuery = CatalogQuerySchema.parse(query);
    const scannedAt = this.dependencies.clock().toISOString();
    const scan = await this.dependencies.scanProviders();
    const installations = new Map(
      scan.providers.map((installation) => [installation.provider, installation])
    );
    const outcomes = new Map<CatalogProviderId, DiscoveryOutcome>();

    await Promise.all(
      PROVIDER_ORDER.map(async (provider) => {
        const installation = installations.get(provider);
        if (installation?.state !== 'ready') {
          return;
        }
        const discover =
          provider === 'codex'
            ? this.dependencies.discoverCodex
            : this.dependencies.discoverClaude;
        try {
          outcomes.set(provider, {
            ok: true,
            result: await discover(installation)
          });
        } catch {
          outcomes.set(provider, { ok: false });
        }
      })
    );

    const nextStatus: CatalogProviderStatus[] = [];
    const nextDiagnostics: CatalogDiagnostic[] = [];
    for (const provider of PROVIDER_ORDER) {
      const installation = installations.get(provider);
      if (installation?.state !== 'ready') {
        nextStatus.push(emptyStatus(provider, 'unavailable'));
        nextDiagnostics.push(
          providerUnavailableDiagnostic(installation, provider, scannedAt)
        );
        continue;
      }

      const outcome = outcomes.get(provider);
      if (outcome === undefined || !outcome.ok || outcome.result.provider !== provider) {
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
          const workspace = await this.dependencies.canonicalizeWorkspace(
            session.data.workspacePath
          );
          candidates.push({
            provider,
            nativeId: session.data.nativeId,
            workspace,
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
          scanId: this.dependencies.createScanId(),
          scannedAt,
          candidates
        });
        nextStatus.push({
          provider,
          state: 'ready',
          discoveredCount: candidates.length,
          unchangedCount: Math.max(
            0,
            Math.trunc(outcome.result.unchangedCount)
          ),
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

    this.providerStatus = [
      nextStatus[0] ?? emptyStatus('codex', 'failed'),
      nextStatus[1] ?? emptyStatus('claude', 'failed')
    ];
    this.diagnostics = nextDiagnostics;
    this.refreshedAt = scannedAt;
    return this.dependencies.repository.getSnapshot({
      query: parsedQuery,
      refreshedAt: scannedAt,
      providerStatus: this.providerStatus,
      diagnostics: this.diagnostics
    });
  }

  async registerWorkspace(
    path: string,
    query: CatalogQuery = EMPTY_QUERY
  ): Promise<CatalogSnapshot> {
    const parsedQuery = CatalogQuerySchema.parse(query);
    const timestamp = this.dependencies.clock().toISOString();
    const workspace = await this.dependencies.canonicalizeWorkspace(path);
    this.dependencies.repository.registerWorkspace(
      workspace,
      'manual',
      timestamp
    );
    this.refreshedAt = timestamp;
    return this.getCatalog(parsedQuery);
  }
}
