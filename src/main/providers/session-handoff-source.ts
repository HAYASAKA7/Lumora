import { constants } from 'node:fs';
import { copyFile, readFile, stat, writeFile } from 'node:fs/promises';
import { extname, isAbsolute, join } from 'node:path';

import type { ProviderId, SystemInfo } from '../../shared/contracts';
import {
  executeStructuredCommand,
  type StructuredCommandInvocation,
  type StructuredCommandRunner
} from './opencode-session-source';
import type {
  SessionHandoffSnapshotter
} from './session-catalog-adapter';

type Environment = Readonly<Record<string, string | undefined>>;
const MAX_SOURCE_BYTES = 64 * 1024 * 1024;

function sameFileState(
  left: { size: number; mtimeMs: number },
  right: { size: number; mtimeMs: number }
): boolean {
  return Math.trunc(left.size) === Math.trunc(right.size) &&
    Math.trunc(left.mtimeMs) === Math.trunc(right.mtimeMs);
}

export function createFileHandoffSnapshotter(
  provider: ProviderId
): SessionHandoffSnapshotter {
  return async ({ sourceKeys, sourceDirectory }) => {
    if (sourceKeys.length !== 1) {
      throw new Error(
        `${provider} handoff requires exactly one current source.`
      );
    }
    const sourcePath = sourceKeys[0]!;
    if (!isAbsolute(sourcePath)) {
      throw new Error(`${provider} handoff source is not a local file.`);
    }
    const before = await stat(sourcePath);
    if (!before.isFile() || before.size < 1 || before.size > MAX_SOURCE_BYTES) {
      throw new Error(`${provider} handoff source is unavailable or too large.`);
    }
    const extension = extname(sourcePath).toLocaleLowerCase();
    const safeExtension = extension === '.json' || extension === '.jsonl'
      ? extension
      : '.jsonl';
    const destinationPath = join(
      sourceDirectory,
      `${provider}-session${safeExtension}`
    );
    await copyFile(sourcePath, destinationPath, constants.COPYFILE_EXCL);
    const after = await stat(sourcePath);
    if (!sameFileState(before, after)) {
      throw new Error(`${provider} handoff source changed while copying.`);
    }
    const raw = await readFile(destinationPath, 'utf8');
    if (Buffer.byteLength(raw, 'utf8') !== before.size) {
      throw new Error(`${provider} handoff snapshot is incomplete.`);
    }
    return { raw, sourceFiles: [destinationPath] };
  };
}

interface OpenCodeHandoffSnapshotterOptions {
  env: Environment;
  platform: SystemInfo['platform'];
  runCommand?: StructuredCommandRunner;
  timeoutMs?: number;
  maxOutputBytes?: number;
}

function environmentValue(env: Environment, key: string): string | undefined {
  const matching = Object.keys(env).find(
    (candidate) => candidate.toLocaleLowerCase() === key.toLocaleLowerCase()
  );
  return matching === undefined ? undefined : env[matching];
}

function openCodeExportInvocation(
  executablePath: string,
  nativeSessionId: string,
  platform: SystemInfo['platform'],
  env: Environment
): Pick<
  StructuredCommandInvocation,
  'file' | 'args' | 'windowsVerbatimArguments'
> {
  if (!/^[A-Za-z0-9._:-]{1,256}$/.test(nativeSessionId)) {
    throw new Error('The OpenCode session identity cannot be exported safely.');
  }
  if (platform !== 'win32' || !/\.(?:cmd|bat)$/i.test(executablePath)) {
    return {
      file: executablePath,
      args: ['export', nativeSessionId]
    };
  }
  if (/["%\r\n]/.test(executablePath)) {
    throw new Error('The OpenCode command shim cannot be exported safely.');
  }
  return {
    file: environmentValue(env, 'ComSpec')?.trim() || 'cmd.exe',
    args: [
      '/d',
      '/s',
      '/c',
      `""${executablePath}" export ${nativeSessionId}"`
    ],
    windowsVerbatimArguments: true
  };
}

export function createOpenCodeHandoffSnapshotter({
  env,
  platform,
  runCommand = executeStructuredCommand,
  timeoutMs = 30_000,
  maxOutputBytes = MAX_SOURCE_BYTES
}: OpenCodeHandoffSnapshotterOptions): SessionHandoffSnapshotter {
  return async ({ nativeSessionId, installation, sourceDirectory }) => {
    if (installation.provider !== 'opencode') {
      throw new Error('OpenCode handoff requires an OpenCode installation.');
    }
    const command = openCodeExportInvocation(
      installation.executablePath,
      nativeSessionId,
      platform,
      env
    );
    const output = await runCommand({
      ...command,
      env: { ...env, NO_COLOR: '1' },
      shell: false,
      windowsHide: true,
      timeoutMs,
      maxOutputBytes
    });
    if (output.timedOut) throw new Error('OpenCode export command timed out.');
    if (
      output.outputTruncated ||
      Buffer.byteLength(output.stdout, 'utf8') > maxOutputBytes
    ) throw new Error('OpenCode export exceeded the handoff size limit.');
    if (output.exitCode !== 0) {
      throw new Error('OpenCode export command failed.');
    }
    try {
      JSON.parse(output.stdout);
    } catch {
      throw new Error('OpenCode export returned invalid JSON.');
    }
    const destinationPath = join(sourceDirectory, 'opencode-session.json');
    await writeFile(destinationPath, output.stdout, {
      encoding: 'utf8',
      flag: 'wx'
    });
    return { raw: output.stdout, sourceFiles: [destinationPath] };
  };
}
