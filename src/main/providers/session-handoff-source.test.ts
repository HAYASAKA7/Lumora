import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  createFileHandoffSnapshotter,
  createKimiHandoffSnapshotter,
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
  const value = await realpath(await mkdtemp(join(tmpdir(), `lumora-${name}-`)));
  roots.push(value);
  return value;
}

describe('session handoff source snapshots', () => {
  it('copies only Kimi main-agent wire data from a state-backed catalog source', async () => {
    const sourceRoot = await directory('kimi-source');
    const destination = await directory('kimi-destination');
    const sessionDir = join(sourceRoot, 'sessions', 'wd_lumora', 'session_1');
    await mkdir(join(sessionDir, 'agents', 'main'), { recursive: true });
    const statePath = join(sessionDir, 'state.json');
    const wirePath = join(sessionDir, 'agents', 'main', 'wire.jsonl');
    await writeFile(statePath, '{"title":"Kimi"}', 'utf8');
    await writeFile(wirePath, '{"type":"turn.prompt","content":"Hello"}\n', 'utf8');

    const result = await createKimiHandoffSnapshotter()({
      nativeSessionId: 'session_1',
      sourceKeys: [statePath],
      installation: {
        provider: 'kimi', displayName: 'Kimi Code', state: 'ready',
        executablePath: '/tools/kimi', version: '0.30.0', issue: null
      },
      sourceDirectory: destination
    });

    expect(result.raw).toContain('turn.prompt');
    expect(result.sourceFiles).toHaveLength(1);
    expect(result.sourceFiles[0]).not.toBe(wirePath);
  });

  it('rejects a Kimi wire source redirected through a symbolic link', async () => {
    const sourceRoot = await directory('kimi-link-source');
    const outside = await directory('kimi-link-outside');
    const destination = await directory('kimi-link-destination');
    const sessionDir = join(sourceRoot, 'sessions', 'wd_lumora', 'session_1');
    await mkdir(join(sessionDir, 'agents', 'main'), { recursive: true });
    const statePath = join(sessionDir, 'state.json');
    const outsideWire = join(outside, 'wire.jsonl');
    await writeFile(statePath, '{"title":"Kimi"}', 'utf8');
    await writeFile(outsideWire, '{"type":"turn.prompt"}\n', 'utf8');
    try {
      await symlink(outsideWire, join(sessionDir, 'agents', 'main', 'wire.jsonl'));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EPERM') return;
      throw error;
    }

    await expect(createKimiHandoffSnapshotter()({
      nativeSessionId: 'session_1',
      sourceKeys: [statePath],
      installation: {
        provider: 'kimi', displayName: 'Kimi Code', state: 'ready',
        executablePath: '/tools/kimi', version: '0.30.0', issue: null
      },
      sourceDirectory: destination
    })).rejects.toThrow('unavailable');
  });
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
