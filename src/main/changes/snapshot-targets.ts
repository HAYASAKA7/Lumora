import { randomUUID } from 'node:crypto';
import { copyFile, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { GitCommandError, type RunGit } from './git-runner';

export const DEFAULT_FOLDER_EXCLUDES: readonly string[] = [
  'node_modules/', '.venv/', 'venv/', '__pycache__/', 'dist/', 'build/', 'out/', 'target/',
  '.next/', '.nuxt/', '.cache/', 'coverage/', '.gradle/', '.idea/', '*.log'
];
export const SNAPSHOT_TIMEOUT_MS = 120_000;

export type Env = Readonly<Record<string, string>>;

export interface Snapshot {
  kind: 'repository' | 'folder';
  tree: string;
  head: string | null;
}

export interface GitCallOptions {
  env?: Env;
  input?: string | undefined;
  timeoutMs?: number;
  maxOutputBytes?: number | undefined;
}

export interface GitClient {
  bytes(cwd: string, args: readonly string[], options?: GitCallOptions): Promise<Buffer>;
  run(cwd: string, args: readonly string[], options?: GitCallOptions): Promise<string>;
  /** Null when git itself reports failure; a missing git or a timeout still throws. */
  tryRun(cwd: string, args: readonly string[], options?: GitCallOptions): Promise<string | null>;
}

export function createGitClient(runGit: RunGit, gitPath: string): GitClient {
  const bytes = async (cwd: string, args: readonly string[], options: GitCallOptions = {}) => {
    const { env, input, timeoutMs, maxOutputBytes } = options;
    const { stdout } = await runGit({
      gitPath, cwd, args,
      ...(env === undefined ? {} : { env }),
      ...(input === undefined ? {} : { input }),
      ...(timeoutMs === undefined ? {} : { timeoutMs }),
      ...(maxOutputBytes === undefined ? {} : { maxOutputBytes })
    });
    return stdout;
  };
  const run = async (cwd: string, args: readonly string[], options: GitCallOptions = {}) =>
    (await bytes(cwd, args, options)).toString('utf8');
  const tryRun = async (cwd: string, args: readonly string[], options: GitCallOptions = {}) => {
    try {
      return await run(cwd, args, options);
    } catch (error) {
      if (error instanceof GitCommandError && error.reason === 'failed') return null;
      throw error;
    }
  };
  return { bytes, run, tryRun };
}

/** Temporary files are removed on a best-effort basis so cleanup never hides the error that matters. */
export async function removeQuietly(path: string): Promise<void> {
  await rm(path, { force: true, maxRetries: 3 }).catch(() => undefined);
}

export async function removeIndex(indexPath: string): Promise<void> {
  await Promise.all([removeQuietly(indexPath), removeQuietly(`${indexPath}.lock`)]);
}

/** How one workspace is snapshotted: through its own repository's objects, or a shadow repository. */
export interface SnapshotTarget {
  readonly kind: Snapshot['kind'];
  /** The workspace folder inside snapshot trees: '' or a path ending in '/'. */
  readonly prefix: string;
  /** Lumora's store folder, the working directory for commands that need no work tree. */
  readonly store: string;
  /** Global arguments that select the object database (and its settings) for those commands. */
  readonly gitDirArgs: readonly string[];
  readonly env: Env;
  /** A path for a short-lived index that never disturbs the index a snapshot keeps. */
  newIndexPath(): string;
  snapshot(): Promise<Snapshot>;
  headTree(): Promise<string | null>;
}

interface TargetContext {
  git: GitClient;
  store: string;
  workspacePath: string;
}

interface RepositoryLayout {
  commonDir: string;
  indexPath: string;
  prefix: string;
}

/** Never let git write a split index: that would add shared index files to the repository's own folder. */
const NO_SPLIT_INDEX = ['-c', 'core.splitIndex=false'];

export async function resolveTarget(context: TargetContext): Promise<SnapshotTarget> {
  const { git, workspacePath } = context;
  if (!(await stat(workspacePath)).isDirectory()) throw new Error('Workspace is not a folder.');
  const output = await git.tryRun(workspacePath, [
    '-C', workspacePath, 'rev-parse', '--path-format=absolute',
    '--git-common-dir', '--git-path', 'index', '--show-prefix'
  ]);
  const lines = (output ?? '').split('\n').map((line) => line.replace(/\r$/, ''));
  const [commonDir = '', indexPath = '', prefix = ''] = lines;
  if (commonDir === '' || indexPath === '') return folderTarget(context);
  // A folder the repository ignores has nothing tracked to compare with, so it is snapshotted on its own.
  if (prefix !== '' && (await git.tryRun(workspacePath, ['check-ignore', '-q', '.'])) !== null) {
    return folderTarget(context);
  }
  return repositoryTarget(context, { commonDir, indexPath, prefix });
}

async function repositoryTarget(context: TargetContext, layout: RepositoryLayout): Promise<SnapshotTarget> {
  const { git, store, workspacePath } = context;
  const objects = join(store, 'objects');
  await mkdir(objects, { recursive: true });
  const env: Env = {
    GIT_OBJECT_DIRECTORY: objects,
    GIT_ALTERNATE_OBJECT_DIRECTORIES: join(layout.commonDir, 'objects')
  };
  const newIndexPath = () => join(store, `index-${randomUUID()}`);
  // `add` runs clean filters; Git LFS then stores objects in Lumora's store yet yields the pointers a commit would.
  const settings = [...NO_SPLIT_INDEX, '-c', `lfs.storage=${join(store, 'lfs')}`];
  const writeTree = async (indexPath: string): Promise<string> => {
    const options = { env: { ...env, GIT_INDEX_FILE: indexPath }, timeoutMs: SNAPSHOT_TIMEOUT_MS };
    await git.run(workspacePath, [...settings, 'add', '-A', '--', '.'], options);
    return (await git.run(workspacePath, [...settings, 'write-tree'], options)).trim();
  };

  return {
    kind: 'repository',
    prefix: layout.prefix,
    store,
    gitDirArgs: [`--git-dir=${layout.commonDir}`, ...NO_SPLIT_INDEX],
    env,
    newIndexPath,
    async snapshot() {
      const tree = await writeTreeFromCopiedIndex(layout.indexPath, newIndexPath, writeTree);
      const head = await git.tryRun(workspacePath, ['rev-parse', '--verify', '-q', 'HEAD'], { env });
      return { kind: 'repository', tree, head: head?.trim() || null };
    },
    async headTree() {
      const tree = await git.tryRun(workspacePath, ['rev-parse', '--verify', '-q', 'HEAD^{tree}'], { env });
      // A repository without commits compares against the empty tree, written into Lumora's store.
      return (tree ?? (await git.run(workspacePath, ['mktree'], { env }))).trim();
    }
  };
}

async function writeTreeFromCopiedIndex(
  repositoryIndex: string,
  newIndexPath: () => string,
  writeTree: (indexPath: string) => Promise<string>
): Promise<string> {
  // The copy keeps git's stat cache, so unchanged files are not read again. A repository without
  // commits has no index to copy, and git starts from an empty one. Reading a copied split index
  // may still refresh the modification time of the repository's shared index file.
  const copied = newIndexPath();
  await copyFile(repositoryIndex, copied).catch(() => undefined);
  try {
    return await writeTree(copied);
  } catch (error) {
    if (!(error instanceof GitCommandError) || error.reason !== 'failed') throw error;
  } finally {
    await removeIndex(copied);
  }
  // The copied index was unusable. An empty index rebuilds the listing from the files alone, which
  // loses force-added ignored files and skip-worktree entries, so this tree can differ from one
  // taken with the copied index.
  const fresh = newIndexPath();
  try {
    return await writeTree(fresh);
  } finally {
    await removeIndex(fresh);
  }
}

async function folderTarget({ git, store, workspacePath }: TargetContext): Promise<SnapshotTarget> {
  const gitDir = await ensureFolderRepository(git, store);
  const indexPath = join(store, 'folder.index');
  return {
    kind: 'folder',
    prefix: '',
    store,
    gitDirArgs: [`--git-dir=${gitDir}`],
    env: {},
    newIndexPath: () => join(store, `review-${randomUUID()}`),
    async snapshot() {
      await removeQuietly(`${indexPath}.lock`);
      const location = [`--git-dir=${gitDir}`, `--work-tree=${workspacePath}`, '-c', 'core.autocrlf=false'];
      const options = { env: { GIT_INDEX_FILE: indexPath }, timeoutMs: SNAPSHOT_TIMEOUT_MS };
      await git.run(workspacePath, [...location, 'add', '-A'], options);
      const tree = (await git.run(workspacePath, [...location, 'write-tree'], options)).trim();
      return { kind: 'folder', tree, head: null };
    },
    headTree: async () => null
  };
}

async function ensureFolderRepository(git: GitClient, store: string): Promise<string> {
  const gitDir = join(store, 'folder.git');
  const exists = await stat(join(gitDir, 'HEAD')).then(() => true, () => false);
  if (!exists) await git.run(store, ['init', '-q', '--bare', gitDir]);
  const excludePath = join(gitDir, 'info', 'exclude');
  const excludes = `${DEFAULT_FOLDER_EXCLUDES.join('\n')}\n`;
  const current = await readFile(excludePath, 'utf8').catch(() => null);
  if (current !== excludes) {
    await mkdir(join(gitDir, 'info'), { recursive: true });
    await writeFile(excludePath, excludes, 'utf8');
  }
  return gitDir;
}
