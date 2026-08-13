import { execFile } from 'node:child_process';
import { posix, win32 } from 'node:path';

import type { ProviderId, SystemInfo } from '../../shared/contracts';
import {
  providerDefinition,
  providerMinimumInstallNodeVersion,
  supportsManagedProviderUpdate
} from '../../shared/provider-definitions';

type Platform = SystemInfo['platform'];
type Environment = Readonly<Record<string, string | undefined>>;

export interface ProviderLifecycleInvocation {
  file: string;
  args: readonly string[];
  windowsVerbatimArguments?: boolean;
}

type ExecuteProviderLifecycle = (
  invocation: ProviderLifecycleInvocation
) => Promise<void>;

export class ProviderLifecycleError extends Error {
  constructor(
    readonly code:
      | 'PROVIDER_INSTALL_GUIDE_REQUIRED'
      | 'PROVIDER_PACKAGE_MANAGER_UNAVAILABLE'
      | 'PROVIDER_LIFECYCLE_FAILED',
    message = 'The provider installation could not be completed.'
  ) {
    super(message);
    this.name = 'ProviderLifecycleError';
  }
}

function readWindowsEnvironmentValue(
  env: Environment,
  key: string
): string | undefined {
  const matchingKey = Object.keys(env).find(
    (candidate) => candidate.toLowerCase() === key.toLowerCase()
  );
  return matchingKey === undefined ? undefined : env[matchingKey];
}

export function buildProviderLifecycleInvocation(
  provider: ProviderId,
  npmPath: string,
  { platform, env }: { platform: Platform; env: Environment }
): ProviderLifecycleInvocation {
  const definition = providerDefinition(provider);
  if (definition.npmPackage === null) {
    throw new ProviderLifecycleError(
      'PROVIDER_INSTALL_GUIDE_REQUIRED',
      `Use ${definition.displayName}'s official installation guide.`
    );
  }
  if (!/^(@[a-z0-9-]+\/)?[a-z0-9-]+$/i.test(definition.npmPackage)) {
    throw new ProviderLifecycleError('PROVIDER_LIFECYCLE_FAILED');
  }

  const pathApi = platform === 'win32' ? win32 : posix;
  if (!pathApi.isAbsolute(npmPath)) {
    throw new ProviderLifecycleError(
      'PROVIDER_PACKAGE_MANAGER_UNAVAILABLE',
      'npm could not be invoked safely.'
    );
  }
  const packageArgument = `${definition.npmPackage}@latest`;
  const args = ['install', '--global', packageArgument] as const;
  const wrapper = platform === 'win32' && /\.(?:cmd|bat)$/i.test(npmPath);
  if (!wrapper) return { file: npmPath, args };

  if (/["\r\n%]/.test(npmPath)) {
    throw new ProviderLifecycleError(
      'PROVIDER_PACKAGE_MANAGER_UNAVAILABLE',
      'npm could not be invoked safely.'
    );
  }
  return {
    file: readWindowsEnvironmentValue(env, 'ComSpec') ?? 'cmd.exe',
    args: [
      '/d',
      '/s',
      '/c',
      `""${npmPath}" ${args.join(' ')}"`
    ],
    windowsVerbatimArguments: true
  };
}

function executeLifecycle(
  invocation: ProviderLifecycleInvocation,
  env: Environment
): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(
      invocation.file,
      [...invocation.args],
      {
        encoding: 'utf8',
        env: { ...env, NO_COLOR: '1' },
        maxBuffer: 64 * 1024,
        timeout: 10 * 60 * 1_000,
        windowsHide: true,
        windowsVerbatimArguments:
          invocation.windowsVerbatimArguments ?? false
      },
      (error) => {
        if (error === null) resolve();
        else reject(new ProviderLifecycleError('PROVIDER_LIFECYCLE_FAILED'));
      }
    );
  });
}

export async function runProviderLifecycle(
  provider: ProviderId,
  {
    platform,
    env,
    findExecutable,
    probeVersion,
    action = 'install',
    execute
  }: {
    platform: Platform;
    env: Environment;
    findExecutable(command: string): Promise<string | null>;
    probeVersion?(
      executablePath: string,
      args: readonly string[]
    ): Promise<string>;
    action?: 'install' | 'update';
    execute?: ExecuteProviderLifecycle;
  }
): Promise<void> {
  if (providerDefinition(provider).npmPackage === null) {
    throw new ProviderLifecycleError(
      'PROVIDER_INSTALL_GUIDE_REQUIRED',
      `Use ${providerDefinition(provider).displayName}'s official installation guide.`
    );
  }
  if (action === 'update' && !supportsManagedProviderUpdate(provider)) {
    throw new ProviderLifecycleError(
      'PROVIDER_INSTALL_GUIDE_REQUIRED',
      `Use ${providerDefinition(provider).displayName}'s official updater or installation guide.`
    );
  }
  const minimumNodeVersion = providerMinimumInstallNodeVersion(provider);
  if (minimumNodeVersion !== null) {
    const nodePath = await findExecutable('node');
    if (nodePath === null || probeVersion === undefined) {
      throw new ProviderLifecycleError(
        'PROVIDER_PACKAGE_MANAGER_UNAVAILABLE',
        `Install Node.js ${minimumNodeVersion.join('.')} or newer before installing ${providerDefinition(provider).displayName}.`
      );
    }
    let version: string;
    try {
      version = await probeVersion(nodePath, ['--version']);
    } catch {
      throw new ProviderLifecycleError(
        'PROVIDER_PACKAGE_MANAGER_UNAVAILABLE',
        `Lumora could not verify Node.js ${minimumNodeVersion.join('.')} or newer.`
      );
    }
    const match = /(?:^|[^0-9])(\d+)\.(\d+)\.(\d+)(?![0-9])/u.exec(version);
    const installed = match?.slice(1, 4).map(Number) ?? null;
    const compare = installed === null ? -1 : installed.reduce(
      (result, value, index) => result !== 0 ? result : Math.sign(value - minimumNodeVersion[index]!),
      0
    );
    if (compare < 0) {
      throw new ProviderLifecycleError(
        'PROVIDER_PACKAGE_MANAGER_UNAVAILABLE',
        `${providerDefinition(provider).displayName} requires Node.js ${minimumNodeVersion.join('.')} or newer for npm installation.`
      );
    }
  }
  const npmPath = await findExecutable('npm');
  if (npmPath === null) {
    throw new ProviderLifecycleError(
      'PROVIDER_PACKAGE_MANAGER_UNAVAILABLE',
      'Install Node.js and npm before installing this provider.'
    );
  }
  const invocation = buildProviderLifecycleInvocation(provider, npmPath, {
    platform,
    env
  });
  try {
    await (execute ?? ((value) => executeLifecycle(value, env)))(invocation);
  } catch (error) {
    if (error instanceof ProviderLifecycleError) throw error;
    throw new ProviderLifecycleError('PROVIDER_LIFECYCLE_FAILED');
  }
}
