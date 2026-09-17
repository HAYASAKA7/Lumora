import { mkdir, readdir, rm } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';

import type { ChangedFileEntry } from '../../shared/changes';
import { isContainedPath, mergeChangedFiles, parseNameStatus, parseNumstat } from './git-output';
import { GitCommandError, type RunGit } from './git-runner';
import {
  createGitClient, removeIndex, removeQuietly, resolveTarget, type GitClient, type Snapshot, type SnapshotTarget
} from './snapshot-targets';

export { DEFAULT_FOLDER_EXCLUDES, SNAPSHOT_TIMEOUT_MS, type Snapshot } from './snapshot-targets';

/** Runs a git command against a compose index; see `composeReviewed`. */
type IndexCommand = (args: readonly string[], input?: string, maxOutputBytes?: number) => Promise<string>;

export const MAX_PATCH_BYTES = 262_144;
/** A full tree listing of a large repository is far bigger than an ordinary command's output. */
const MAX_TREE_LISTING_BYTES = 256 * 1024 * 1024;

export interface FilePatch {
  patch: string;
  truncated: boolean;
}

export interface WorkspaceSnapshotEngineOptions {
  gitPath: string;
  storeRoot: string;
  runGit: RunGit;
}

interface DiffTreeOptions {
  format: readonly string[];
  fromTree: string;
  toTree: string;
  /** Workspace-relative paths; empty means the whole workspace. */
  paths: readonly string[];
  maxOutputBytes?: number;
}

const WORKSPACE_ID = /^[a-z0-9_-]{1,128}$/;
const OBJECT_ID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const TEMP_INDEX = /^(?:index|review)-[0-9a-f-]{36}(?:\.lock)?$/;

function assertObjectId(id: string): void {
  if (!OBJECT_ID.test(id)) throw new Error('Invalid git object id.');
}

function assertContainedPath(path: string): void {
  if (!isContainedPath(path)) throw new Error('Path is outside the workspace.');
}

/** The path of an `ls-tree -z` entry: `mode type id\tpath`. */
function entryPath(entry: string): string {
  return entry.slice(entry.indexOf('\t') + 1);
}

export class WorkspaceSnapshotEngine {
  private readonly queues = new Map<string, Promise<unknown>>();
  private readonly git: GitClient;

  constructor(private readonly options: WorkspaceSnapshotEngineOptions) {
    this.git = createGitClient(options.runGit, options.gitPath);
  }

  /** An absolute path inside the workspace, or null when `path` would leave it. */
  static resolveInside(workspacePath: string, path: string): string | null {
    if (!isContainedPath(path)) return null;
    const base = resolve(workspacePath);
    const target = resolve(base, path);
    const fromBase = relative(base, target);
    const leavesBase = fromBase === '..' || fromBase.startsWith(`..${sep}`) || fromBase.startsWith('../');
    if (fromBase === '' || leavesBase || isAbsolute(fromBase)) return null;
    return target;
  }

  snapshot(workspaceId: string, workspacePath: string): Promise<Snapshot> {
    return this.enqueue(workspaceId, async () => (await this.target(workspaceId, workspacePath)).snapshot());
  }

  changedFiles(workspaceId: string, workspacePath: string, fromTree: string, toTree: string): Promise<ChangedFileEntry[]> {
    return this.enqueue(workspaceId, async () => {
      const target = await this.target(workspaceId, workspacePath);
      const listing = ['--no-ext-diff', '--no-textconv'];
      const names = await this.diffTree(target, { format: [...listing, '--name-status'], fromTree, toTree, paths: [] });
      const counts = await this.diffTree(target, { format: [...listing, '--numstat'], fromTree, toTree, paths: [] });
      return mergeChangedFiles(parseNameStatus(names), parseNumstat(counts));
    });
  }

  fileDiff(
    workspaceId: string, workspacePath: string, fromTree: string, toTree: string, path: string, oldPath?: string | null
  ): Promise<FilePatch> {
    return this.enqueue(workspaceId, async () => {
      const paths = oldPath === undefined || oldPath === null ? [path] : [path, oldPath];
      paths.forEach(assertContainedPath);
      const target = await this.target(workspaceId, workspacePath);
      const format = ['-p', '--no-color', '--no-ext-diff', '--no-textconv'];
      try {
        const output = await this.diffTree(target, {
          format, fromTree, toTree, paths, maxOutputBytes: MAX_PATCH_BYTES
        });
        return { patch: output.toString('utf8'), truncated: false };
      } catch (error) {
        if (error instanceof GitCommandError && error.reason === 'output-too-large') {
          return { patch: '', truncated: true };
        }
        throw error;
      }
    });
  }

  headTree(workspaceId: string, workspacePath: string): Promise<string | null> {
    return this.enqueue(workspaceId, async () => (await this.target(workspaceId, workspacePath)).headTree());
  }

  /**
   * The repository a folder sits in, or null when it is not in one. Read
   * straight from git so a worktree reports the worktree it belongs to.
   */
  repositoryRoot(workspaceId: string, workspacePath: string): Promise<string | null> {
    return this.enqueue(workspaceId, async () => {
      const root = await this.git.tryRun(workspacePath, ['rev-parse', '--show-toplevel'], { env: {} });
      const resolved = root?.trim();
      if (resolved === undefined || resolved.length === 0) return null;
      return resolve(resolved);
    });
  }

  /** A tree equal to fromTree except that `paths` take their entries (or absence) from toTree. */
  composeReviewed(
    workspaceId: string, workspacePath: string, fromTree: string, toTree: string, paths: readonly string[]
  ): Promise<string> {
    return this.enqueue(workspaceId, async () => {
      assertObjectId(fromTree);
      assertObjectId(toTree);
      paths.forEach(assertContainedPath);
      const target = await this.target(workspaceId, workspacePath);
      const indexPath = target.newIndexPath();
      const env = { ...target.env, GIT_INDEX_FILE: indexPath, GIT_LITERAL_PATHSPECS: '1' };
      const run: IndexCommand = (args, input, maxOutputBytes) =>
        this.git.run(target.store, [...target.gitDirArgs, ...args], { env, input, maxOutputBytes });
      try {
        await run(['read-tree', fromTree]);
        const records = await this.reviewRecords(target, run, fromTree, toTree, paths);
        if (records.length > 0) {
          await run(['update-index', '-z', '--index-info'], records.map((record) => `${record}\0`).join(''));
        }
        return (await run(['write-tree'])).trim();
      } finally {
        await removeIndex(indexPath);
      }
    });
  }

  removeWorkspace(workspaceId: string): Promise<void> {
    return this.enqueue(workspaceId, () =>
      rm(this.storePath(workspaceId), { recursive: true, force: true, maxRetries: 3 }));
  }

  /** Index records that give each reviewed path its toTree entry, or remove it when toTree lacks it. */
  private async reviewRecords(
    target: SnapshotTarget, run: IndexCommand, fromTree: string, toTree: string, paths: readonly string[]
  ): Promise<string[]> {
    if (paths.length === 0) return [];
    const wanted = new Set(paths.map((path) => `${target.prefix}${path}`));
    // One listing filtered here, rather than every path on the command line, which has a length limit.
    const scope = target.prefix === '' ? [] : ['--', target.prefix.replace(/\/$/, '')];
    const listArgs = ['ls-tree', '-r', '-z', '--full-tree', toTree, ...scope];
    const listing = await run(listArgs, undefined, MAX_TREE_LISTING_BYTES);
    const entries = listing.split('\0').filter((entry) => entry.length > 0 && wanted.has(entryPath(entry)));
    const present = new Set(entries.map(entryPath));
    const zero = '0'.repeat(fromTree.length);
    const removals = [...wanted].filter((path) => !present.has(path)).map((path) => `0 ${zero}\t${path}`);
    return [...removals, ...entries];
  }

  private async diffTree(target: SnapshotTarget, options: DiffTreeOptions): Promise<Buffer> {
    const { format, fromTree, toTree, paths, maxOutputBytes } = options;
    assertObjectId(fromTree);
    assertObjectId(toTree);
    const relativeArgs = target.prefix === '' ? [] : [`--relative=${target.prefix}`];
    const workspaceScope = target.prefix === '' ? [] : [target.prefix];
    const pathspec = paths.length === 0 ? workspaceScope : paths.map((path) => `${target.prefix}${path}`);
    const args = [
      ...target.gitDirArgs, 'diff-tree', '-r', '-z', '-M', ...format, ...relativeArgs,
      fromTree, toTree, '--', ...pathspec
    ];
    const env = { ...target.env, GIT_LITERAL_PATHSPECS: '1' };
    return this.git.bytes(target.store, args, { env, maxOutputBytes });
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

  private async target(workspaceId: string, workspacePath: string): Promise<SnapshotTarget> {
    const store = this.storePath(workspaceId);
    await mkdir(store, { recursive: true });
    // Temporary indexes a crash left behind; this workspace's work is serialised, so none is in use.
    const names = await readdir(store).catch(() => [] as string[]);
    await Promise.all(names.filter((name) => TEMP_INDEX.test(name)).map((name) => removeQuietly(join(store, name))));
    return resolveTarget({ git: this.git, store, workspacePath });
  }
}
