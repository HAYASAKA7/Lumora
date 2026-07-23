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
import { providerDefinition } from '../../shared/provider-definitions';
import { PROVIDER_IDS } from '../../shared/contracts';
import {
  compareSemanticVersions,
  extractSemanticVersion
} from './provider-version';

type ProviderIdentity = Pick<
  ProviderInstallation,
  'provider' | 'displayName'
>;

interface ProviderRegistryLike {
  scan(): Promise<ProviderScanResult>;
  scanFresh?(): Promise<ProviderScanResult>;
}

export interface ProviderUpdateService {
  check(): Promise<ProviderUpdateCheckResult>;
  install(provider: ProviderId): Promise<ProviderUpdateResult>;
  update(provider: ProviderId): Promise<ProviderUpdateResult>;
}

export class ProviderUpdateServiceError extends Error {
  constructor(
    readonly code:
      | 'PROVIDER_NOT_READY'
      | 'PROVIDER_ALREADY_INSTALLED'
      | 'PROVIDER_UPDATE_GUIDE_REQUIRED'
      | 'PROVIDER_UPDATE_IN_PROGRESS',
    message: string
  ) {
    super(message);
    this.name = 'ProviderUpdateServiceError';
  }
}

function unavailable(
  identity: ProviderIdentity,
  values: Pick<ProviderUpdateStatus, 'installedVersion' | 'latestVersion'>,
  issue: Extract<ProviderUpdateStatus, { state: 'unavailable' }>['issue']
): ProviderUpdateStatus {
  return { ...identity, state: 'unavailable', ...values, issue };
}

async function checkProvider(
  identity: ProviderIdentity,
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

  if (providerDefinition(identity.provider).npmPackage === null) {
    return unavailable(
      identity,
      { installedVersion: installed.raw, latestVersion: null },
      {
        code: 'PROVIDER_RELEASE_UNAVAILABLE',
        message: `${identity.displayName}'s latest version is managed by its official installer.`,
        recovery: `Use the official ${identity.displayName} installation guide to check for updates.`,
        retryable: false
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
  enabledProviders = () => PROVIDER_IDS,
  releases,
  runLifecycle,
  now = () => new Date()
}: {
  registry: ProviderRegistryLike;
  enabledProviders?: () => readonly ProviderId[];
  releases: ProviderReleaseSource;
  runLifecycle(provider: ProviderId): Promise<void>;
  now?: () => Date;
}): ProviderUpdateService {
  const running = new Set<ProviderId>();

  const assertEnabled = (provider: ProviderId): void => {
    if (enabledProviders().includes(provider)) return;
    throw new ProviderUpdateServiceError(
      'PROVIDER_NOT_READY',
      `${providerDefinition(provider).displayName} is disabled in Lumora settings.`
    );
  };

  const withLock = async (
    provider: ProviderId,
    action: () => Promise<ProviderUpdateResult>
  ): Promise<ProviderUpdateResult> => {
    if (running.has(provider)) {
      throw new ProviderUpdateServiceError(
        'PROVIDER_UPDATE_IN_PROGRESS',
        'This provider already has a lifecycle operation in progress.'
      );
    }
    running.add(provider);
    try {
      return await action();
    } finally {
      running.delete(provider);
    }
  };

  const resultAfterLifecycle = async (
    provider: ProviderId
  ): Promise<ProviderUpdateResult> => {
    await runLifecycle(provider);
    const after = await (registry.scanFresh?.() ?? registry.scan());
    const installation = after.providers.find(
      (candidate) => candidate.provider === provider
    );
    if (installation === undefined || installation.state !== 'ready') {
      throw new ProviderUpdateServiceError(
        'PROVIDER_NOT_READY',
        'The provider could not be detected after the lifecycle operation.'
      );
    }
    return ProviderUpdateResultSchema.parse({
      provider,
      completedAt: now().toISOString(),
      installation
    });
  };

  return Object.freeze({
    async check(): Promise<ProviderUpdateCheckResult> {
      const scan = await registry.scan();
      const enabled = new Set(enabledProviders());
      const providers = await Promise.all(
        scan.providers
          .filter((installation) => enabled.has(installation.provider))
          .map((installation) =>
          checkProvider(
            {
              provider: installation.provider,
              displayName: installation.displayName
            },
            installation,
            releases
          )
        )
      );
      return ProviderUpdateCheckResultSchema.parse({
        checkedAt: now().toISOString(),
        providers
      });
    },

    async install(provider: ProviderId): Promise<ProviderUpdateResult> {
      assertEnabled(provider);
      return withLock(provider, async () => {
        const before = await registry.scan();
        const installation = before.providers.find(
          (candidate) => candidate.provider === provider
        );
        if (installation === undefined) {
          throw new ProviderUpdateServiceError(
            'PROVIDER_NOT_READY',
            'The provider is not registered.'
          );
        }
        if (installation.state === 'ready') {
          throw new ProviderUpdateServiceError(
            'PROVIDER_ALREADY_INSTALLED',
            'The provider is already installed.'
          );
        }
        return resultAfterLifecycle(provider);
      });
    },

    async update(provider: ProviderId): Promise<ProviderUpdateResult> {
      assertEnabled(provider);
      return withLock(provider, async () => {
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
        if (providerDefinition(provider).npmPackage === null) {
          throw new ProviderUpdateServiceError(
            'PROVIDER_UPDATE_GUIDE_REQUIRED',
            `Use ${installation.displayName}'s official installation guide to update it.`
          );
        }

        return resultAfterLifecycle(provider);
      });
    }
  });
}
