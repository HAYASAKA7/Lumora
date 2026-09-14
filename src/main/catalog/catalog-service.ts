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
  /** Installations for a refresh; one provider's refresh names it. */
  scanProviders(options?: { providers?: readonly ProviderId[] }): Promise<ProviderScanResult>;
  enabledProviders(): readonly ProviderId[];
  registry: SessionCatalogRegistry;
  canonicalizeWorkspace(path: string): Promise<CanonicalWorkspacePath>;
  repository: CatalogRepositoryPort;
  clock(): Date;
  createScanId(provider: ProviderId): string;
  discoveryConcurrency?: number;
  monotonicClock?: () => number;
  onRefreshSettled?: (measurement: {
    outcome: 'succeeded' | 'failed';
    durationMs: number;
    cacheHits: number;
    counts: { discovered: number; unchanged: number; invalid: number };
    /** Present when only this provider's sessions were refreshed. */
    provider?: ProviderId;
  }) => void;
}

interface CatalogRefreshCounts {
  discovered: number;
  unchanged: number;
  invalid: number;
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

interface CatalogRefresh {
  providersKey: string;
  providers: readonly ProviderId[];
  /** Set when only this provider's sessions are being refreshed. */
  onlyProvider: ProviderId | null;
  promise: Promise<CatalogRefreshCounts>;
  cacheHits: number;
}

export class CatalogService {
  private providerStatus: CatalogProviderStatus[];
  private availableProviders: ProviderId[] = [];
  private diagnostics: CatalogDiagnostic[] = [];
  private refreshedAt: string;
  /** A refresh of every enabled provider; it never overlaps any other refresh. */
  private refreshInFlight: CatalogRefresh | null = null;
  /** Refreshes of one provider each; different providers may run together. */
  private readonly providerRefreshes = new Map<ProviderId, CatalogRefresh>();

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
      if (currentRefresh?.providersKey === providersKey) {
        currentRefresh.cacheHits += 1;
        await currentRefresh.promise;
        break;
      }

      const running = this.runningRefreshes();
      if (running.length === 0) {
        await this.startRefresh(providers, providersKey, null).promise;
        break;
      }

      // A policy-changing refresh must still get its own current scan, and a
      // scan of one provider must not land after this one's older answer.
      await Promise.allSettled(running.map(({ promise }) => promise));
      providers = this.currentProviders();
    }
    return this.getCatalog(parsedQuery);
  }

  /**
   * Refreshes one provider's sessions, as a launch needs to tell a new session
   * from those already there. Other providers keep what the last refresh found,
   * a full refresh already under way answers for this provider too, and other
   * providers' refreshes run alongside it.
   */
  async refreshProviderSessions(provider: ProviderId): Promise<void> {
    for (;;) {
      if (!this.currentProviders().includes(provider)) return;
      const fullRefresh = this.refreshInFlight;
      if (fullRefresh !== null) {
        if (fullRefresh.providers.includes(provider)) {
          fullRefresh.cacheHits += 1;
          await fullRefresh.promise;
          return;
        }
        // The enabled providers changed; wait for that refresh, then ask again.
        await Promise.allSettled([fullRefresh.promise]);
        continue;
      }
      const sameProvider = this.providerRefreshes.get(provider);
      if (sameProvider !== undefined) {
        sameProvider.cacheHits += 1;
        await sameProvider.promise;
        return;
      }
      await this.startRefresh([provider], `only:${provider}`, provider).promise;
      return;
    }
  }

  private runningRefreshes(): CatalogRefresh[] {
    return [
      ...(this.refreshInFlight === null ? [] : [this.refreshInFlight]),
      ...this.providerRefreshes.values()
    ];
  }

  private startRefresh(
    providers: readonly ProviderId[],
    providersKey: string,
    onlyProvider: ProviderId | null
  ): CatalogRefresh {
    const monotonicClock = this.dependencies.monotonicClock ?? (() => performance.now());
    const startedAt = monotonicClock();
    let entry!: CatalogRefresh;
    const promise = (async () => {
      let outcome: 'succeeded' | 'failed' = 'succeeded';
      let counts: CatalogRefreshCounts = {
        discovered: 0,
        unchanged: 0,
        invalid: 0
      };
      try {
        counts = await this.refreshProviders(providers, onlyProvider);
        return counts;
      } catch (error) {
        outcome = 'failed';
        throw error;
      } finally {
        // Cleared before any waiter resumes, so it finds the slot free.
        if (onlyProvider === null) {
          if (this.refreshInFlight === entry) this.refreshInFlight = null;
        } else if (this.providerRefreshes.get(onlyProvider) === entry) {
          this.providerRefreshes.delete(onlyProvider);
        }
        try {
          this.dependencies.onRefreshSettled?.({
            outcome,
            durationMs: Math.max(
              0,
              Math.min(86_400_000, Math.round(monotonicClock() - startedAt))
            ),
            cacheHits: entry.cacheHits,
            counts,
            ...(onlyProvider === null ? {} : { provider: onlyProvider })
          });
        } catch {
          // Measurement consumers cannot change catalog behavior.
        }
      }
    })();
    entry = {
      providersKey,
      providers,
      onlyProvider,
      promise,
      cacheHits: 0
    };
    if (onlyProvider === null) {
      this.refreshInFlight = entry;
    } else {
      this.providerRefreshes.set(onlyProvider, entry);
    }
    void entry.promise.catch(() => undefined);
    return entry;
  }

  private async refreshProviders(
    providers: readonly ProviderId[],
    onlyProvider: ProviderId | null
  ): Promise<CatalogRefreshCounts> {
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
    const scan = onlyProvider === null
      ? await this.dependencies.scanProviders()
      : await this.dependencies.scanProviders({ providers: [onlyProvider] });
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

    if (onlyProvider === null) {
      this.providerStatus = nextStatus;
      this.availableProviders = providers.filter((provider) =>
        readyInstallations.has(provider)
      );
      this.diagnostics = nextDiagnostics;
      this.refreshedAt = scannedAt;
    } else {
      // Only this provider was asked; the rest of the catalog stands.
      const order = this.currentProviders();
      const byOrder = (left: ProviderId, right: ProviderId) => order.indexOf(left) - order.indexOf(right);
      this.providerStatus = [
        ...this.providerStatus.filter(({ provider }) => provider !== onlyProvider),
        ...nextStatus
      ].sort((left, right) => byOrder(left.provider, right.provider));
      this.availableProviders = [
        ...this.availableProviders.filter((provider) => provider !== onlyProvider),
        ...(readyInstallations.has(onlyProvider) ? [onlyProvider] : [])
      ].sort(byOrder);
      this.diagnostics = [
        ...this.diagnostics.filter(({ provider }) => provider !== onlyProvider),
        ...nextDiagnostics
      ];
    }
    return nextStatus.reduce<CatalogRefreshCounts>(
      (counts, status) => ({
        discovered: counts.discovered + status.discoveredCount,
        unchanged: counts.unchanged + status.unchangedCount,
        invalid: counts.invalid + status.invalidCount
      }),
      { discovered: 0, unchanged: 0, invalid: 0 }
    );
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
