import { randomUUID } from 'node:crypto';
import { copyFile, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve } from 'node:path';

import type { ChangedFile } from '../../shared/changes';
import { isContainedPath, mergeChangedFiles, parseNameStatus, parseNumstat } from './git-output';
import { GitCommandError, type RunGit } from './git-runner';

export const DEFAULT_FOLDER_EXCLUDES: readonly string[] = [
  'node_modules/', '.venv/', 'venv/', '__pycache__/', 'dist/', 'build/', 'out/', 'target/',
  '.next/', '.nuxt/', '.cache/', 'coverage/', '.gradle/', '.idea/', '*.log'
];
export const SNAPSHOT_TIMEOUT_MS = 120_000;
export const MAX_PATCH_BYTES = 262_144;

export interface Snapshot {
  kind: 'repository' | 'folder';
  tree: string;
  head: string | null;
}

export interface FilePatch {
  patch: string;
  truncated: boolean;
}

export interface WorkspaceSnapshotEngineOptions {
  gitPath: string;
  storeRoot: string;
  runGit: RunGit;
}

type Env = Record<string, string>;

interface RepositoryLayout {
  kind: 'repository';
  commonDir: string;
  indexPath: string;
  /** The workspace folder relative to the repository root, with a trailing slash, or ''. */
  prefix: string;
}

type Layout = RepositoryLayout | { kind: 'folder' };

const WORKSPACE_ID = /^[A-Za-z0-9_-]{1,128}$/;
const OBJECT_ID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const TEMP_INDEX = /^(?:index|review)-[0-9a-f-]{36}(?:\.lock)?$/;

function assertObjectId(id: string): void {
  if (!OBJECT_ID.test(id)) throw new Error('Invalid git object id.');
}

function assertContainedPath(path: string): void {
  if (!isContainedPath(path)) throw new Error('Path is outside the workspace.');
}

async function removeIndex(indexPath: string): Promise<void> {
  await rm(indexPath, { force: true });
  await rm(`${indexPath}.lock`, { force: true });
}

export class WorkspaceSnapshotEngine {
  private readonly queues = new Map<string, Promise<unknown>>();

  constructor(private readonly options: WorkspaceSnapshotEngineOptions) {}

  /** An absolute path inside the workspace, or null when `path` would leave it. */
  static resolveInside(workspacePath: string, path: string): string | null {
    if (!isContainedPath(path)) return null;
    const base = resolve(workspacePath);
    const target = resolve(base, path);
    const inside = relative(base, target);
    if (inside === '' || inside.startsWith('..') || isAbsolute(inside)) return null;
    return target;
  }

  snapshot(workspaceId: string, workspacePath: string): Promise<Snapshot> {
    return this.enqueue(workspaceId, async () => {
      const layout = await this.describe(workspacePath);
      return layout.kind === 'repository'
        ? this.snapshotRepository(workspaceId, workspacePath, layout)
        : this.snapshotFolder(workspaceId, workspacePath);
    });
  }

  changedFiles(workspaceId: string, workspacePath: string, fromTree: string, toTree: string): Promise<ChangedFile[]> {
    return this.enqueue(workspaceId, async () => {
      const layout = await this.describe(workspacePath);
      const listing = (format: string) => this.diffTree(workspaceId, workspacePath, layout, [format], fromTree, toTree, ['.']);
      const [names, counts] = [await listing('--name-status'), await listing('--numstat')];
      return mergeChangedFiles(parseNameStatus(names), parseNumstat(counts));
    });
  }

  fileDiff(workspaceId: string, workspacePath: string, fromTree: string, toTree: string, path: string): Promise<FilePatch> {
    return this.enqueue(workspaceId, async () => {
      assertContainedPath(path);
      const layout = await this.describe(workspacePath);
      try {
        const output = await this.diffTree(workspaceId, workspacePath, layout,
          ['-p', '--no-color', '--no-ext-diff', '--no-textconv'], fromTree, toTree, [`:(literal)${path}`], MAX_PATCH_BYTES);
        return { patch: output.toString('utf8'), truncated: false };
      } catch (error) {
        if (error instanceof GitCommandError && error.reason === 'output-too-large') return { patch: '', truncated: true };
        throw error;
      }
    });
  }

  headTree(workspaceId: string, workspacePath: string): Promise<string | null> {
    return this.enqueue(workspaceId, async () => {
      const layout = await this.describe(workspacePath);
      if (layout.kind === 'folder') return null;
      const env = await this.repositoryEnv(workspaceId, layout);
      const tree = await this.tryGit(workspacePath, ['rev-parse', '--verify', '-q', 'HEAD^{tree}'], env);
      // A repository without commits compares against the empty tree, written into Lumora's store.
      return (tree ?? (await this.git(workspacePath, ['mktree'], env))).trim();
    });
  }

  composeReviewed(workspaceId: string, workspacePath: string, fromTree: string, toTree: string, paths: readonly string[]): Promise<string> {
    return this.enqueue(workspaceId, async () => {
      assertObjectId(fromTree);
      assertObjectId(toTree);
      paths.forEach(assertContainedPath);
      const layout = await this.describe(workspacePath);
      const store = await this.ensureStore(workspaceId);
      const indexPath = join(store, `${layout.kind === 'repository' ? 'index' : 'review'}-${randomUUID()}`);
      const base = layout.kind === 'repository'
        ? { gitDir: layout.commonDir, prefix: layout.prefix, env: await this.repositoryEnv(workspaceId, layout) }
        : { gitDir: await this.ensureFolderRepository(store), prefix: '', env: {} };
      const env: Env = { ...base.env, GIT_INDEX_FILE: indexPath, GIT_LITERAL_PATHSPECS: '1' };
      const run = (args: string[], input?: string) =>
        this.git(store, [`--git-dir=${base.gitDir}`, ...args], env, input);
      try {
        const fullPaths = paths.map((path) => `${base.prefix}${path}`);
        await run(['read-tree', fromTree]);
        const listing = fullPaths.length === 0 ? '' : await run(['ls-tree', '-r', '-z', '--full-tree', toTree, '--', ...fullPaths]);
        const entries = listing.split('\0').filter((entry) => entry.length > 0);
        const present = new Set(entries.map((entry) => entry.slice(entry.indexOf('\t') + 1)));
        const zero = '0'.repeat(fromTree.length);
        const removals = fullPaths.filter((path) => !present.has(path)).map((path) => `0 ${zero}\t${path}`);
        const records = [...removals, ...entries];
        if (records.length > 0) await run(['update-index', '-z', '--index-info'], records.map((record) => `${record}\0`).join(''));
        return (await run(['write-tree'])).trim();
      } finally {
        await removeIndex(indexPath);
      }
    });
  }

  removeWorkspace(workspaceId: string): Promise<void> {
    return this.enqueue(workspaceId, () => rm(this.storePath(workspaceId), { recursive: true, force: true }));
  }

  private enqueue<T>(workspaceId: string, work: () => Promise<T>): Promise<T> {
    if (!WORKSPACE_ID.test(workspaceId)) return Promise.reject(new Error('Invalid workspace id.'));
    const previous = this.queues.get(workspaceId) ?? Promise.resolve();
    const result = previous.then(work);
    const settled = result.then(() => undefined, () => undefined);
    this.queues.set(workspaceId, settled);
    void settled.then(() => {
      if (this.queues.get(workspaceId) === settled) this.queues.delete(workspaceId);
    });
    return result;
  }

  private storePath(workspaceId: string): string {
    return join(this.options.storeRoot, workspaceId);
  }

  /** Creates the store and clears temporary indexes a crash may have left behind. */
  private async ensureStore(workspaceId: string): Promise<string> {
    const store = this.storePath(workspaceId);
    await mkdir(join(store, 'objects'), { recursive: true });
    const stale = (await readdir(store)).filter((name) => TEMP_INDEX.test(name));
    await Promise.all(stale.map((name) => rm(join(store, name), { force: true })));
    return store;
  }

  private async describe(workspacePath: string): Promise<Layout> {
    if (!(await stat(workspacePath)).isDirectory()) throw new Error('Workspace is not a folder.');
    const output = await this.tryGit(workspacePath, [
      '-C', workspacePath, 'rev-parse', '--path-format=absolute', '--git-common-dir', '--git-path', 'index', '--show-prefix'
    ], {});
    if (output === null) return { kind: 'folder' };
    const [commonDir = '', indexPath = '', prefix = ''] = output.split('\n').map((line) => line.replace(/\r$/, ''));
    if (commonDir === '' || indexPath === '') return { kind: 'folder' };
    return { kind: 'repository', commonDir, indexPath, prefix };
  }

  private async repositoryEnv(workspaceId: string, layout: RepositoryLayout): Promise<Env> {
    const store = await this.ensureStore(workspaceId);
    return {
      GIT_OBJECT_DIRECTORY: join(store, 'objects'),
      GIT_ALTERNATE_OBJECT_DIRECTORIES: join(layout.commonDir, 'objects')
    };
  }

  private async snapshotRepository(workspaceId: string, workspacePath: string, layout: RepositoryLayout): Promise<Snapshot> {
    const baseEnv = await this.repositoryEnv(workspaceId, layout);
    const indexPath = join(this.storePath(workspaceId), `index-${randomUUID()}`);
    // Seeding with the real index reuses its stat cache; without one (no commits yet) git starts empty.
    await copyFile(layout.indexPath, indexPath).catch(() => undefined);
    // A copied split index still works, though git may refresh the mtime of the repository's shared index file.
    let tree: string;
    try {
      tree = await this.writeRepositoryTree(workspaceId, workspacePath, { ...baseEnv, GIT_INDEX_FILE: indexPath });
    } catch (error) {
      if (!(error instanceof GitCommandError) || error.reason !== 'failed') throw error;
      // The copied index is unusable; an empty index rebuilds the listing from the files themselves.
      await removeIndex(indexPath);
      const freshIndexPath = join(this.storePath(workspaceId), `index-${randomUUID()}`);
      try {
        tree = await this.writeRepositoryTree(workspaceId, workspacePath, { ...baseEnv, GIT_INDEX_FILE: freshIndexPath });
      } finally {
        await removeIndex(freshIndexPath);
      }
    } finally {
      await removeIndex(indexPath);
    }
    const head = await this.tryGit(workspacePath, ['rev-parse', '--verify', '-q', 'HEAD'], baseEnv);
    return { kind: 'repository', tree, head: head?.trim() || null };
  }

  /**
   * `add` runs clean filters; pointing Git LFS at Lumora's store keeps its objects out of the repository
   * while the index still receives the same pointer blobs a commit would.
   */
  private async writeRepositoryTree(workspaceId: string, workspacePath: string, env: Env): Promise<string> {
    const lfs = ['-c', `lfs.storage=${join(this.storePath(workspaceId), 'lfs')}`];
    await this.git(workspacePath, [...lfs, 'add', '-A', '--', ':/'], env, undefined, SNAPSHOT_TIMEOUT_MS);
    return (await this.git(workspacePath, [...lfs, 'write-tree'], env, undefined, SNAPSHOT_TIMEOUT_MS)).trim();
  }

  private async snapshotFolder(workspaceId: string, workspacePath: string): Promise<Snapshot> {
    const store = await this.ensureStore(workspaceId);
    const gitDir = await this.ensureFolderRepository(store);
    const indexPath = join(store, 'folder.index');
    await rm(`${indexPath}.lock`, { force: true });
    const args = (command: string[]) => [
      `--git-dir=${gitDir}`, `--work-tree=${workspacePath}`, '-c', 'core.autocrlf=false', ...command
    ];
    const env: Env = { GIT_INDEX_FILE: indexPath };
    await this.git(workspacePath, args(['add', '-A']), env, undefined, SNAPSHOT_TIMEOUT_MS);
    const tree = (await this.git(workspacePath, args(['write-tree']), env, undefined, SNAPSHOT_TIMEOUT_MS)).trim();
    return { kind: 'folder', tree, head: null };
  }

  private async ensureFolderRepository(store: string): Promise<string> {
    const gitDir = join(store, 'folder.git');
    const exists = await stat(join(gitDir, 'HEAD')).then(() => true, () => false);
    if (!exists) await this.git(store, ['init', '-q', '--bare', gitDir], {});
    const excludePath = join(gitDir, 'info', 'exclude');
    const excludes = `${DEFAULT_FOLDER_EXCLUDES.join('\n')}\n`;
    const current = await readFile(excludePath, 'utf8').catch(() => null);
    if (current !== excludes) {
      await mkdir(join(gitDir, 'info'), { recursive: true });
      await writeFile(excludePath, excludes, 'utf8');
    }
    return gitDir;
  }

  private async diffTree(
    workspaceId: string, workspacePath: string, layout: Layout, format: string[],
    fromTree: string, toTree: string, pathspec: string[], maxOutputBytes?: number
  ): Promise<Buffer> {
    assertObjectId(fromTree);
    assertObjectId(toTree);
    const repository = layout.kind === 'repository';
    const location = repository ? [] : [`--git-dir=${await this.ensureFolderRepository(await this.ensureStore(workspaceId))}`];
    const relative = repository && layout.prefix !== '' ? [`--relative=${layout.prefix}`] : [];
    const env = repository ? await this.repositoryEnv(workspaceId, layout) : {};
    const args = [...location, 'diff-tree', '-r', '-z', '-M', ...format, ...relative, fromTree, toTree, '--', ...pathspec];
    const { stdout } = await this.options.runGit({
      gitPath: this.options.gitPath, cwd: workspacePath, args, env, ...(maxOutputBytes === undefined ? {} : { maxOutputBytes })
    });
    return stdout;
  }

  private async git(cwd: string, args: string[], env: Env, input?: string, timeoutMs?: number): Promise<string> {
    const { stdout } = await this.options.runGit({
      gitPath: this.options.gitPath, cwd, args, env,
      ...(input === undefined ? {} : { input }),
      ...(timeoutMs === undefined ? {} : { timeoutMs })
    });
    return stdout.toString('utf8');
  }

  /** Runs git and returns null when the command itself fails; a missing git or a timeout still throws. */
  private async tryGit(cwd: string, args: string[], env: Env): Promise<string | null> {
    try {
      return await this.git(cwd, args, env);
    } catch (error) {
      if (error instanceof GitCommandError && error.reason === 'failed') return null;
      throw error;
    }
  }
}
