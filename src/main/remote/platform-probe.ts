import { z } from 'zod';

import {
  ExecutionTargetArchitectureSchema,
  PlatformSchema,
  type ExecutionTarget
} from '../../shared/contracts';

export const MAX_PLATFORM_PROBE_OUTPUT_BYTES = 64 * 1024;
const PLATFORM_PROBE_TIMEOUT_MS = 10_000;

export const POSIX_PLATFORM_PROBE_COMMAND = [
  `printf 'LUMORA_KERNEL=%s\\n' "$(uname -s)"`,
  `printf 'LUMORA_ARCH=%s\\n' "$(uname -m)"`,
  `printf 'LUMORA_HOME=%s\\n' "$HOME"`,
  `printf 'LUMORA_SHELL=%s\\n' "$SHELL"`
].join('; ');

export const WINDOWS_PLATFORM_PROBE_COMMAND =
  `powershell -NoProfile -NonInteractive -Command ` +
  `"[Console]::OutputEncoding=[Text.Encoding]::UTF8; ` +
  `$value=[ordered]@{platform='win32';architecture=$env:PROCESSOR_ARCHITECTURE;` +
  `homeDirectory=$HOME;helperBaseDirectory=$env:LOCALAPPDATA;defaultShell='powershell.exe'};` +
  `$value|ConvertTo-Json -Compress"`;

export interface RemoteCommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export type RemoteCommandExecutor = (
  command: string,
  limits: { timeoutMs: number; maxOutputBytes: number }
) => Promise<RemoteCommandResult>;

export interface RemotePlatformFacts {
  platform: Extract<ExecutionTarget, { kind: 'remote' }>['platform'];
  architecture: Extract<ExecutionTarget, { kind: 'remote' }>['architecture'];
  homeDirectory: string;
  helperBaseDirectory: string;
  defaultShell: string;
}

const WindowsProbeSchema = z.strictObject({
  platform: z.literal('win32'),
  architecture: z.string().trim().min(1).max(64),
  homeDirectory: z.string().trim().min(1).max(4096),
  helperBaseDirectory: z.string().trim().min(1).max(4096),
  defaultShell: z.string().trim().min(1).max(4096)
});

function ensureBounded(result: RemoteCommandResult): void {
  if (
    Buffer.byteLength(result.stdout, 'utf8') +
      Buffer.byteLength(result.stderr, 'utf8') >
    MAX_PLATFORM_PROBE_OUTPUT_BYTES
  ) {
    throw new Error('The remote platform probe exceeded its output limit.');
  }
}

function normalizeArchitecture(value: string): 'x64' | 'arm64' | 'unknown' {
  const normalized = value.trim().toLocaleLowerCase();
  if (['x86_64', 'amd64', 'x64'].includes(normalized)) return 'x64';
  if (['aarch64', 'arm64'].includes(normalized)) return 'arm64';
  return 'unknown';
}

function parsePosix(stdout: string): RemotePlatformFacts {
  const values = new Map<string, string>();
  for (const line of stdout.split(/\r?\n/)) {
    const separator = line.indexOf('=');
    if (separator <= 0) continue;
    values.set(line.slice(0, separator), line.slice(separator + 1).trim());
  }
  const kernel = values.get('LUMORA_KERNEL');
  const architecture = values.get('LUMORA_ARCH');
  const homeDirectory = values.get('LUMORA_HOME');
  const defaultShell = values.get('LUMORA_SHELL');
  if (!kernel || !architecture || !homeDirectory || !defaultShell) {
    throw new Error('The remote target returned an invalid platform response.');
  }
  const platform = kernel === 'Linux'
    ? 'linux'
    : kernel === 'Darwin'
      ? 'darwin'
      : null;
  if (platform === null) {
    throw new Error('The remote target returned an invalid platform response.');
  }
  return {
    platform: PlatformSchema.parse(platform),
    architecture: ExecutionTargetArchitectureSchema.parse(
      normalizeArchitecture(architecture)
    ),
    homeDirectory,
    helperBaseDirectory: homeDirectory,
    defaultShell
  };
}

function parseWindows(stdout: string): RemotePlatformFacts {
  try {
    const value = WindowsProbeSchema.parse(JSON.parse(stdout) as unknown);
    return {
      platform: value.platform,
      architecture: normalizeArchitecture(value.architecture),
      homeDirectory: value.homeDirectory,
      helperBaseDirectory: value.helperBaseDirectory,
      defaultShell: value.defaultShell
    };
  } catch {
    throw new Error('The remote target returned an invalid platform response.');
  }
}

export async function probeRemotePlatform(
  execute: RemoteCommandExecutor
): Promise<RemotePlatformFacts> {
  const limits = {
    maxOutputBytes: MAX_PLATFORM_PROBE_OUTPUT_BYTES,
    timeoutMs: PLATFORM_PROBE_TIMEOUT_MS
  } as const;
  const posix = await execute(POSIX_PLATFORM_PROBE_COMMAND, limits);
  ensureBounded(posix);
  if (posix.exitCode === 0) return parsePosix(posix.stdout);

  const windows = await execute(WINDOWS_PLATFORM_PROBE_COMMAND, limits);
  ensureBounded(windows);
  if (windows.exitCode === 0) return parseWindows(windows.stdout);

  throw new Error('Lumora could not identify the remote platform.');
}
