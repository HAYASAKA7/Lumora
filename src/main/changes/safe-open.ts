import { realpath, stat } from 'node:fs/promises';
import { dirname, extname, isAbsolute, relative, resolve, sep } from 'node:path';

import { WorkspaceSnapshotEngine } from './workspace-snapshot-engine';

/**
 * Files the system would run, install, load, or follow rather than show.
 * Nothing here ever opens: the file is shown in its folder instead.
 */
const NEVER_OPEN_EXTENSIONS: ReadonlySet<string> = new Set([
  '.exe', '.com', '.bat', '.cmd', '.scr', '.pif', '.msi', '.msp', '.msc', '.cpl', '.dll', '.sys',
  '.drv', '.ocx', '.jar', '.reg', '.application', '.gadget', '.scf', '.inf', '.hta', '.lnk', '.url',
  '.appref-ms', '.chm', '.cab', '.diagcab', '.settingcontent-ms', '.library-ms', '.search-ms',
  '.xll', '.mst', '.jnlp', '.app', '.command', '.tool', '.terminal', '.fileloc', '.webloc',
  '.inetloc', '.workflow', '.action', '.pkg', '.mpkg', '.dmg', '.deb', '.rpm', '.appimage', '.run',
  '.flatpakref', '.flatpakrepo', '.snap', '.pyc'
]);

/**
 * Scripts that people also read. Opening one hands it to whatever the system
 * set up for that type, which may run it, so opening asks first.
 */
const CONFIRM_EXTENSIONS: ReadonlySet<string> = new Set([
  '.py', '.pyw', '.pyz', '.rb', '.pl', '.ps1', '.psm1', '.ps1xml', '.psc1', '.sh', '.bash', '.zsh',
  '.csh', '.ksh', '.fish', '.vbs', '.vbe', '.vb', '.js', '.jse', '.wsf', '.wsh', '.ws', '.mof',
  '.scpt', '.desktop'
]);

/** Execute permission for owner, group, or others. */
const ANY_EXECUTE_BIT = 0o111;

export interface LaunchContext {
  platform?: NodeJS.Platform;
  /** Windows' PATHEXT: more extensions the shell runs. */
  pathExt?: string | undefined;
}

export interface RevealContext extends LaunchContext {
  stat?: (path: string) => Promise<{ mode: number; isFile(): boolean }>;
}

function pathExtensions(pathExt: string | undefined): ReadonlySet<string> {
  return new Set((pathExt ?? '')
    .split(';')
    .map((extension) => extension.trim().toLowerCase())
    .filter((extension) => extension.startsWith('.')));
}

/** What opening a file may do: open it, ask first, or only ever show it in its folder. */
export type OpenSafety = 'open' | 'confirm' | 'reveal';

const STRICTNESS: Readonly<Record<OpenSafety, number>> = { open: 0, confirm: 1, reveal: 2 };

function strictest(left: OpenSafety, right: OpenSafety): OpenSafety {
  return STRICTNESS[left] >= STRICTNESS[right] ? left : right;
}

/** What opening the file would do, judged by its name alone. */
export function fileOpenSafety(
  path: string,
  { platform = process.platform, pathExt = process.env.PATHEXT }: LaunchContext = {}
): OpenSafety {
  const extension = extname(path).toLowerCase();
  if (extension === '') return 'open';
  if (NEVER_OPEN_EXTENSIONS.has(extension)) return 'reveal';
  // A script people read keeps its question even where the shell would run it,
  // since PATHEXT lists .py wherever Python is installed.
  if (CONFIRM_EXTENSIONS.has(extension)) return 'confirm';
  return platform === 'win32' && pathExtensions(pathExt).has(extension) ? 'reveal' : 'open';
}

/**
 * What opening a file would do, by name: both the name the renderer asked for
 * and the file a link really leads to count, and the stricter one wins.
 */
export function openSafetyByName(
  requestedPath: string,
  realPath: string,
  context: LaunchContext = {}
): OpenSafety {
  return strictest(fileOpenSafety(requestedPath, context), fileOpenSafety(realPath, context));
}

/**
 * What opening a file would do: by name everywhere, and on macOS and Linux a
 * real file marked executable is only ever revealed. A file whose mode cannot
 * be read is revealed.
 */
export async function openSafetyFor(
  requestedPath: string,
  realPath: string,
  { stat: statFile = stat, ...context }: RevealContext = {}
): Promise<OpenSafety> {
  const byName = openSafetyByName(requestedPath, realPath, context);
  if (byName === 'reveal') return 'reveal';
  if ((context.platform ?? process.platform) === 'win32') return byName;
  try {
    const details = await statFile(realPath);
    return details.isFile() && (details.mode & ANY_EXECUTE_BIT) !== 0 ? 'reveal' : byName;
  } catch {
    return 'reveal';
  }
}

export type OpenTarget =
  /** The real path of the file or folder, which lies inside the workspace. */
  | { exists: true; path: string }
  /** Nothing is there; `path` is the real path of the nearest existing folder inside the workspace. */
  | { exists: false; path: string };

function isWithin(base: string, target: string): boolean {
  const fromBase = relative(base, target);
  return fromBase === '' ||
    (!isAbsolute(fromBase) && fromBase !== '..' && !fromBase.startsWith(`..${sep}`) && !fromBase.startsWith('../'));
}

function isMissing(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | null)?.code;
  return code === 'ENOENT' || code === 'ENOTDIR';
}

/**
 * Where a changed file really is. Its name must stay inside the workspace, and
 * so must the real path it resolves to, so a link or junction cannot lead out.
 */
export async function resolveOpenTarget(workspacePath: string, path: string): Promise<OpenTarget> {
  const lexical = WorkspaceSnapshotEngine.resolveInside(workspacePath, path);
  if (lexical === null) {
    throw new Error('The path is outside the workspace.');
  }
  const base = resolve(workspacePath);
  const realBase = await realpath(base);
  let candidate = lexical;
  for (;;) {
    try {
      const real = await realpath(candidate);
      if (!isWithin(realBase, real)) {
        throw new Error('The path is outside the workspace.');
      }
      // The real path is what gets judged and opened, not the name that led to it.
      return { exists: candidate === lexical, path: real };
    } catch (error) {
      if (!isMissing(error)) throw error;
    }
    const parent = dirname(candidate);
    if (candidate === base || parent === candidate || !isWithin(base, parent)) {
      return { exists: false, path: realBase };
    }
    candidate = parent;
  }
}
