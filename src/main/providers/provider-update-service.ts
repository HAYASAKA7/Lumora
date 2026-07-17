import {
  ProviderUpdateCheckResultSchema,
  ProviderUpdateResultSchema,
  type ProviderId,
  type ProviderInstallation,
  type ProviderScanResult,
  type ProviderUpdateCheckResult,
  type ProviderUpdateResult,
  type ProviderUpdateStatus
} from '../../shared/contracts';
import type { ProviderReleaseSource } from './provider-release-source';
import {
  compareSemanticVersions,
  extractSemanticVersion
} from './provider-version';

const PROVIDERS = [
  { provider: 'codex', displayName: 'Codex' },
  { provider: 'claude', displayName: 'Claude Code' }
] as const;

interface ProviderRegistryLike {
  scan(): Promise<ProviderScanResult>;
}

export interface ProviderUpdateService {
  check(): Promise<ProviderUpdateCheckResult>;
  update(provider: ProviderId): Promise<ProviderUpdateResult>;
}

export class ProviderUpdateServiceError extends Error {
  constructor(
    readonly code: 'PROVIDER_NOT_READY' | 'PROVIDER_UPDATE_IN_PROGRESS',
    message: string
  ) {
    super(message);
    this.name = 'ProviderUpdateServiceError';
  }
}

function unavailable(
  identity: (typeof PROVIDERS)[number],
  values: Pick<ProviderUpdateStatus, 'installedVersion' | 'latestVersion'>,
  issue: Extract<ProviderUpdateStatus, { state: 'unavailable' }>['issue']
): ProviderUpdateStatus {
  return { ...identity, state: 'unavailable', ...values, issue };
}

async function checkProvider(
  identity: (typeof PROVIDERS)[number],
  installation: ProviderInstallation | undefined,
  releases: ProviderReleaseSource
): Promise<ProviderUpdateStatus> {
  if (installation === undefined || installation.state !== 'ready') {
    return unavailable(
      identity,
      { installedVersion: null, latestVersion: null },
      {
        code: 'PROVIDER_NOT_READY',
        message: `${identity.displayName} is not ready for update checks.`,
        recovery: `Install or repair ${identity.displayName}, then refresh.`,
        retryable: true
      }
    );
  }

  const installed = extractSemanticVersion(installation.version);
  if (installed === null) {
    return unavailable(
      identity,
      { installedVersion: installation.version, latestVersion: null },
      {
        code: 'PROVIDER_VERSION_INVALID',
        message: `${identity.displayName}'s installed version could not be compared.`,
        recovery: `Run ${identity.provider} --version, then refresh.`,
        retryable: true
      }
    );
  }

  let latestOutput: string;
  try {
    latestOutput = await releases.latestVersion(identity.provider);
  } catch {
    return unavailable(
      identity,
      { installedVersion: installed.raw, latestVersion: null },
      {
        code: 'PROVIDER_RELEASE_UNAVAILABLE',
        message: `${identity.displayName}'s latest version could not be checked.`,
        recovery: 'Check the network connection, then refresh.',
        retryable: true
      }
    );
  }

  const latest = extractSemanticVersion(latestOutput);
  if (latest === null) {
    return unavailable(
      identity,
      { installedVersion: installed.raw, latestVersion: latestOutput },
      {
        code: 'PROVIDER_VERSION_INVALID',
        message: `${identity.displayName}'s latest version could not be compared.`,
        recovery: 'Refresh later after the provider release metadata is corrected.',
        retryable: true
      }
    );
  }

  return {
    ...identity,
    state:
      compareSemanticVersions(installed, latest) < 0
        ? 'update_available'
        : 'up_to_date',
    installedVersion: installed.raw,
    latestVersion: latest.raw,
    issue: null
  };
}

export function createProviderUpdateService({
  registry,
  releases,
  runUpdate,
  now = () => new Date()
}: {
  registry: ProviderRegistryLike;
  releases: ProviderReleaseSource;
  runUpdate(executablePath: string): Promise<void>;
  now?: () => Date;
}): ProviderUpdateService {
  const updating = new Set<ProviderId>();

  return Object.freeze({
    async check(): Promise<ProviderUpdateCheckResult> {
      const scan = await registry.scan();
      const providers = await Promise.all(
        PROVIDERS.map((identity) =>
          checkProvider(
            identity,
            scan.providers.find(
              (installation) => installation.provider === identity.provider
            ),
            releases
          )
        )
      );
      return ProviderUpdateCheckResultSchema.parse({
        checkedAt: now().toISOString(),
        providers
      });
    },

    async update(provider: ProviderId): Promise<ProviderUpdateResult> {
      if (updating.has(provider)) {
        throw new ProviderUpdateServiceError(
          'PROVIDER_UPDATE_IN_PROGRESS',
          'This provider is already being updated.'
        );
      }
      updating.add(provider);

      try {
        const before = await registry.scan();
        const installation = before.providers.find(
          (candidate) => candidate.provider === provider
        );
        if (installation === undefined || installation.state !== 'ready') {
          throw new ProviderUpdateServiceError(
            'PROVIDER_NOT_READY',
            'The provider is not ready to update.'
          );
        }

        await runUpdate(installation.executablePath);

        const after = await registry.scan();
        const updated = after.providers.find(
          (candidate) => candidate.provider === provider
        );
        if (updated === undefined) {
          throw new ProviderUpdateServiceError(
            'PROVIDER_NOT_READY',
            'The updated provider could not be found.'
          );
        }

        return ProviderUpdateResultSchema.parse({
          provider,
          completedAt: now().toISOString(),
          installation: updated
        });
      } finally {
        updating.delete(provider);
      }
    }
  });
}
