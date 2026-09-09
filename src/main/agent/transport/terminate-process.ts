import { execFile } from 'node:child_process';

import type { SystemInfo } from '../../../shared/contracts';

export interface TerminableProcess {
  pid?: number | undefined;
  kill(): boolean;
}

type RunTreeKill = (
  file: string,
  args: readonly string[],
  onFailure: () => void
) => void;

/** Fire and forget: the main process must not block while a tree is killed. */
const runTreeKill: RunTreeKill = (file, args, onFailure) => {
  execFile(file, [...args], (error) => {
    if (error !== null) onFailure();
  });
};

interface ProcessTerminatorOptions {
  platform: SystemInfo['platform'];
  run?: RunTreeKill;
}

/**
 * Ends a spawned provider, and everything it started.
 *
 * On Windows a provider installed by npm is a `.cmd` shim, so what Lumora
 * spawns is a command processor that in turn spawns the agent. Signalling only
 * what we spawned takes down the shim and leaves the agent running: a probe
 * that fails then leaks a process that outlives the app.
 */
export function createProcessTerminator({
  platform,
  run = runTreeKill
}: ProcessTerminatorOptions): (target: TerminableProcess) => void {
  return (target) => {
    if (platform !== 'win32' || target.pid === undefined) {
      target.kill();
      return;
    }
    run('taskkill', ['/pid', String(target.pid), '/t', '/f'], () => {
      // Without the tree kill the direct signal is still better than nothing.
      target.kill();
    });
  };
}
