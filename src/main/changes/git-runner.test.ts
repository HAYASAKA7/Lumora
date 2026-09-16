import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { GIT_BASE_ARGS, GitCommandError, runGit } from './git-runner';

const gitPath = 'git';
let base: string;
let root: string;

/** Keeps these runs off the machine's own global and system git configuration. */
function isolation(extra: Record<string, string> = {}): Record<string, string> {
  return { GIT_CONFIG_GLOBAL: join(base, 'empty.gitconfig'), GIT_CONFIG_NOSYSTEM: '1', ...extra };
}

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), 'lumora-git-runner-'));
  root = join(base, 'repo');
  writeFileSync(join(base, 'empty.gitconfig'), '');
  const inherited = Object.entries(process.env).filter(([name]) => !name.toUpperCase().startsWith('GIT_'));
  execFileSync(gitPath, ['init', '-q', root], { env: { ...Object.fromEntries(inherited), ...isolation() } });
});
afterEach(() => rmSync(base, { recursive: true, force: true }));

describe('runGit', () => {
  it('runs git without a shell, with fixed safety flags, and returns stdout as bytes', async () => {
    writeFileSync(join(root, 'a.txt'), 'a\n');
    const { stdout } = await runGit({ gitPath, cwd: root, args: ['status', '--porcelain', '-z'], env: isolation() });
    expect(stdout.toString('utf8')).toBe('?? a.txt\0');
    expect(GIT_BASE_ARGS).toEqual([
      '-c', 'core.quotepath=false',
      '-c', 'core.safecrlf=false',
      '-c', 'core.fsmonitor=false',
      '-c', 'gc.auto=0',
      '-c', 'maintenance.auto=false'
    ]);
  });

  it('reports a failed command without exposing its output', async () => {
    const failure = runGit({ gitPath, cwd: root, args: ['rev-parse', 'no-such-ref'], env: isolation() });
    await expect(failure).rejects.toBeInstanceOf(GitCommandError);
    await expect(failure).rejects.toMatchObject({ reason: 'failed' });
  });

  it('stops output that grows past its cap', async () => {
    await expect(runGit({
      gitPath, cwd: root, args: ['hash-object', '--stdin'], input: 'y'.repeat(10), maxOutputBytes: 4, env: isolation()
    })).rejects.toMatchObject({ reason: 'output-too-large' });
  });

  it('ignores git settings inherited from its own environment', async () => {
    const inherited = { GIT_DIR: process.env.GIT_DIR, git_index_file: process.env.git_index_file };
    process.env.GIT_DIR = join(root, 'bogus.git');
    process.env.git_index_file = join(root, 'bogus-index');
    try {
      writeFileSync(join(root, 'a.txt'), 'a\n');
      const { stdout } = await runGit({ gitPath, cwd: root, args: ['status', '--porcelain', '-z'], env: isolation() });
      expect(stdout.toString('utf8')).toBe('?? a.txt\0');
      const { stdout: dir } = await runGit({
        gitPath, cwd: root, args: ['rev-parse', '--git-dir'], env: isolation({ GIT_DIR: join(root, '.git') })
      });
      expect(dir.toString('utf8').trim()).toBe(join(root, '.git'));
    } finally {
      for (const [name, value] of Object.entries(inherited)) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
    }
  });

  it('reports a missing git executable as unavailable', async () => {
    await expect(runGit({ gitPath: join(root, 'no-git.exe'), cwd: root, args: ['--version'] }))
      .rejects.toMatchObject({ reason: 'unavailable' });
  });
});
