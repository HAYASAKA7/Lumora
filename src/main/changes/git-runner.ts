import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';

/** Flags on every call: stable output, no CRLF warnings, no background work in the user's repository. */
export const GIT_BASE_ARGS: readonly string[] = [
  '-c', 'core.quotepath=false',
  '-c', 'core.safecrlf=false',
  '-c', 'core.fsmonitor=false',
  '-c', 'gc.auto=0',
  '-c', 'maintenance.auto=false'
];

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_OUTPUT_BYTES = 8 * 1024 * 1024;

export type GitFailureReason =
  | 'failed'
  | 'timeout'
  | 'output-too-large'
  | 'unavailable'
  | 'missing-workspace';

/** A git failure that carries only its reason, never the command's output. */
export class GitCommandError extends Error {
  constructor(readonly reason: GitFailureReason) {
    super(`git command ${reason}`);
    this.name = 'GitCommandError';
  }
}

export interface GitRunOptions {
  gitPath: string;
  cwd: string;
  args: readonly string[];
  env?: Readonly<Record<string, string>>;
  input?: string;
  timeoutMs?: number;
  maxOutputBytes?: number;
}

export interface GitRunResult {
  stdout: Buffer;
}

export type RunGit = (options: GitRunOptions) => Promise<GitRunResult>;

type ExecError = Error & {
  code?: string | number | null;
  killed?: boolean;
  syscall?: string;
  path?: string;
};

function failureReason(error: ExecError, cwd: string): GitFailureReason {
  // A workspace that is gone fails the spawn exactly as a missing git does, so the directory decides.
  if (error.code === 'ENOENT') {
    return existsSync(cwd) ? 'unavailable' : 'missing-workspace';
  }
  if (error.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') return 'output-too-large';
  if (error.killed === true) return 'timeout';
  return 'failed';
}

/** The process environment without any GIT_* variable, which could point git at another repository. */
function environmentWithoutGitSettings(): NodeJS.ProcessEnv {
  return Object.fromEntries(
    Object.entries(process.env).filter(([name]) => !name.toUpperCase().startsWith('GIT_'))
  );
}

export const runGit: RunGit = ({
  gitPath,
  cwd,
  args,
  env = {},
  input,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  maxOutputBytes = DEFAULT_MAX_OUTPUT_BYTES
}) =>
  new Promise((resolve, reject) => {
    const child = execFile(
      gitPath,
      [...GIT_BASE_ARGS, ...args],
      {
        cwd,
        encoding: 'buffer',
        env: {
          ...environmentWithoutGitSettings(),
          ...env,
          GIT_OPTIONAL_LOCKS: '0',
          GIT_TERMINAL_PROMPT: '0',
          LC_ALL: 'C'
        },
        maxBuffer: maxOutputBytes,
        timeout: timeoutMs,
        windowsHide: true
      },
      (error, stdout) => {
        if (error === null) {
          resolve({ stdout });
          return;
        }
        reject(new GitCommandError(failureReason(error as ExecError, cwd)));
      }
    );
    // A process that exits early (or never starts) closes stdin; the callback reports the real failure.
    child.stdin?.on('error', () => undefined);
    child.stdin?.end(input ?? '');
  });
