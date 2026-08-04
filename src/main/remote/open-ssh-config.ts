import { execFile } from 'node:child_process';

import type { ResolvedSshConfigHost } from './ssh-client';
import { RemoteSshError } from './ssh-errors';

const OPEN_SSH_CONFIG_TIMEOUT_MS = 10_000;
const MAX_OPEN_SSH_CONFIG_OUTPUT_BYTES = 64 * 1024;
const SSH_CONFIG_ALIAS_PATTERN = /^[A-Za-z0-9._-]{1,255}$/u;

interface OpenSshRunOptions {
  timeoutMs: number;
  maxOutputBytes: number;
}

export type OpenSshCommandRunner = (
  executable: string,
  arguments_: string[],
  options: OpenSshRunOptions
) => Promise<{ stdout: string }>;

function defaultRun(
  executable: string,
  arguments_: string[],
  options: OpenSshRunOptions
): Promise<{ stdout: string }> {
  return new Promise((resolve, reject) => {
    execFile(executable, arguments_, {
      encoding: 'utf8',
      timeout: options.timeoutMs,
      maxBuffer: options.maxOutputBytes,
      windowsHide: true
    }, (error, stdout) => {
      if (error !== null) {
        reject(error);
        return;
      }
      resolve({ stdout });
    });
  });
}

export function parseOpenSshEffectiveConfig(
  output: string
): ResolvedSshConfigHost {
  if (Buffer.byteLength(output, 'utf8') > MAX_OPEN_SSH_CONFIG_OUTPUT_BYTES) {
    throw new RemoteSshError(
      'SSH_OUTPUT_LIMIT',
      'The OpenSSH configuration exceeded its output limit.'
    );
  }
  const values = new Map<string, string>();
  for (const rawLine of output.split(/\r?\n/u)) {
    const line = rawLine.trim();
    const separator = line.search(/\s/u);
    if (separator <= 0) continue;
    const key = line.slice(0, separator).toLocaleLowerCase();
    if (!values.has(key)) values.set(key, line.slice(separator).trim());
  }

  const proxyJump = values.get('proxyjump');
  if (proxyJump !== undefined && proxyJump.toLocaleLowerCase() !== 'none') {
    throw new RemoteSshError(
      'SSH_CONNECTION_FAILED',
      'OpenSSH jump hosts are not supported in this Lumora version.'
    );
  }
  const host = values.get('hostname');
  const username = values.get('user');
  const rawPort = values.get('port');
  const port = rawPort === undefined ? Number.NaN : Number(rawPort);
  if (
    host === undefined || host.length === 0 || host.length > 4096 ||
    username === undefined || username.length === 0 || username.length > 255 ||
    !Number.isInteger(port) || port < 1 || port > 65_535
  ) {
    throw new RemoteSshError(
      'SSH_CONNECTION_FAILED',
      'Lumora received an invalid OpenSSH configuration.'
    );
  }
  return { host, port, username };
}

export function createOpenSshConfigResolver(
  input: { run?: OpenSshCommandRunner } = {}
): (alias: string) => Promise<ResolvedSshConfigHost> {
  const run = input.run ?? defaultRun;
  return async (alias) => {
    if (!SSH_CONFIG_ALIAS_PATTERN.test(alias)) {
      throw new RemoteSshError(
        'SSH_CONNECTION_FAILED',
        'The OpenSSH host alias is invalid.'
      );
    }
    try {
      const result = await run('ssh', ['-G', '--', alias], {
        timeoutMs: OPEN_SSH_CONFIG_TIMEOUT_MS,
        maxOutputBytes: MAX_OPEN_SSH_CONFIG_OUTPUT_BYTES
      });
      return parseOpenSshEffectiveConfig(result.stdout);
    } catch (error) {
      if (error instanceof RemoteSshError) throw error;
      throw new RemoteSshError(
        'SSH_CONNECTION_FAILED',
        'Lumora could not resolve the OpenSSH host alias.'
      );
    }
  };
}
