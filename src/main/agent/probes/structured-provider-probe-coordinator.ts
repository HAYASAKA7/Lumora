import type {
  ProviderInstallation
} from '../../../shared/contracts';
import {
  STRUCTURED_AGENT_PROVIDER_IDS,
  type StructuredAgentProviderId
} from '../../../shared/agent/contracts';
import type {
  StructuredIntegration,
  StructuredProviderCapabilityReport
} from '../../../shared/agent/provider-capabilities';
import { providerDefinition } from '../../../shared/provider-definitions';
import {
  failedReport,
  timedOutReport,
  unavailableReport,
  type ProbeClock
} from './probe-report';

export type ReadyStructuredProviderInstallation = Extract<
  ProviderInstallation,
  { state: 'ready' }
> & { provider: StructuredAgentProviderId };

type ProbeReadyProvider = (
  installation: ReadyStructuredProviderInstallation
) => Promise<StructuredProviderCapabilityReport>;

interface StructuredProviderProbeCoordinatorOptions {
  probeReady: ProbeReadyProvider;
  now?: ProbeClock;
  monotonicClock?: () => number;
  timeoutMs?: number;
  /** How long a report that is not verified stands before the provider is asked again. */
  retryAfterMs?: number;
}

interface CachedReport {
  report: StructuredProviderCapabilityReport;
  /** Infinity for a verified report: it holds while the installation is unchanged. */
  expiresAt: number;
}

/**
 * A failed or timed-out probe is often a busy machine rather than a broken
 * install, and asking again costs an agent start, so it waits a little.
 */
const DEFAULT_RETRY_AFTER_MS = 30_000;

class ProbeTimedOutError extends Error {}

function integrationFor(providerId: StructuredAgentProviderId): StructuredIntegration {
  const integration = providerDefinition(providerId).structuredIntegration;
  if (integration === null) {
    throw new Error(`Structured provider ${providerId} has no integration.`);
  }
  return integration;
}

function isStructuredProvider(
  provider: ProviderInstallation['provider']
): provider is StructuredAgentProviderId {
  return STRUCTURED_AGENT_PROVIDER_IDS.some((candidate) => candidate === provider);
}

export class StructuredProviderProbeCoordinator {
  private readonly active = new Map<
    string,
    Promise<StructuredProviderCapabilityReport>
  >();
  private readonly cache = new Map<string, CachedReport>();

  constructor(
    private readonly options: StructuredProviderProbeCoordinatorOptions
  ) {}

  scan(
    installations: readonly ProviderInstallation[]
  ): Promise<readonly StructuredProviderCapabilityReport[]> {
    return this.scanInternal(installations, false);
  }

  scanFresh(
    installations: readonly ProviderInstallation[]
  ): Promise<readonly StructuredProviderCapabilityReport[]> {
    return this.scanInternal(installations, true);
  }

  /** Forgets what a provider reported, as when a launch found it broken. */
  invalidate(providerId: StructuredAgentProviderId): void {
    for (const key of [...this.cache.keys()]) {
      if (key.split('\u0000')[0] === providerId) this.cache.delete(key);
    }
  }

  private scanInternal(
    installations: readonly ProviderInstallation[],
    fresh: boolean
  ): Promise<readonly StructuredProviderCapabilityReport[]> {
    const selected = new Map<StructuredAgentProviderId, ProviderInstallation>();
    for (const installation of installations) {
      if (isStructuredProvider(installation.provider)) {
        selected.set(installation.provider, installation);
      }
    }
    return Promise.all(
      STRUCTURED_AGENT_PROVIDER_IDS.map((providerId) => {
        const installation = selected.get(providerId);
        if (installation === undefined || installation.state !== 'ready') {
          return Promise.resolve(unavailableReport({
            providerId,
            integration: integrationFor(providerId),
            version: installation?.version ?? null,
            ...(this.options.now === undefined ? {} : { now: this.options.now })
          }));
        }
        return this.probe(installation as ReadyStructuredProviderInstallation, fresh);
      })
    );
  }

  private probe(
    installation: ReadyStructuredProviderInstallation,
    fresh: boolean
  ): Promise<StructuredProviderCapabilityReport> {
    const key = [
      installation.provider,
      installation.executablePath,
      installation.version
    ].join('\u0000');
    const monotonicClock = this.options.monotonicClock ?? (() => performance.now());
    if (!fresh) {
      const cached = this.cache.get(key);
      if (cached !== undefined && cached.expiresAt >= monotonicClock()) {
        return Promise.resolve(cached.report);
      }
    }
    const current = this.active.get(key);
    if (current !== undefined) return current;

    const identity = {
      providerId: installation.provider,
      integration: integrationFor(installation.provider),
      version: installation.version,
      ...(this.options.now === undefined ? {} : { now: this.options.now })
    };
    let entry!: Promise<StructuredProviderCapabilityReport>;
    entry = this.withTimeout(this.options.probeReady(installation))
      .catch((error: unknown) => error instanceof ProbeTimedOutError
        ? timedOutReport(identity)
        : failedReport(identity))
      .then((report) => {
        // The cache is keyed by executable path and version, so an update or a
        // different executable is a new key; a verified answer has no reason to
        // expire before then.
        this.cache.set(key, {
          report,
          expiresAt: report.state === 'verified'
            ? Number.POSITIVE_INFINITY
            : monotonicClock() + (this.options.retryAfterMs ?? DEFAULT_RETRY_AFTER_MS)
        });
        return report;
      })
      .finally(() => {
        if (this.active.get(key) === entry) this.active.delete(key);
      });
    this.active.set(key, entry);
    return entry;
  }

  private withTimeout(
    operation: Promise<StructuredProviderCapabilityReport>
  ): Promise<StructuredProviderCapabilityReport> {
    const timeoutMs = this.options.timeoutMs ?? 35_000;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new ProbeTimedOutError()), timeoutMs);
      operation.then(
        (report) => {
          clearTimeout(timer);
          resolve(report);
        },
        (error: unknown) => {
          clearTimeout(timer);
          reject(error);
        }
      );
    });
  }
}
