import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { runGit } from './git-runner';

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'lumora-git-cwd-'));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe('runGit failures that look alike', () => {
  it('tells a workspace that is gone apart from a git that is not installed', async () => {
    // Both spawns fail with ENOENT, so only the directory says which is missing.
    await expect(runGit({ gitPath: 'git', cwd: join(root, 'gone'), args: ['--version'] }))
      .rejects.toMatchObject({ reason: 'missing-workspace' });
    await expect(runGit({ gitPath: join(root, 'no-git.exe'), cwd: root, args: ['--version'] }))
      .rejects.toMatchObject({ reason: 'unavailable' });
  });
});
