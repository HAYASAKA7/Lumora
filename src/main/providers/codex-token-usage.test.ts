import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { inspectCodexLifetimeUsage } from './codex-token-usage';

const temporaryDirectories: string[] = [];

async function temporaryFile(lines: readonly string[]): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'lumora-codex-usage-'));
  temporaryDirectories.push(directory);
  const path = join(directory, 'rollout.jsonl');
  await writeFile(path, `${lines.join('\n')}\n`, 'utf8');
  return path;
}

function usageLine(
  totalTokens: unknown,
  usage: {
    inputTokens?: unknown;
    cachedInputTokens?: unknown;
    outputTokens?: unknown;
  } = {}
): string {
  return JSON.stringify({
    timestamp: '2026-07-22T01:00:00.000Z',
    type: 'event_msg',
    payload: {
      type: 'token_count',
      info: {
        total_token_usage: {
          input_tokens: usage.inputTokens ?? totalTokens,
          cached_input_tokens: usage.cachedInputTokens ?? 0,
          output_tokens: usage.outputTokens ?? 0,
          total_tokens: totalTokens
        }
      }
    }
  });
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true })
    )
  );
});

describe('inspectCodexLifetimeUsage', () => {
  it('matches the Codex used-token metric by excluding cached input', async () => {
    const path = await temporaryFile([
      usageLine(754_000_000, {
        inputTokens: 748_700_000,
        cachedInputTokens: 728_700_000,
        outputTokens: 5_300_000
      })
    ]);

    await expect(inspectCodexLifetimeUsage({ sourcePath: path })).resolves.toMatchObject({
      lifetimeTokens: 25_300_000
    });
  });

  it('returns the newest valid cumulative token total', async () => {
    const path = await temporaryFile([
      usageLine(100),
      JSON.stringify({ type: 'event_msg', payload: { type: 'other' } }),
      usageLine(250)
    ]);

    await expect(inspectCodexLifetimeUsage({ sourcePath: path })).resolves.toMatchObject({
      lifetimeTokens: 250,
      fingerprint: { size: expect.any(Number), modifiedAtMs: expect.any(Number) }
    });
  });

  it('ignores malformed and unsafe token records', async () => {
    const path = await temporaryFile([
      usageLine(42),
      '{malformed',
      usageLine(-1),
      usageLine(1.5),
      usageLine(Number.MAX_SAFE_INTEGER + 1)
    ]);

    await expect(inspectCodexLifetimeUsage({ sourcePath: path })).resolves.toMatchObject({
      lifetimeTokens: 42
    });
  });

  it('does not search before the configured bounded tail', async () => {
    const path = await temporaryFile([
      usageLine(900),
      JSON.stringify({ padding: 'x'.repeat(2_000) })
    ]);

    await expect(
      inspectCodexLifetimeUsage({ sourcePath: path, maxBytes: 512 })
    ).resolves.toMatchObject({ lifetimeTokens: null });
  });

  it('discards usage when the rollout changes during the read', async () => {
    const path = await temporaryFile([usageLine(100)]);
    const actualStat = await import('node:fs/promises').then(({ stat }) => stat);
    let calls = 0;
    const statFile = vi.fn(async (sourcePath: string) => {
      const value = await actualStat(sourcePath);
      calls += 1;
      return {
        size: value.size,
        mtimeMs: value.mtimeMs + (calls > 1 ? 1 : 0),
        isFile: () => value.isFile()
      };
    });

    await expect(
      inspectCodexLifetimeUsage({ sourcePath: path, statFile })
    ).resolves.toBeNull();
    expect(statFile).toHaveBeenCalledTimes(2);
  });
});
