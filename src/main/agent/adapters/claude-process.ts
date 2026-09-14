import { spawn, type ChildProcessByStdio } from 'node:child_process';
import type { Readable, Writable } from 'node:stream';

/** What the Claude Agent SDK passes to a custom process start. */
export interface ClaudeProcessSpawnOptions {
  command: string;
  args: string[];
  cwd?: string;
  env: Record<string, string | undefined>;
  signal: AbortSignal;
}

/**
 * Starts Claude the way the SDK itself does, so Lumora knows the process ID.
 * The SDK reads Claude's error output only from a process it started, so the
 * output is drained here; an unread pipe that fills up would stall Claude.
 */
export function createClaudeProcessSpawner(
  onProcess: (processId: number | null) => void
): (options: ClaudeProcessSpawnOptions) => ChildProcessByStdio<Writable, Readable, Readable> {
  return (options) => {
    const child = spawn(options.command, options.args, {
      ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
      env: options.env,
      signal: options.signal,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true
    });
    child.stderr.resume();
    onProcess(child.pid ?? null);
    const ended = () => onProcess(null);
    child.once('exit', ended);
    child.once('error', ended);
    return child;
  };
}
