import { execFile } from 'node:child_process';
import { posix, win32 } from 'node:path';

import type { SystemInfo } from '../../shared/contracts';

type SupportedPlatform = SystemInfo['platform'];
type Environment = Readonly<Record<string, string | undefined>>;

export interface VersionInvocation {
  file: string;
  args: readonly string[];
}

export interface VersionCommandOutput {
  stdout: string;
  stderr: string;
}

type ExecuteVersionCommand = (
  invocation: VersionInvocation
) => Promise<VersionCommandOutput>;

interface VersionInvocationOptions {
  platform: SupportedPlatform;
  env: Environment;
}

interface ProbeVersionOptions extends VersionInvocationOptions {
  execute?: ExecuteVersionCommand;
}

export class VersionProbeError extends Error {
  readonly code = 'VERSION_PROBE_FAILED';

  constructor(message = 'The provider version command failed.') {
    super(message);
    this.name = 'VersionProbeError';
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

export function buildVersionInvocation(
  executablePath: string,
  { platform, env }: VersionInvocationOptions
): VersionInvocation {
  const pathApi = platform === 'win32' ? win32 : posix;
  if (!pathApi.isAbsolute(executablePath)) {
    throw new VersionProbeError('The provider executable path must be absolute.');
  }

  const isWindowsWrapper =
    platform === 'win32' && /\.(?:cmd|bat)$/i.test(executablePath);

  if (!isWindowsWrapper) {
    return { file: executablePath, args: ['--version'] };
  }

  if (/["\r\n%]/.test(executablePath)) {
    throw new VersionProbeError(
      'The provider command wrapper path cannot be invoked safely.'
    );
  }

  const commandProcessor =
    readWindowsEnvironmentValue(env, 'ComSpec') ?? 'cmd.exe';

  return {
    file: commandProcessor,
    args: ['/d', '/s', '/c', `""${executablePath}" --version"`]
  };
}

export function executeVersionInvocation(
  invocation: VersionInvocation,
  env: Environment = process.env
): Promise<VersionCommandOutput> {
  return new Promise((resolve, reject) => {
    execFile(
      invocation.file,
      [...invocation.args],
      {
        encoding: 'utf8',
        env: { ...env, NO_COLOR: '1' },
        maxBuffer: 32 * 1024,
        timeout: 5_000,
        windowsHide: true
      },
      (error, stdout, stderr) => {
        if (error !== null) {
          reject(new VersionProbeError());
          return;
        }

        resolve({ stdout, stderr });
      }
    );
  });
}

function firstOutputLine(output: string): string | null {
  for (const line of output.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.length > 0) {
      return trimmed.slice(0, 256);
    }
  }

  return null;
}

export async function probeVersion(
  executablePath: string,
  { platform, env, execute }: ProbeVersionOptions
): Promise<string> {
  const invocation = buildVersionInvocation(executablePath, { platform, env });

  let output: VersionCommandOutput;
  try {
    output = await (execute ?? ((value) => executeVersionInvocation(value, env)))(
      invocation
    );
  } catch {
    throw new VersionProbeError();
  }

  const version = firstOutputLine(output.stdout) ?? firstOutputLine(output.stderr);
  if (version === null) {
    throw new VersionProbeError();
  }

  return version;
}
