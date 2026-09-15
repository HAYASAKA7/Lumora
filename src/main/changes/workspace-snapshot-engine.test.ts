import { execFileSync } from 'node:child_process';
import {
  existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, statSync, utimesSync, writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { GitCommandError, runGit, type RunGit } from './git-runner';
import { DEFAULT_FOLDER_EXCLUDES, WorkspaceSnapshotEngine } from './workspace-snapshot-engine';

let root: string;
let engine: WorkspaceSnapshotEngine;

/** Direct git calls in these tests ignore the machine's global and system configuration. */
function isolatedEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const inherited = Object.entries(process.env).filter(([name]) => !name.toUpperCase().startsWith('GIT_'));
  return {
    ...Object.fromEntries(inherited),
    GIT_CONFIG_GLOBAL: join(root, 'empty.gitconfig'),
    GIT_CONFIG_NOSYSTEM: '1',
    ...extra
  };
}
const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', args, { cwd, encoding: 'utf8', env: isolatedEnv() });
const countFiles = (directory: string): number => readdirSync(directory, { recursive: true })
  .filter((entry) => statSync(join(directory, String(entry))).isFile()).length;
const listEntries = (directory: string): string[] => existsSync(directory)
  ? readdirSync(directory, { recursive: true }).map(String).sort()
  : [];
const changedPaths = async (workspaceId: string, workspace: string, fromTree: string, toTree: string) =>
  (await engine.changedFiles(workspaceId, workspace, fromTree, toTree)).map(({ path }) => path);
const hasGitLfs = (() => {
  try {
    execFileSync('git', ['lfs', 'version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'lumora-snapshots-'));
  writeFileSync(join(root, 'empty.gitconfig'), '');
  engine = new WorkspaceSnapshotEngine({ gitPath: 'git', storeRoot: join(root, 'store'), runGit });
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

function makeRepository(): string {
  const repo = join(root, 'repo');
  mkdirSync(join(repo, 'dir'), { recursive: true });
  git(root, 'init', '-q', repo);
  git(repo, 'config', 'user.email', 'test@example.invalid');
  git(repo, 'config', 'user.name', 'Test');
  writeFileSync(join(repo, 'a.txt'), 'a\n');
  writeFileSync(join(repo, 'b.txt'), 'b\n');
  writeFileSync(join(repo, 'dir', 'c.txt'), 'c\nc\nc\n');
  writeFileSync(join(repo, '.gitignore'), 'ignored/\n');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-qm', 'init');
  return repo;
}

describe('WorkspaceSnapshotEngine — repository', () => {
  it('lists only what changed after the baseline and never writes into the repository', async () => {
    const repo = makeRepository();
    writeFileSync(join(repo, 'a.txt'), 'a\npre\n');
    writeFileSync(join(repo, 'untracked.txt'), 'u\n');
    const indexBefore = readFileSync(join(repo, '.git', 'index'));
    const objectsBefore = countFiles(join(repo, '.git', 'objects'));

    const baseline = await engine.snapshot('w1', repo);
    writeFileSync(join(repo, 'a.txt'), 'a\npre\nagent\n');
    writeFileSync(join(repo, 'b.txt'), 'b\nagent\n');
    renameSync(join(repo, 'dir', 'c.txt'), join(repo, 'moved.txt'));
    writeFileSync(join(repo, 'new.txt'), 'n\n');
    mkdirSync(join(repo, 'ignored'));
    writeFileSync(join(repo, 'ignored', 'x.txt'), 'x\n');
    writeFileSync(join(repo, 'bin.dat'), Buffer.from(Array.from({ length: 256 }, (_, i) => i)));
    const current = await engine.snapshot('w1', repo);

    expect(baseline.kind).toBe('repository');
    const files = await engine.changedFiles('w1', repo, baseline.tree, current.tree);
    expect(files).toEqual([
      { path: 'a.txt', oldPath: null, status: 'modified', additions: 1, deletions: 0, binary: false },
      { path: 'b.txt', oldPath: null, status: 'modified', additions: 1, deletions: 0, binary: false },
      { path: 'bin.dat', oldPath: null, status: 'added', additions: null, deletions: null, binary: true },
      { path: 'moved.txt', oldPath: 'dir/c.txt', status: 'renamed', additions: 0, deletions: 0, binary: false },
      { path: 'new.txt', oldPath: null, status: 'added', additions: 1, deletions: 0, binary: false }
    ]);
    const patch = await engine.fileDiff('w1', repo, baseline.tree, current.tree, 'a.txt');
    expect(patch.patch).toContain('+agent');
    expect(patch.patch).not.toContain('+pre');
    expect(readFileSync(join(repo, '.git', 'index')).equals(indexBefore)).toBe(true);
    expect(countFiles(join(repo, '.git', 'objects'))).toBe(objectsBefore);
    expect(git(repo, 'for-each-ref')).toMatch(/^[0-9a-f]+ commit\trefs\/heads\/\w+\n$/);
    expect(readdirSync(join(root, 'store', 'w1')).filter((name) => name.startsWith('index-'))).toEqual([]);
  });

  it('compares with HEAD for the uncommitted view and knows the HEAD commit', async () => {
    const repo = makeRepository();
    writeFileSync(join(repo, 'untracked.txt'), 'u\n');
    const current = await engine.snapshot('w1', repo);
    expect(current.head).toMatch(/^[0-9a-f]{40,64}$/);
    const head = await engine.headTree('w1', repo);
    expect(await changedPaths('w1', repo, head!, current.tree)).toEqual(['untracked.txt']);
  });

  it('limits a workspace inside a larger repository to its own folder', async () => {
    const repo = makeRepository();
    const workspace = join(repo, 'dir');
    writeFileSync(join(repo, 'outside-untracked.txt'), 'o\n');
    const baseline = await engine.snapshot('w2', workspace);
    writeFileSync(join(repo, 'a.txt'), 'outside\n');
    writeFileSync(join(workspace, 'c.txt'), 'inside\n');
    const current = await engine.snapshot('w2', workspace);
    expect(await changedPaths('w2', workspace, baseline.tree, current.tree)).toEqual(['c.txt']);

    const objects = { GIT_OBJECT_DIRECTORY: join(root, 'store', 'w2', 'objects') };
    const names = execFileSync('git', ['ls-tree', '-r', '--name-only', current.tree], {
      cwd: repo, encoding: 'utf8', env: isolatedEnv(objects)
    });
    expect(names).not.toContain('outside-untracked.txt');
  });

  it('snapshots an ignored folder inside a repository as a plain folder', async () => {
    const repo = makeRepository();
    const workspace = join(repo, 'ignored');
    mkdirSync(workspace);
    writeFileSync(join(workspace, 'notes.txt'), 'one\n');
    const gitEntriesBefore = listEntries(join(repo, '.git'));
    const indexBefore = readFileSync(join(repo, '.git', 'index'));

    const baseline = await engine.snapshot('w6', workspace);
    writeFileSync(join(workspace, 'notes.txt'), 'two\n');
    const current = await engine.snapshot('w6', workspace);

    expect(baseline.kind).toBe('folder');
    expect(await changedPaths('w6', workspace, baseline.tree, current.tree)).toEqual(['notes.txt']);
    expect(listEntries(join(repo, '.git'))).toEqual(gitEntriesBefore);
    expect(readFileSync(join(repo, '.git', 'index')).equals(indexBefore)).toBe(true);
    expect(readdirSync(workspace)).toEqual(['notes.txt']);
  });

  it('composes a tree where only the reviewed files take their current content', async () => {
    const repo = makeRepository();
    const baseline = await engine.snapshot('w1', repo);
    writeFileSync(join(repo, 'a.txt'), 'a2\n');
    writeFileSync(join(repo, 'b.txt'), 'b2\n');
    rmSync(join(repo, 'dir', 'c.txt'));
    const current = await engine.snapshot('w1', repo);
    const reviewed = await engine.composeReviewed('w1', repo, baseline.tree, current.tree, ['a.txt', 'dir/c.txt']);
    expect(await changedPaths('w1', repo, reviewed, current.tree)).toEqual(['b.txt']);
  });

  it('composes reviewed files for a workspace inside a larger repository', async () => {
    const repo = makeRepository();
    const workspace = join(repo, 'dir');
    writeFileSync(join(workspace, 'd.txt'), 'd\n');
    const baseline = await engine.snapshot('w2', workspace);
    writeFileSync(join(workspace, 'c.txt'), 'c2\n');
    rmSync(join(workspace, 'd.txt'));
    writeFileSync(join(workspace, 'e.txt'), 'e\n');
    const current = await engine.snapshot('w2', workspace);
    const reviewed = await engine.composeReviewed('w2', workspace, baseline.tree, current.tree, ['c.txt', 'd.txt']);
    expect(await changedPaths('w2', workspace, reviewed, current.tree)).toEqual(['e.txt']);
  });

  it('composes thousands of reviewed paths without a long command line', async () => {
    const repo = makeRepository();
    const workspace = join(repo, 'many');
    mkdirSync(workspace);
    const names = Array.from({ length: 2_000 }, (_, i) =>
      `file-with-a-reasonably-long-name-${String(i).padStart(4, '0')}.txt`);
    for (const name of names) writeFileSync(join(workspace, name), 'before\n');
    writeFileSync(join(workspace, 'unreviewed.txt'), 'before\n');
    git(repo, 'add', '-A');
    git(repo, 'commit', '-qm', 'many');
    const baseline = await engine.snapshot('w7', workspace);
    for (const name of [...names, 'unreviewed.txt']) writeFileSync(join(workspace, name), 'after\n');
    const current = await engine.snapshot('w7', workspace);

    const reviewed = await engine.composeReviewed('w7', workspace, baseline.tree, current.tree, names);

    expect(await changedPaths('w7', workspace, reviewed, current.tree)).toEqual(['unreviewed.txt']);
  }, 60_000);

  it('leaves the repository files untouched when it uses a split index', async () => {
    const repo = makeRepository();
    git(repo, 'config', 'core.splitIndex', 'true');
    git(repo, 'update-index', '--split-index');
    for (let i = 0; i < 30; i++) writeFileSync(join(repo, `new-${i}.txt`), `${i}\n`);
    const gitEntriesBefore = listEntries(join(repo, '.git'));
    const indexBefore = readFileSync(join(repo, '.git', 'index'));

    const baseline = await engine.snapshot('w1', repo);
    writeFileSync(join(repo, 'a.txt'), 'a2\n');
    const current = await engine.snapshot('w1', repo);
    await engine.composeReviewed('w1', repo, baseline.tree, current.tree, ['a.txt']);

    expect(listEntries(join(repo, '.git'))).toEqual(gitEntriesBefore);
    expect(readFileSync(join(repo, '.git', 'index')).equals(indexBefore)).toBe(true);
  });

  it('diffs a renamed and edited file as a rename', async () => {
    const repo = makeRepository();
    const baseline = await engine.snapshot('w1', repo);
    rmSync(join(repo, 'dir', 'c.txt'));
    writeFileSync(join(repo, 'moved.txt'), 'c\nc\nc\nd\n');
    const current = await engine.snapshot('w1', repo);
    const patch = await engine.fileDiff('w1', repo, baseline.tree, current.tree, 'moved.txt', 'dir/c.txt');
    expect(patch.patch).toContain('rename from dir/c.txt');
    expect(patch.patch).toContain('+d');
  });

  it('treats a repository without commits as starting from the empty tree', async () => {
    const repo = join(root, 'fresh');
    git(root, 'init', '-q', repo);
    writeFileSync(join(repo, 'first.txt'), 'first\n');
    const objectsBefore = countFiles(join(repo, '.git', 'objects'));
    const current = await engine.snapshot('w4', repo);
    expect(current).toMatchObject({ kind: 'repository', head: null });
    const head = await engine.headTree('w4', repo);
    expect(await changedPaths('w4', repo, head!, current.tree)).toEqual(['first.txt']);
    expect(countFiles(join(repo, '.git', 'objects'))).toBe(objectsBefore);
    expect(existsSync(join(repo, '.git', 'index'))).toBe(false);
  });

  it('reports a patch that is too large as truncated', async () => {
    const repo = makeRepository();
    const baseline = await engine.snapshot('w1', repo);
    writeFileSync(join(repo, 'a.txt'), 'line of text\n'.repeat(30_000));
    const current = await engine.snapshot('w1', repo);
    expect(await engine.fileDiff('w1', repo, baseline.tree, current.tree, 'a.txt'))
      .toEqual({ patch: '', truncated: true });
  });

  it('rejects unsafe workspace ids, tree ids, and paths', async () => {
    const repo = makeRepository();
    const { tree } = await engine.snapshot('w1', repo);
    await expect(engine.snapshot('../w1', repo)).rejects.toThrow();
    await expect(engine.snapshot('W1', repo)).rejects.toThrow();
    await expect(engine.changedFiles('w1', repo, '--output=x', tree)).rejects.toThrow();
    await expect(engine.fileDiff('w1', repo, tree, tree, '../outside.txt')).rejects.toThrow();
    await expect(engine.fileDiff('w1', repo, tree, tree, 'a.txt', '../outside.txt')).rejects.toThrow();
    expect(WorkspaceSnapshotEngine.resolveInside(repo, 'dir/c.txt')).toBe(join(repo, 'dir', 'c.txt'));
    expect(WorkspaceSnapshotEngine.resolveInside(repo, '..env')).toBe(join(repo, '..env'));
    expect(WorkspaceSnapshotEngine.resolveInside(repo, '../outside.txt')).toBeNull();
  });

  it('snapshots even when a leftover temporary index cannot be removed', async () => {
    const repo = makeRepository();
    const leftover = join(root, 'store', 'w1', 'index-00000000-0000-0000-0000-000000000000');
    mkdirSync(leftover, { recursive: true });
    writeFileSync(join(leftover, 'keep.txt'), 'x\n');
    await expect(engine.snapshot('w1', repo)).resolves.toMatchObject({ kind: 'repository' });
  });

  it.skipIf(!hasGitLfs)('keeps Git LFS objects out of the repository and matches the committed pointers', async () => {
    const repo = join(root, 'lfs');
    git(root, 'init', '-q', repo);
    git(repo, 'config', 'user.email', 'test@example.invalid');
    git(repo, 'config', 'user.name', 'Test');
    git(repo, 'lfs', 'install', '--local');
    git(repo, 'lfs', 'track', '*.bin');
    writeFileSync(join(repo, 'kept.bin'), Buffer.from(Array.from({ length: 2048 }, (_, i) => i % 256)));
    git(repo, 'add', '-A');
    git(repo, 'commit', '-qm', 'init');
    writeFileSync(join(repo, 'new.bin'), Buffer.from(Array.from({ length: 3000 }, (_, i) => (i * 7) % 256)));
    const lfsBefore = listEntries(join(repo, '.git', 'lfs'));

    const current = await engine.snapshot('w5', repo);
    const head = await engine.headTree('w5', repo);

    expect(listEntries(join(repo, '.git', 'lfs'))).toEqual(lfsBefore);
    expect(await changedPaths('w5', repo, head!, current.tree)).toEqual(['new.bin']);
  }, 60_000);

  it('retries with a fresh index when git cannot use the copied one', async () => {
    const repo = makeRepository();
    writeFileSync(join(repo, 'a.txt'), 'changed\n');
    const addIndexes: string[] = [];
    const flakyRunGit: RunGit = async (options) => {
      if (options.args.includes('add')) {
        addIndexes.push(options.env?.GIT_INDEX_FILE ?? '');
        if (addIndexes.length === 1) {
          expect(existsSync(options.env!.GIT_INDEX_FILE!)).toBe(true);
          throw new GitCommandError('failed');
        }
        expect(existsSync(options.env!.GIT_INDEX_FILE!)).toBe(false);
      }
      return runGit(options);
    };
    const storeRoot = join(root, 'flaky-store');
    const flaky = new WorkspaceSnapshotEngine({ gitPath: 'git', storeRoot, runGit: flakyRunGit });

    const snapshot = await flaky.snapshot('w1', repo);

    expect(addIndexes).toHaveLength(2);
    expect(addIndexes[1]).not.toBe(addIndexes[0]);
    expect(snapshot.tree).toBe((await engine.snapshot('w1', repo)).tree);
    expect(readdirSync(join(storeRoot, 'w1')).filter((name) => name.startsWith('index-'))).toEqual([]);
  });
});

describe('WorkspaceSnapshotEngine — folder', () => {
  it('uses a shadow repository, skips default excludes and .gitignore, and writes nothing into the folder', async () => {
    const folder = join(root, 'plain');
    mkdirSync(join(folder, 'node_modules'), { recursive: true });
    writeFileSync(join(folder, 'main.js'), 'one\n');
    writeFileSync(join(folder, '.gitignore'), 'logs/\n');
    const baseline = await engine.snapshot('w3', folder);
    writeFileSync(join(folder, 'main.js'), 'two\n');
    writeFileSync(join(folder, 'node_modules', 'dep.js'), 'x\n');
    mkdirSync(join(folder, 'logs'));
    writeFileSync(join(folder, 'logs', 'run.log'), 'x\n');
    const current = await engine.snapshot('w3', folder);

    expect(baseline.kind).toBe('folder');
    expect(baseline.head).toBeNull();
    expect(await changedPaths('w3', folder, baseline.tree, current.tree)).toEqual(['main.js']);
    expect(readdirSync(folder).sort()).toEqual(['.gitignore', 'logs', 'main.js', 'node_modules']);
    expect(existsSync(join(folder, '.git'))).toBe(false);
    expect(await engine.headTree('w3', folder)).toBeNull();
    expect(existsSync(join(root, 'store', 'w3', 'objects'))).toBe(false);
  });

  it('composes reviewed files without disturbing the folder index', async () => {
    const folder = join(root, 'plain');
    mkdirSync(folder);
    writeFileSync(join(folder, 'x.txt'), 'x\n');
    writeFileSync(join(folder, 'y.txt'), 'y\n');
    const baseline = await engine.snapshot('w3', folder);
    writeFileSync(join(folder, 'x.txt'), 'x2\n');
    writeFileSync(join(folder, 'y.txt'), 'y2\n');
    const current = await engine.snapshot('w3', folder);
    const indexBefore = readFileSync(join(root, 'store', 'w3', 'folder.index'));
    const reviewed = await engine.composeReviewed('w3', folder, baseline.tree, current.tree, ['x.txt']);
    expect(await changedPaths('w3', folder, reviewed, current.tree)).toEqual(['y.txt']);
    expect(readFileSync(join(root, 'store', 'w3', 'folder.index')).equals(indexBefore)).toBe(true);
  });

  it('rewrites the shadow repository excludes only when they differ', async () => {
    const folder = join(root, 'plain');
    mkdirSync(folder);
    writeFileSync(join(folder, 'x.txt'), 'x\n');
    const baseline = await engine.snapshot('w3', folder);
    const exclude = join(root, 'store', 'w3', 'folder.git', 'info', 'exclude');
    const past = new Date('2020-01-01T00:00:00Z');
    utimesSync(exclude, past, past);

    const current = await engine.snapshot('w3', folder);
    await engine.changedFiles('w3', folder, baseline.tree, current.tree);
    expect(statSync(exclude).mtimeMs).toBe(past.getTime());

    writeFileSync(exclude, 'stale\n');
    await engine.snapshot('w3', folder);
    expect(readFileSync(exclude, 'utf8')).toBe(`${DEFAULT_FOLDER_EXCLUDES.join('\n')}\n`);
  });

  it('removes a workspace store', async () => {
    const folder = join(root, 'plain');
    mkdirSync(folder);
    writeFileSync(join(folder, 'x.txt'), 'x\n');
    await engine.snapshot('w3', folder);
    await engine.removeWorkspace('w3');
    expect(existsSync(join(root, 'store', 'w3'))).toBe(false);
  });
});
