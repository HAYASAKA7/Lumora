import { describe, expect, it } from 'vitest';

import { createClaudeProcessSpawner } from './claude-process';

describe('Claude process spawner', () => {
  it('reports the process ID until exit and keeps a chatty error stream from stalling it', async () => {
    const reported: Array<number | null> = [];
    const spawnClaude = createClaudeProcessSpawner((processId) => reported.push(processId));
    // More error output than a pipe buffer holds, then a line on stdout.
    const script = "process.stderr.write('x'.repeat(1024 * 1024), () => process.stdout.write('done\\n'))";

    const child = spawnClaude({
      command: process.execPath,
      args: ['-e', script],
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      signal: new AbortController().signal
    });
    let output = '';
    child.stdout?.setEncoding('utf8');
    child.stdout?.on('data', (chunk: string) => {
      output += chunk;
    });
    const code = await new Promise<number | null>((resolve) => child.once('exit', resolve));

    expect(code).toBe(0);
    expect(output).toBe('done\n');
    expect(reported).toEqual([child.pid, null]);
  }, 20_000);

  it('reports no process when the executable cannot start', async () => {
    const reported: Array<number | null> = [];
    const spawnClaude = createClaudeProcessSpawner((processId) => reported.push(processId));

    const child = spawnClaude({
      command: `${process.execPath}-missing`,
      args: [],
      env: {},
      signal: new AbortController().signal
    });
    await new Promise((resolve) => child.once('error', resolve));

    expect(reported.at(-1)).toBeNull();
  });
});
