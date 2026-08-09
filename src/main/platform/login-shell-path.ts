import { execFile } from 'node:child_process';
import { posix } from 'node:path';

import type { SystemInfo } from '../../shared/contracts';
import { isExecutableFile } from './executable-locator';

type SupportedPlatform = SystemInfo['platform'];
type Environment = Readonly<Record<string, string | undefined>>;
type ShellExists = (path: string) => Promise<boolean>;
type WindowsUserEnvironmentReader = (
  names: readonly string[]
) => Promise<Readonly<Record<string, string>>>;

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
  readWindowsUserEnvironment?: WindowsUserEnvironmentReader;
}

const OUTPUT_START_MARKER = '__LUMORA_PATH_BEGIN_9C47C45D__';
const OUTPUT_END_MARKER = '__LUMORA_PATH_END_9C47C45D__';
const PROVIDER_ENV_START_MARKER = '__LUMORA_PROVIDER_ENV_BEGIN_5E76A1B2__';
const PROVIDER_ENV_END_MARKER = '__LUMORA_PROVIDER_ENV_END_5E76A1B2__';
const PROVIDER_ENVIRONMENT_NAMES = [
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_AUTH_TOKEN',
  'ANTHROPIC_BASE_URL'
] as const;
const COMMAND_TIMEOUT_MS = 3_000;
const MAX_OUTPUT_BYTES = 128 * 1024;
const MAX_PATH_BYTES = 64 * 1024;
const MAX_PROVIDER_ENV_VALUE_BYTES = 16 * 1024;
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

const readWindowsUserEnvironment: WindowsUserEnvironmentReader = async (
  names
) => {
  const entries = await Promise.all(
    names.map(
      (name) =>
        new Promise<readonly [string, string] | null>((resolve) => {
          execFile(
            'reg.exe',
            ['query', 'HKCU\\Environment', '/v', name],
            {
              encoding: 'utf8',
              maxBuffer: 32 * 1024,
              timeout: 1_000,
              windowsHide: true
            },
            (error, stdout) => {
              if (error !== null) {
                resolve(null);
                return;
              }
              const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
              const match = stdout.match(
                new RegExp(
                  `^\\s*${escapedName}\\s+REG_(?:SZ|EXPAND_SZ)\\s+(.+?)\\s*$`,
                  'im'
                )
              );
              const value = match?.[1]?.trim() ?? '';
              if (
                value.length === 0 ||
                /[\0\r\n]/.test(value) ||
                Buffer.byteLength(value, 'utf8') > MAX_PROVIDER_ENV_VALUE_BYTES
              ) {
                resolve(null);
                return;
              }
              resolve([name, value] as const);
            }
          );
        })
    )
  );
  return Object.fromEntries(
    entries.filter((entry): entry is readonly [string, string] => entry !== null)
  );
};

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
  const variableExpression = (name: string) =>
    family === 'fish' ? `"$${name}"` : `"\${${name}-}"`;
  const printProviderEnvironment = PROVIDER_ENVIRONMENT_NAMES.map(
    (name) => `printf '${name}=%s\\n' ${variableExpression(name)}`
  ).join('; ');
  return (
    `printf '%s\\n' '${OUTPUT_START_MARKER}'; ${printPath}; ` +
    `printf '%s\\n' '${OUTPUT_END_MARKER}'; ` +
    `printf '%s\\n' '${PROVIDER_ENV_START_MARKER}'; ` +
    `${printProviderEnvironment}; ` +
    `printf '%s\\n' '${PROVIDER_ENV_END_MARKER}'`
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

function parseProviderEnvironmentOutput(
  output: ShellPathOutput
): Record<string, string> {
  if (
    output.exitCode !== 0 ||
    output.timedOut === true ||
    output.outputTruncated === true
  ) {
    return {};
  }
  const start = output.stdout.lastIndexOf(PROVIDER_ENV_START_MARKER);
  const valueStart = start + PROVIDER_ENV_START_MARKER.length;
  const end = output.stdout.indexOf(PROVIDER_ENV_END_MARKER, valueStart);
  if (start < 0 || end < 0) return {};

  const lines = output.stdout.slice(valueStart, end).trim().split(/\r?\n/);
  if (lines.length !== PROVIDER_ENVIRONMENT_NAMES.length) return {};
  const recovered: Record<string, string> = {};
  for (const [index, name] of PROVIDER_ENVIRONMENT_NAMES.entries()) {
    const prefix = `${name}=`;
    const line = lines[index];
    if (line === undefined || !line.startsWith(prefix)) return {};
    const value = line.slice(prefix.length);
    if (
      value.length === 0 ||
      /[\0\r\n]/.test(value) ||
      Buffer.byteLength(value, 'utf8') > MAX_PROVIDER_ENV_VALUE_BYTES
    ) {
      continue;
    }
    recovered[name] = value;
  }
  return recovered;
}

function mergeMissingEnvironment(
  base: Environment,
  recoveredValues: readonly Readonly<Record<string, string>>[]
): Record<string, string | undefined> {
  const merged = { ...base };
  const existingNames = new Set(
    Object.entries(merged)
      .filter(([, value]) => value !== undefined && value.length > 0)
      .map(([name]) => name.toLocaleUpperCase())
  );
  for (const recovered of recoveredValues) {
    for (const [name, value] of Object.entries(recovered)) {
      const normalizedName = name.toLocaleUpperCase();
      if (existingNames.has(normalizedName)) continue;
      merged[name] = value;
      existingNames.add(normalizedName);
    }
  }
  return merged;
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
  runCommand = executeShellPathCommand,
  readWindowsUserEnvironment: readWindowsEnvironment =
    readWindowsUserEnvironment
}: ResolveApplicationEnvironmentOptions): Promise<Environment> {
  if (platform === 'win32') {
    try {
      const merged = mergeMissingEnvironment(env, [
        await readWindowsEnvironment(PROVIDER_ENVIRONMENT_NAMES)
      ]);
      return Object.keys(merged).length === Object.keys(env).length
        ? env
        : merged;
    } catch {
      return env;
    }
  }

  const shell = await selectShell(platform, env, shellExists);
  if (shell === null) {
    return env;
  }

  const invocations = invocationsFor(shell, env);
  const recoveredPaths: string[] = [];
  const recoveredProviderEnvironments: Record<string, string>[] = [];
  for (const invocation of invocations) {
    try {
      const output = await runCommand(invocation);
      const path = parsePathOutput(invocation, output);
      if (path !== null) {
        recoveredPaths.push(path);
      }
      recoveredProviderEnvironments.push(
        parseProviderEnvironmentOutput(output)
      );
    } catch {
      // A failed shell probe must not prevent Lumora from starting.
    }
  }
  if (
    recoveredPaths.length === 0 &&
    recoveredProviderEnvironments.every(
      (environment) => Object.keys(environment).length === 0
    )
  ) {
    return env;
  }

  const prioritize = <Value>(values: readonly Value[]): readonly Value[] =>
    posix.basename(shell) === 'bash'
      ? values.toReversed()
      : values;
  const prioritizedPaths = prioritize(recoveredPaths);
  const merged = mergeMissingEnvironment(
    env,
    prioritize(recoveredProviderEnvironments)
  );
  return {
    ...merged,
    ...(prioritizedPaths.length === 0
      ? {}
      : { PATH: mergePathValues([...prioritizedPaths, env.PATH]) })
  };
}
