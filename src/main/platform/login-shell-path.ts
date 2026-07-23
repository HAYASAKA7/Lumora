import { execFile } from 'node:child_process';
import { posix } from 'node:path';

import type { SystemInfo } from '../../shared/contracts';
import { isExecutableFile } from './executable-locator';

type SupportedPlatform = SystemInfo['platform'];
type Environment = Readonly<Record<string, string | undefined>>;
type ShellExists = (path: string) => Promise<boolean>;

export interface ShellPathInvocation {
  file: string;
  args: readonly string[];
  env: Environment;
  timeoutMs: number;
  maxOutputBytes: number;
  outputStartMarker: string;
  outputEndMarker: string;
}

export interface ShellPathOutput {
  stdout: string;
  stderr: string;
  exitCode: number;
  timedOut?: boolean;
  outputTruncated?: boolean;
}

type ShellPathRunner = (
  invocation: ShellPathInvocation
) => Promise<ShellPathOutput>;

interface ResolveApplicationEnvironmentOptions {
  platform: SupportedPlatform;
  env: Environment;
  shellExists?: ShellExists;
  runCommand?: ShellPathRunner;
}

const OUTPUT_START_MARKER = '__LUMORA_PATH_BEGIN_9C47C45D__';
const OUTPUT_END_MARKER = '__LUMORA_PATH_END_9C47C45D__';
const COMMAND_TIMEOUT_MS = 3_000;
const MAX_OUTPUT_BYTES = 128 * 1024;
const MAX_PATH_BYTES = 64 * 1024;
const SUPPORTED_SHELLS = new Set([
  'bash',
  'zsh',
  'fish',
  'ksh',
  'sh',
  'dash'
]);

const executeShellPathCommand: ShellPathRunner = (invocation) =>
  new Promise((resolve) => {
    execFile(
      invocation.file,
      [...invocation.args],
      {
        encoding: 'utf8',
        env: { ...invocation.env },
        maxBuffer: invocation.maxOutputBytes,
        timeout: invocation.timeoutMs,
        windowsHide: true
      },
      (error, stdout, stderr) => {
        if (error === null) {
          resolve({ stdout, stderr, exitCode: 0 });
          return;
        }

        const errorMessage = error.message.toLocaleLowerCase();
        resolve({
          stdout,
          stderr,
          exitCode:
            'code' in error && typeof error.code === 'number' ? error.code : 1,
          timedOut:
            'killed' in error &&
            error.killed === true &&
            !errorMessage.includes('maxbuffer'),
          outputTruncated: errorMessage.includes('maxbuffer')
        });
      }
    );
  });

function fallbackShells(platform: Exclude<SupportedPlatform, 'win32'>): string[] {
  return platform === 'darwin'
    ? ['/bin/zsh', '/bin/bash', '/bin/sh']
    : [
        '/bin/bash',
        '/bin/zsh',
        '/usr/bin/zsh',
        '/usr/bin/fish',
        '/bin/sh'
      ];
}

function isSupportedAbsoluteShell(path: string): boolean {
  return posix.isAbsolute(path) && SUPPORTED_SHELLS.has(posix.basename(path));
}

async function selectShell(
  platform: Exclude<SupportedPlatform, 'win32'>,
  env: Environment,
  shellExists: ShellExists
): Promise<string | null> {
  const requestedShell = env.SHELL?.trim();
  const candidates = [
    ...(requestedShell !== undefined && isSupportedAbsoluteShell(requestedShell)
      ? [requestedShell]
      : []),
    ...fallbackShells(platform)
  ];

  for (const candidate of new Set(candidates)) {
    if (await shellExists(candidate)) {
      return candidate;
    }
  }

  return null;
}

function pathCommandFor(family: string): string {
  const printPath =
    family === 'fish' ? 'string join : $PATH' : `printf '%s\\n' "$PATH"`;
  return (
    `printf '%s\\n' '${OUTPUT_START_MARKER}'; ${printPath}; ` +
    `printf '%s\\n' '${OUTPUT_END_MARKER}'`
  );
}

function invocationsFor(shell: string, env: Environment): ShellPathInvocation[] {
  const base = {
    file: shell,
    env: { ...env, SHELL: shell },
    timeoutMs: COMMAND_TIMEOUT_MS,
    maxOutputBytes: MAX_OUTPUT_BYTES,
    outputStartMarker: OUTPUT_START_MARKER,
    outputEndMarker: OUTPUT_END_MARKER
  };
  const family = posix.basename(shell);
  const command = pathCommandFor(family);

  if (family === 'bash') {
    return [
      { ...base, args: ['-lc', command] },
      { ...base, args: ['-ic', command] }
    ];
  }
  if (family === 'sh' || family === 'dash') {
    return [{ ...base, args: ['-lc', command] }];
  }
  return [{ ...base, args: ['-ilc', command] }];
}

function parsePathOutput(
  invocation: ShellPathInvocation,
  output: ShellPathOutput
): string | null {
  if (
    output.exitCode !== 0 ||
    output.timedOut === true ||
    output.outputTruncated === true
  ) {
    return null;
  }

  const start = output.stdout.lastIndexOf(invocation.outputStartMarker);
  const valueStart = start + invocation.outputStartMarker.length;
  const end = output.stdout.indexOf(invocation.outputEndMarker, valueStart);
  if (start < 0 || end < 0) {
    return null;
  }

  const value = output.stdout.slice(valueStart, end).trim();
  if (
    value.length === 0 ||
    Buffer.byteLength(value, 'utf8') > MAX_PATH_BYTES ||
    /[\0\r\n]/.test(value)
  ) {
    return null;
  }
  return value;
}

function mergePathValues(values: readonly (string | undefined)[]): string {
  const entries: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    for (const rawEntry of value?.split(':') ?? []) {
      const entry = rawEntry.trim();
      if (entry.length === 0 || seen.has(entry)) {
        continue;
      }
      seen.add(entry);
      entries.push(entry);
    }
  }
  return entries.join(':');
}

export async function resolveApplicationEnvironment({
  platform,
  env,
  shellExists = (path) => isExecutableFile(path, platform),
  runCommand = executeShellPathCommand
}: ResolveApplicationEnvironmentOptions): Promise<Environment> {
  if (platform === 'win32') {
    return env;
  }

  const shell = await selectShell(platform, env, shellExists);
  if (shell === null) {
    return env;
  }

  const invocations = invocationsFor(shell, env);
  const recoveredPaths: string[] = [];
  for (const invocation of invocations) {
    try {
      const path = parsePathOutput(invocation, await runCommand(invocation));
      if (path !== null) {
        recoveredPaths.push(path);
      }
    } catch {
      // A failed shell probe must not prevent Lumora from starting.
    }
  }
  if (recoveredPaths.length === 0) {
    return env;
  }

  const prioritizedPaths =
    posix.basename(shell) === 'bash'
      ? recoveredPaths.toReversed()
      : recoveredPaths;
  return {
    ...env,
    PATH: mergePathValues([...prioritizedPaths, env.PATH])
  };
}
