import type {
  ProviderId,
  ProviderInstallation
} from '../../shared/contracts';
import {
  PROVIDER_DEFINITIONS,
  type ProviderDefinition
} from '../../shared/provider-definitions';

export interface ProviderAdapter {
  readonly provider: ProviderId;
  readonly displayName: string;
  scan(): Promise<ProviderInstallation>;
}

export interface ProviderVersionCheckReport {
  provider: ProviderId;
  /** `recovered` when the retry succeeded, `failed` when it did not. */
  outcome: 'recovered' | 'failed';
  /** Why the first attempt failed: it ran out of time, or the command failed. */
  reason: 'timeout' | 'failed';
}

export interface ProviderScanDependencies {
  findExecutable(command: string): Promise<string | null>;
  probeVersion(
    executablePath: string,
    args: readonly string[]
  ): Promise<string>;
  /** Told about a version check that failed, so the provider can be named later. */
  reportVersionCheck?(report: ProviderVersionCheckReport): void;
}

function failureReason(error: unknown): 'timeout' | 'failed' {
  return typeof error === 'object' && error !== null &&
    (error as { reason?: unknown }).reason === 'timeout'
    ? 'timeout'
    : 'failed';
}

type ProviderIdentity = Pick<ProviderAdapter, 'provider' | 'displayName'>;

export function createUnexpectedScanFailure({
  provider,
  displayName
}: ProviderIdentity): ProviderInstallation {
  return {
    provider,
    displayName,
    state: 'probe_failed',
    executablePath: null,
    version: null,
    issue: {
      code: 'PROVIDER_SCAN_FAILED',
      message: `Lumora could not scan ${displayName}.`,
      recovery:
        'Refresh the provider scan. If the problem continues, check the application logs.',
      retryable: true
    }
  };
}

export function createProviderAdapter(
  definition: ProviderDefinition,
  dependencies: ProviderScanDependencies
): ProviderAdapter {
  const { provider, displayName, command, versionArgs } = definition;

  return Object.freeze({
    provider,
    displayName,
    async scan(): Promise<ProviderInstallation> {
      let executablePath: string | null;
      try {
        executablePath = await dependencies.findExecutable(command);
      } catch {
        return createUnexpectedScanFailure({ provider, displayName });
      }

      if (executablePath === null) {
        return {
          provider,
          displayName,
          state: 'not_found',
          executablePath: null,
          version: null,
          issue: {
            code: 'PROVIDER_NOT_FOUND',
            message: `${displayName} was not found on PATH.`,
            recovery: `Install ${displayName} or add it to PATH, then refresh.`,
            retryable: true
          }
        };
      }

      const report = (outcome: ProviderVersionCheckReport['outcome'], error: unknown) => {
        try {
          dependencies.reportVersionCheck?.({ provider, outcome, reason: failureReason(error) });
        } catch {
          // Reporting cannot change what the scan found.
        }
      };
      try {
        let version: string;
        try {
          version = await dependencies.probeVersion(executablePath, versionArgs);
        } catch (firstError) {
          // A cold CLI start on a busy machine can miss its budget once; a
          // second try tells that apart from a broken install.
          try {
            version = await dependencies.probeVersion(executablePath, versionArgs);
          } catch {
            report('failed', firstError);
            throw firstError;
          }
          report('recovered', firstError);
        }
        return {
          provider,
          displayName,
          state: 'ready',
          executablePath,
          version,
          issue: null
        };
      } catch {
        return {
          provider,
          displayName,
          state: 'probe_failed',
          executablePath,
          version: null,
          issue: {
            code: 'PROVIDER_VERSION_PROBE_FAILED',
            message: `Lumora found ${displayName} but could not read its version.`,
            recovery: `Run ${command} ${versionArgs.join(' ')} in a terminal, then refresh.`,
            retryable: true
          }
        };
      }
    }
  });
}

export function createProviderAdapters(
  dependencies: ProviderScanDependencies
): readonly ProviderAdapter[] {
  return Object.freeze(
    PROVIDER_DEFINITIONS.map((definition) =>
      createProviderAdapter(definition, dependencies)
    )
  );
}
