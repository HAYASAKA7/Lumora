import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { GIT_BASE_ARGS, GitCommandError, runGit } from './git-runner';

const gitPath = 'git';
let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'lumora-git-runner-'));
  execFileSync(gitPath, ['init', '-q', root]);
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe('runGit', () => {
  it('runs git without a shell, with fixed safety flags, and returns stdout as bytes', async () => {
    writeFileSync(join(root, 'a.txt'), 'a\n');
    const { stdout } = await runGit({ gitPath, cwd: root, args: ['status', '--porcelain', '-z'] });
    expect(stdout.toString('utf8')).toBe('?? a.txt\0');
    expect(GIT_BASE_ARGS).toEqual([
      '-c', 'core.quotepath=false',
      '-c', 'core.safecrlf=false',
      '-c', 'core.fsmonitor=false',
      '-c', 'gc.auto=0'
    ]);
  });

  it('reports a failed command without exposing its output', async () => {
    const failure = runGit({ gitPath, cwd: root, args: ['rev-parse', 'no-such-ref'] });
    await expect(failure).rejects.toBeInstanceOf(GitCommandError);
    await expect(failure).rejects.toMatchObject({ reason: 'failed' });
  });

  it('stops output that grows past its cap', async () => {
    await expect(runGit({
      gitPath, cwd: root, args: ['hash-object', '--stdin'], input: 'y'.repeat(10), maxOutputBytes: 4
    })).rejects.toMatchObject({ reason: 'output-too-large' });
  });

  it('reports a missing git executable as unavailable', async () => {
    await expect(runGit({ gitPath: join(root, 'no-git.exe'), cwd: root, args: ['--version'] }))
      .rejects.toMatchObject({ reason: 'unavailable' });
  });
});
