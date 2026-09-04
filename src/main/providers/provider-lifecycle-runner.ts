import { execFile, type ChildProcess } from 'node:child_process';
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
  runtimePath?: string;
}

type ExecuteProviderLifecycle = (
  invocation: ProviderLifecycleInvocation
) => Promise<void>;

export class ProviderLifecycleError extends Error {
  constructor(
    readonly code:
      | 'PROVIDER_INSTALL_GUIDE_REQUIRED'
      | 'PROVIDER_PACKAGE_MANAGER_UNAVAILABLE'
      | 'PROVIDER_LIFECYCLE_FAILED'
      | 'PROVIDER_LIFECYCLE_BUSY'
      | 'PROVIDER_LIFECYCLE_CANCELLED',
    message = 'The provider installation could not be completed.'
  ) {
    super(message);
    this.name = 'ProviderLifecycleError';
  }
}

/**
 * npm replaces a global package by moving the installed one aside first, and on
 * Windows a running executable cannot be renamed. The package is then left
 * half-moved, which is why an update over a running provider both fails and
 * breaks the installation.
 *
 * Only the shape of the failure is read out of npm's output. The text itself
 * never reaches the caller, because it can carry registry credentials.
 */
const BUSY_FAILURE = /\b(?:EBUSY|EPERM|EACCES)\b|resource busy or locked|errno -404[82]\b/u;

export function classifyLifecycleFailure(output: string): 'busy' | 'failed' {
  return BUSY_FAILURE.test(output) ? 'busy' : 'failed';
}

function terminateProcessTree(
  child: ChildProcess,
  platform: Platform
): void {
  const { pid } = child;
  if (pid === undefined) return;
  if (platform === 'win32') {
    /**
     * Windows runs npm through a `cmd.exe` wrapper, so signalling the child
     * would leave npm and its own node process running. Only a tree kill stops
     * the installation Lumora actually started.
     */
    execFile('taskkill', ['/pid', String(pid), '/t', '/f'], () => undefined);
    return;
  }
  child.kill('SIGTERM');
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
  env: Environment,
  platform: Platform,
  signal?: AbortSignal
): Promise<void> {
  const pathKey = Object.keys(env).find(
    (key) => key.toLowerCase() === 'path'
  ) ?? 'PATH';
  const delimiter = platform === 'win32' ? ';' : ':';
  const executionEnvironment = {
    ...env,
    ...(invocation.runtimePath === undefined
      ? {}
      : {
          [pathKey]: [invocation.runtimePath, env[pathKey]]
            .filter((value): value is string => value !== undefined && value.length > 0)
            .join(delimiter)
        }),
    NO_COLOR: '1'
  };
  return new Promise((resolve, reject) => {
    const child = execFile(
      invocation.file,
      [...invocation.args],
      {
        encoding: 'utf8',
        env: executionEnvironment,
        maxBuffer: 64 * 1024,
        timeout: 10 * 60 * 1_000,
        windowsHide: true,
        windowsVerbatimArguments:
          invocation.windowsVerbatimArguments ?? false
      },
      (error, stdout, stderr) => {
        signal?.removeEventListener('abort', abort);
        if (signal?.aborted === true) {
          reject(
            new ProviderLifecycleError(
              'PROVIDER_LIFECYCLE_CANCELLED',
              'The provider lifecycle operation was cancelled.'
            )
          );
          return;
        }
        if (error === null) {
          resolve();
          return;
        }
        reject(
          classifyLifecycleFailure(`${stdout}\n${stderr}`) === 'busy'
            ? new ProviderLifecycleError(
                'PROVIDER_LIFECYCLE_BUSY',
                'The provider is running, so its files could not be replaced.'
              )
            : new ProviderLifecycleError('PROVIDER_LIFECYCLE_FAILED')
        );
      }
    );
    const abort = (): void => terminateProcessTree(child, platform);
    signal?.addEventListener('abort', abort, { once: true });
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
    signal,
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
    signal?: AbortSignal;
    execute?: ExecuteProviderLifecycle;
  }
): Promise<void> {
  if (signal?.aborted === true) {
    throw new ProviderLifecycleError(
      'PROVIDER_LIFECYCLE_CANCELLED',
      'The provider lifecycle operation was cancelled.'
    );
  }
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
  let runtimePath: string | undefined;
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
    runtimePath = (platform === 'win32' ? win32 : posix).dirname(nodePath);
  }
  const npmPath = await findExecutable('npm');
  if (npmPath === null) {
    throw new ProviderLifecycleError(
      'PROVIDER_PACKAGE_MANAGER_UNAVAILABLE',
      'Install Node.js and npm before installing this provider.'
    );
  }
  const invocation = {
    ...buildProviderLifecycleInvocation(provider, npmPath, {
      platform,
      env
    }),
    ...(runtimePath === undefined ? {} : { runtimePath })
  };
  try {
    await (
      execute ?? ((value) => executeLifecycle(value, env, platform, signal))
    )(invocation);
  } catch (error) {
    if (error instanceof ProviderLifecycleError) throw error;
    throw new ProviderLifecycleError('PROVIDER_LIFECYCLE_FAILED');
  }
}
