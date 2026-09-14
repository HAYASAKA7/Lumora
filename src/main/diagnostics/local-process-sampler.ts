import { spawn } from 'node:child_process';
import type { Readable, Writable } from 'node:stream';

import type { HelperProcessTreeResult } from '../../shared/remote-helper-protocol';
import {
  connectRemoteHelper,
  type ConnectedRemoteHelper
} from '../remote/helper-connection';

/** How long the helper stays running after the last sample. */
const DEFAULT_IDLE_MS = 15_000;
/** How long to wait before starting the helper again after it failed. */
const DEFAULT_RETRY_AFTER_MS = 30_000;

export interface LocalHelperProcess {
  readonly stdin: Writable;
  readonly stdout: Readable;
  readonly stderr: Readable;
  kill(): boolean;
  once(event: 'exit' | 'error', listener: () => void): unknown;
}

export interface LocalProcessSampler {
  sample(rootPid: number): Promise<HelperProcessTreeResult>;
  close(): void;
}

export class LocalProcessSamplerError extends Error {
  constructor() {
    super('Lumora could not read process information.');
    this.name = 'LocalProcessSamplerError';
  }
}

interface CreateLocalProcessSamplerOptions {
  /** Resolves the verified helper executable for this computer. */
  resolveExecutable(): Promise<string>;
  platform: 'win32' | 'darwin' | 'linux';
  architecture: 'x64' | 'arm64';
  startHelper?: (executablePath: string) => LocalHelperProcess;
  connect?: typeof connectRemoteHelper;
  idleMs?: number;
  retryAfterMs?: number;
  now?: () => number;
}

function startHelperProcess(executablePath: string): LocalHelperProcess {
  return spawn(executablePath, [], {
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true
  });
}

/**
 * Runs Lumora's helper on this computer only while process details are being
 * read: it starts on the first sample and exits once samples stop arriving.
 */
export function createLocalProcessSampler({
  resolveExecutable,
  platform,
  architecture,
  startHelper = startHelperProcess,
  connect = connectRemoteHelper,
  idleMs = DEFAULT_IDLE_MS,
  retryAfterMs = DEFAULT_RETRY_AFTER_MS,
  now = Date.now
}: CreateLocalProcessSamplerOptions): LocalProcessSampler {
  let connection: Promise<ConnectedRemoteHelper> | null = null;
  let idleTimer: ReturnType<typeof setTimeout> | null = null;
  let failedAt: number | null = null;
  let generation = 0;

  const disconnect = () => {
    const current = connection;
    connection = null;
    void current?.then((helper) => helper.close(), () => undefined);
  };

  const open = (): Promise<ConnectedRemoteHelper> => {
    if (connection !== null) return connection;
    if (failedAt !== null && now() - failedAt < retryAfterMs) {
      return Promise.reject(new LocalProcessSamplerError());
    }
    generation += 1;
    const opening = (async () => {
      const child = startHelper(await resolveExecutable());
      const ended = () => {
        if (connection === opening) connection = null;
      };
      child.once('exit', ended);
      child.once('error', ended);
      return connect({
        channel: {
          stdin: child.stdin,
          stdout: child.stdout,
          stderr: child.stderr,
          close: () => {
            child.kill();
          }
        },
        generation,
        expectedPlatform: platform,
        expectedArchitecture: architecture
      });
    })();
    connection = opening;
    return opening;
  };

  const armIdleTimer = () => {
    if (idleTimer !== null) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      idleTimer = null;
      disconnect();
    }, idleMs);
    idleTimer.unref?.();
  };

  return Object.freeze({
    async sample(rootPid: number) {
      try {
        const helper = await open();
        const result = await helper.sampleProcessTree(rootPid);
        failedAt = null;
        return result;
      } catch (error) {
        // Waiting out an earlier failure is not a new one.
        if (!(error instanceof LocalProcessSamplerError)) {
          failedAt = now();
          disconnect();
        }
        throw new LocalProcessSamplerError();
      } finally {
        armIdleTimer();
      }
    },
    close() {
      if (idleTimer !== null) clearTimeout(idleTimer);
      idleTimer = null;
      disconnect();
    }
  });
}
