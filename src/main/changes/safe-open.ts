import { realpath, stat } from 'node:fs/promises';
import { dirname, extname, isAbsolute, relative, resolve, sep } from 'node:path';

import { WorkspaceSnapshotEngine } from './workspace-snapshot-engine';

/** Files the system would run, install, load, or follow rather than show. */
const LAUNCHABLE_EXTENSIONS: ReadonlySet<string> = new Set([
  '.exe', '.com', '.bat', '.cmd', '.ps1', '.psm1', '.vbs', '.vbe', '.js', '.jse', '.wsf', '.wsh',
  '.hta', '.scr', '.msi', '.msp', '.lnk', '.url', '.appref-ms', '.pif', '.cpl', '.jar', '.reg',
  '.application', '.gadget', '.scf', '.inf', '.sh', '.command', '.app',
  '.py', '.pyw', '.pyz', '.pyc', '.rb', '.pl', '.ws', '.vb', '.msc', '.chm', '.cab', '.diagcab',
  '.settingcontent-ms', '.library-ms', '.search-ms', '.xll', '.mst', '.jnlp', '.zsh', '.bash',
  '.tool', '.csh', '.ksh', '.fish', '.ps1xml', '.psc1', '.mof', '.ocx', '.dll', '.sys', '.drv',
  '.terminal', '.fileloc', '.webloc', '.inetloc', '.workflow', '.action', '.pkg', '.mpkg', '.dmg', '.scpt',
  '.desktop', '.deb', '.rpm', '.appimage', '.run', '.flatpakref', '.flatpakrepo', '.snap'
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

/** Whether opening the file would run it, judged by its name: such files are revealed instead. */
export function isLaunchableFile(
  path: string,
  { platform = process.platform, pathExt = process.env.PATHEXT }: LaunchContext = {}
): boolean {
  const extension = extname(path).toLowerCase();
  if (extension === '') return false;
  return LAUNCHABLE_EXTENSIONS.has(extension) ||
    (platform === 'win32' && pathExtensions(pathExt).has(extension));
}

/**
 * Whether a file must be revealed rather than opened, by name: both the name
 * the renderer asked for and the file a link really leads to count.
 */
export function opensAsLaunchable(requestedPath: string, realPath: string, context: LaunchContext = {}): boolean {
  return isLaunchableFile(requestedPath, context) || isLaunchableFile(realPath, context);
}

/**
 * Whether opening would run the file: by name everywhere, and on macOS and
 * Linux also when the real file is marked executable. A file whose mode
 * cannot be read is revealed.
 */
export async function shouldRevealInstead(
  requestedPath: string,
  realPath: string,
  { stat: statFile = stat, ...context }: RevealContext = {}
): Promise<boolean> {
  if (opensAsLaunchable(requestedPath, realPath, context)) return true;
  if ((context.platform ?? process.platform) === 'win32') return false;
  try {
    const details = await statFile(realPath);
    return details.isFile() && (details.mode & ANY_EXECUTE_BIT) !== 0;
  } catch {
    return true;
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
