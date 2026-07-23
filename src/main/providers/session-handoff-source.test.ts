import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  createFileHandoffSnapshotter,
  createOpenCodeHandoffSnapshotter
} from './session-handoff-source';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, {
    recursive: true,
    force: true
  })));
});

async function directory(name: string): Promise<string> {
  const value = await mkdtemp(join(tmpdir(), `lumora-${name}-`));
  roots.push(value);
  return value;
}

describe('session handoff source snapshots', () => {
  it('copies a file-backed provider source before returning its content', async () => {
    const sourceRoot = await directory('source');
    const destination = await directory('destination');
    const sourcePath = join(sourceRoot, 'session.jsonl');
    await writeFile(sourcePath, '{"type":"message"}\n', 'utf8');
    const snapshot = createFileHandoffSnapshotter('claude');

    const result = await snapshot({
      nativeSessionId: 'native-1',
      sourceKeys: [sourcePath],
      installation: {
        provider: 'claude', displayName: 'Claude Code', state: 'ready',
        executablePath: '/tools/claude', version: '2.0.0', issue: null
      },
      sourceDirectory: destination
    });

    expect(result.raw).toBe('{"type":"message"}\n');
    expect(result.sourceFiles).toHaveLength(1);
    expect(result.sourceFiles[0]).not.toBe(sourcePath);
    await expect(readFile(result.sourceFiles[0]!, 'utf8')).resolves.toBe(result.raw);
  });

  it('exports OpenCode JSON with an argv-only bounded command', async () => {
    const destination = await directory('opencode');
    const runCommand = vi.fn(async () => ({
      stdout: JSON.stringify({ messages: [] }),
      stderr: '',
      exitCode: 0
    }));
    const snapshot = createOpenCodeHandoffSnapshotter({
      env: { PATH: '/tools' },
      platform: 'linux',
      runCommand
    });

    const result = await snapshot({
      nativeSessionId: 'ses_01JABC',
      sourceKeys: ['opencode:ses_01JABC'],
      installation: {
        provider: 'opencode', displayName: 'OpenCode', state: 'ready',
        executablePath: '/tools/opencode', version: '1.2.3', issue: null
      },
      sourceDirectory: destination
    });

    expect(runCommand).toHaveBeenCalledWith(expect.objectContaining({
      file: '/tools/opencode',
      args: ['export', 'ses_01JABC'],
      shell: false,
      windowsHide: true
    }));
    expect(result.raw).toBe(JSON.stringify({ messages: [] }));
    await expect(readFile(result.sourceFiles[0]!, 'utf8')).resolves.toBe(result.raw);
  });

  it('refuses ambiguous file sources and failed OpenCode exports', async () => {
    const destination = await directory('invalid');
    const fileSnapshot = createFileHandoffSnapshotter('codex');
    await expect(fileSnapshot({
      nativeSessionId: 'native-1',
      sourceKeys: ['one', 'two'],
      installation: {
        provider: 'codex', displayName: 'Codex', state: 'ready',
        executablePath: '/tools/codex', version: '1.0.0', issue: null
      },
      sourceDirectory: destination
    })).rejects.toThrow('exactly one current source');

    const openCodeSnapshot = createOpenCodeHandoffSnapshotter({
      env: {},
      platform: 'linux',
      runCommand: async () => ({ stdout: '', stderr: 'failed', exitCode: 1 })
    });
    await expect(openCodeSnapshot({
      nativeSessionId: 'ses_01JABC',
      sourceKeys: ['opencode:ses_01JABC'],
      installation: {
        provider: 'opencode', displayName: 'OpenCode', state: 'ready',
        executablePath: '/tools/opencode', version: '1.2.3', issue: null
      },
      sourceDirectory: destination
    })).rejects.toThrow('export command failed');
  });
});
