import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { spawnStructuredLineTransport } from './process-invocation';

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitFor<T>(
  read: () => T | null,
  timeoutMs: number
): Promise<T | null> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = read();
    if (value !== null) return value;
    if (Date.now() > deadline) return null;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

/**
 * Every provider npm installs on Windows is a `.cmd` shim, so what Lumora
 * spawns is a command processor that spawns the agent in turn. Signalling only
 * the process Lumora started takes down the shim and leaves the agent running
 * — a probe that fails then leaves an agent behind that outlives the app.
 */
describe.skipIf(process.platform !== 'win32')('spawned provider cleanup', () => {
  it('takes the agent down with the shim it was started behind', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'lumora-leak-'));
    const pidFile = join(directory, 'agent.pid');
    const shim = join(directory, 'agent.cmd');
    writeFileSync(
      shim,
      '@echo off\r\n'
      + 'node -e "require(\'fs\').writeFileSync(process.env.LUMORA_TEST_PID_FILE,'
      + ' String(process.pid)); setInterval(() => {}, 1000);"\r\n',
      'utf8'
    );

    const transport = spawnStructuredLineTransport(shim, [], {
      platform: 'win32',
      env: { ...process.env, LUMORA_TEST_PID_FILE: pidFile },
      closeGraceMs: 100
    });

    const agentPid = await waitFor(() => {
      try {
        const text = readFileSync(pidFile, 'utf8').trim();
        return text.length === 0 ? null : Number.parseInt(text, 10);
      } catch {
        return null;
      }
    }, 10_000);

    try {
      expect(agentPid, 'the shim never started an agent to clean up').not.toBeNull();
      expect(alive(agentPid!)).toBe(true);

      await transport.close();

      const stopped = await waitFor(
        () => (alive(agentPid!) ? null : true),
        5_000
      );
      expect(stopped, `agent ${agentPid} outlived the transport`).toBe(true);
    } finally {
      if (agentPid !== null && alive(agentPid)) {
        try { process.kill(agentPid); } catch { /* already gone */ }
      }
      rmSync(directory, { force: true, recursive: true });
    }
  });
});
