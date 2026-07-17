import { execFile } from 'node:child_process';

import type { ProviderInstallation, SystemInfo } from '../../shared/contracts';
import { isPortableAbsolutePath } from './session-discovery';
import {
  ProviderSessionRecordSchema,
  type ProviderSessionDiscoveryResult,
  type ProviderSessionRecord
} from './session-discovery';

type Environment = Readonly<Record<string, string | undefined>>;
type ReadyProviderInstallation = Extract<
  ProviderInstallation,
  { state: 'ready' }
>;

export interface StructuredCommandInvocation {
  file: string;
  args: readonly string[];
  env: Environment;
  shell: false;
  windowsHide: true;
  timeoutMs: number;
  maxOutputBytes: number;
  windowsVerbatimArguments?: boolean;
}

export interface StructuredCommandOutput {
  stdout: string;
  stderr: string;
  exitCode: number;
  timedOut?: boolean;
  outputTruncated?: boolean;
}

export type StructuredCommandRunner = (
  invocation: StructuredCommandInvocation
) => Promise<StructuredCommandOutput>;

interface DiscoverOpenCodeOptions {
  installation: ReadyProviderInstallation;
  env: Environment;
  runCommand?: StructuredCommandRunner;
  timeoutMs?: number;
  maxOutputBytes?: number;
  platform?: SystemInfo['platform'];
}

interface OpenCodeInvocationOptions {
  platform: SystemInfo['platform'];
  env: Environment;
}

function currentPlatform(): SystemInfo['platform'] {
  return process.platform === 'darwin' || process.platform === 'win32'
    ? process.platform
    : 'linux';
}

export class OpenCodeSessionSourceError extends Error {
  readonly code = 'OPENCODE_SESSION_SOURCE_FAILED';

  constructor(message: string) {
    super(message);
    this.name = 'OpenCodeSessionSourceError';
  }
}

export const executeStructuredCommand: StructuredCommandRunner = (
  invocation
) =>
  new Promise((resolve) => {
    execFile(
      invocation.file,
      [...invocation.args],
      {
        encoding: 'utf8',
        env: { ...invocation.env },
        shell: invocation.shell,
        windowsHide: invocation.windowsHide,
        timeout: invocation.timeoutMs,
        maxBuffer: invocation.maxOutputBytes,
        ...(invocation.windowsVerbatimArguments === undefined
          ? {}
          : { windowsVerbatimArguments: invocation.windowsVerbatimArguments })
      },
      (error, stdout, stderr) => {
        if (error === null) {
          resolve({ stdout, stderr, exitCode: 0 });
          return;
        }
        const errorCode = 'code' in error ? error.code : undefined;
        const errorMessage = error.message.toLocaleLowerCase();
        resolve({
          stdout,
          stderr,
          exitCode: typeof errorCode === 'number' ? errorCode : 1,
          timedOut:
            'killed' in error && error.killed === true &&
            !errorMessage.includes('maxbuffer'),
          outputTruncated: errorMessage.includes('maxbuffer')
        });
      }
    );
  });

function environmentValue(env: Environment, key: string): string | undefined {
  const matching = Object.keys(env).find(
    (candidate) => candidate.toLocaleLowerCase() === key.toLocaleLowerCase()
  );
  return matching === undefined ? undefined : env[matching];
}

export function buildOpenCodeSessionInvocation(
  executablePath: string,
  { platform, env }: OpenCodeInvocationOptions
): Pick<
  StructuredCommandInvocation,
  'file' | 'args' | 'windowsVerbatimArguments'
> {
  if (platform !== 'win32' || !/\.(?:cmd|bat)$/i.test(executablePath)) {
    return {
      file: executablePath,
      args: ['session', 'list', '--format', 'json']
    };
  }
  if (/[\"%\r\n]/.test(executablePath)) {
    throw new OpenCodeSessionSourceError(
      'OpenCode command shim path cannot be invoked safely.'
    );
  }
  const commandProcessor = environmentValue(env, 'ComSpec')?.trim() || 'cmd.exe';
  return {
    file: commandProcessor,
    args: [
      '/d',
      '/s',
      '/c',
      `""${executablePath}" session list --format json"`
    ],
    windowsVerbatimArguments: true
  };
}

function normalizeSession(value: unknown): ProviderSessionRecord | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null;
  }
  const row = value as Record<string, unknown>;
  if (
    typeof row.id !== 'string' ||
    row.id.trim().length === 0 ||
    typeof row.directory !== 'string' ||
    !isPortableAbsolutePath(row.directory)
  ) {
    return null;
  }
  if (
    typeof row.created !== 'number' ||
    typeof row.updated !== 'number' ||
    !Number.isFinite(row.created) ||
    !Number.isFinite(row.updated) ||
    row.created > row.updated
  ) {
    return null;
  }
  const createdAt = new Date(row.created);
  const updatedAt = new Date(row.updated);
  if (
    !Number.isFinite(createdAt.getTime()) ||
    !Number.isFinite(updatedAt.getTime())
  ) {
    return null;
  }
  const requestedTitle = typeof row.title === 'string' ? row.title.trim() : '';
  const nativeId = row.id.trim();
  const parsed = ProviderSessionRecordSchema.safeParse({
    provider: 'opencode',
    nativeId,
    workspacePath: row.directory,
    title:
      requestedTitle.length > 0
        ? requestedTitle.slice(0, 256)
        : 'Untitled session',
    createdAt: createdAt.toISOString(),
    updatedAt: updatedAt.toISOString(),
    source: { key: `opencode:${nativeId}`, fingerprint: null }
  });
  return parsed.success ? parsed.data : null;
}

export async function discoverOpenCodeSessions({
  installation,
  env,
  runCommand = executeStructuredCommand,
  timeoutMs = 15_000,
  maxOutputBytes = 4 * 1024 * 1024,
  platform = currentPlatform()
}: DiscoverOpenCodeOptions): Promise<ProviderSessionDiscoveryResult> {
  if (installation.provider !== 'opencode') {
    throw new OpenCodeSessionSourceError(
      'OpenCode discovery requires an OpenCode installation.'
    );
  }
  const command = buildOpenCodeSessionInvocation(installation.executablePath, {
    platform,
    env
  });
  const output = await runCommand({
    ...command,
    env: { ...env, NO_COLOR: '1' },
    shell: false,
    windowsHide: true,
    timeoutMs,
    maxOutputBytes
  });
  if (output.timedOut) {
    throw new OpenCodeSessionSourceError(
      'OpenCode session discovery timed out.'
    );
  }
  if (
    output.outputTruncated ||
    Buffer.byteLength(output.stdout, 'utf8') > maxOutputBytes
  ) {
    throw new OpenCodeSessionSourceError(
      'OpenCode session discovery exceeded its output limit.'
    );
  }
  if (output.exitCode !== 0) {
    throw new OpenCodeSessionSourceError(
      'OpenCode session discovery command failed.'
    );
  }

  let rows: unknown;
  try {
    rows = JSON.parse(output.stdout);
  } catch {
    throw new OpenCodeSessionSourceError(
      'OpenCode session discovery returned invalid JSON.'
    );
  }
  if (!Array.isArray(rows)) {
    throw new OpenCodeSessionSourceError(
      'OpenCode session discovery did not return a JSON array.'
    );
  }

  const sessions = new Map<string, ProviderSessionRecord>();
  let invalidCount = 0;
  for (const row of rows) {
    const normalized = normalizeSession(row);
    if (normalized === null) {
      invalidCount += 1;
      continue;
    }
    const existing = sessions.get(normalized.nativeId);
    if (
      existing === undefined ||
      normalized.updatedAt > existing.updatedAt ||
      (normalized.updatedAt === existing.updatedAt &&
        normalized.title > existing.title)
    ) {
      sessions.set(normalized.nativeId, normalized);
    }
  }

  const orderedSessions = [...sessions.values()].sort(
    (left, right) =>
      right.updatedAt.localeCompare(left.updatedAt) ||
      left.nativeId.localeCompare(right.nativeId)
  );
  return {
    provider: 'opencode',
    sessions: orderedSessions,
    discoveredCount: orderedSessions.length,
    unchangedCount: 0,
    invalidCount
  };
}
