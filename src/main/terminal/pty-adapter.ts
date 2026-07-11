import { spawn } from 'node-pty';

import type { PtyProcess, PtySpawnOptions } from './runtime-host';

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
  return spawn(options.executablePath, options.args, {
    name: 'xterm-256color',
    cwd: options.cwd,
    env: definedEnvironment(options.env),
    cols: options.cols,
    rows: options.rows,
    encoding: 'utf8',
    handleFlowControl: true
  });
}
