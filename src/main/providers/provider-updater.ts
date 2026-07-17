import { execFile } from 'node:child_process';
import { posix, win32 } from 'node:path';

import type { SystemInfo } from '../../shared/contracts';

type Platform = SystemInfo['platform'];
type Environment = Readonly<Record<string, string | undefined>>;

export interface ProviderUpdateInvocation {
  file: string;
  args: readonly string[];
  windowsVerbatimArguments?: boolean;
}

type ExecuteProviderUpdate = (
  invocation: ProviderUpdateInvocation
) => Promise<void>;

export class ProviderUpdateError extends Error {
  readonly code = 'PROVIDER_UPDATE_FAILED';

  constructor(message = 'The provider update could not be completed.') {
    super(message);
    this.name = 'ProviderUpdateError';
  }
}

function readWindowsEnvironmentValue(
  env: Environment,
  key: string
): string | undefined {
  const match = Object.keys(env).find(
    (candidate) => candidate.toLowerCase() === key.toLowerCase()
  );
  return match === undefined ? undefined : env[match];
}

export function buildProviderUpdateInvocation(
  executablePath: string,
  { platform, env }: { platform: Platform; env: Environment }
): ProviderUpdateInvocation {
  const pathApi = platform === 'win32' ? win32 : posix;
  if (!pathApi.isAbsolute(executablePath)) {
    throw new ProviderUpdateError('The provider executable path must be absolute.');
  }

  const wrapper = platform === 'win32' && /\.(?:cmd|bat)$/i.test(executablePath);
  if (!wrapper) return { file: executablePath, args: ['update'] };

  if (/["\r\n%]/.test(executablePath)) {
    throw new ProviderUpdateError(
      'The provider command wrapper path cannot be invoked safely.'
    );
  }

  return {
    file: readWindowsEnvironmentValue(env, 'ComSpec') ?? 'cmd.exe',
    args: ['/d', '/s', '/c', `""${executablePath}" update"`],
    windowsVerbatimArguments: true
  };
}

function executeProviderUpdate(
  invocation: ProviderUpdateInvocation,
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
        else reject(new ProviderUpdateError());
      }
    );
  });
}

export async function updateProviderExecutable(
  executablePath: string,
  {
    platform,
    env,
    execute
  }: {
    platform: Platform;
    env: Environment;
    execute?: ExecuteProviderUpdate;
  }
): Promise<void> {
  const invocation = buildProviderUpdateInvocation(executablePath, {
    platform,
    env
  });
  try {
    await (execute ?? ((value) => executeProviderUpdate(value, env)))(invocation);
  } catch {
    throw new ProviderUpdateError();
  }
}
