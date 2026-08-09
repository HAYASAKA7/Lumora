import { spawn } from 'node-pty';

import {
  PtyProcessExitedError,
  type PtyProcess,
  type PtySpawnOptions
} from './runtime-host';

const PTY_EXIT_ERROR_CODES = new Set([
  'EPIPE',
  'ERR_SOCKET_CLOSED',
  'ERR_STREAM_DESTROYED',
  'ERR_STREAM_WRITE_AFTER_END'
]);
const PTY_EXIT_ERROR_MESSAGE =
  /(?:pty that has already exited|write after end)/i;

function isPtyExitError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const code =
    'code' in error && typeof error.code === 'string'
      ? error.code
      : null;
  if (code !== null && PTY_EXIT_ERROR_CODES.has(code)) return true;
  return error instanceof Error && PTY_EXIT_ERROR_MESSAGE.test(error.message);
}

export function runPtyOperation(operation: () => void): void {
  try {
    operation();
  } catch (error) {
    if (isPtyExitError(error)) {
      throw new PtyProcessExitedError();
    }
    throw error;
  }
}

function definedEnvironment(
  env: Readonly<Record<string, string | undefined>>
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(env).filter(
      (entry): entry is [string, string] => entry[1] !== undefined
    )
  );
}

export function spawnPty(options: PtySpawnOptions): PtyProcess {
  const process = spawn(options.executablePath, options.args, {
    name: 'xterm-256color',
    cwd: options.cwd,
    env: definedEnvironment(options.env),
    cols: options.cols,
    rows: options.rows,
    handleFlowControl: true
  });
  return {
    pid: process.pid,
    write(data) {
      runPtyOperation(() => {
        process.write(data);
      });
    },
    resize(cols, rows) {
      runPtyOperation(() => {
        process.resize(cols, rows);
      });
    },
    kill() {
      process.kill();
    },
    onData(listener) {
      return process.onData(listener);
    },
    onExit(listener) {
      return process.onExit(listener);
    }
  };
}
