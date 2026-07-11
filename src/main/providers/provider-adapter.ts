import type {
  ProviderId,
  ProviderInstallation
} from '../../shared/contracts';

export interface ProviderAdapter {
  readonly provider: ProviderId;
  readonly displayName: string;
  scan(): Promise<ProviderInstallation>;
}

export interface ProviderScanDependencies {
  findExecutable(command: string): Promise<string | null>;
  probeVersion(executablePath: string): Promise<string>;
}

interface ProviderDefinition {
  provider: ProviderId;
  displayName: string;
  command: string;
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
  const { provider, displayName, command } = definition;

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

      try {
        const version = await dependencies.probeVersion(executablePath);
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
            recovery: `Run ${command} --version in a terminal, then refresh.`,
            retryable: true
          }
        };
      }
    }
  });
}
