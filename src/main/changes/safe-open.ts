import { realpath } from 'node:fs/promises';
import { dirname, extname, isAbsolute, relative, resolve, sep } from 'node:path';

import { WorkspaceSnapshotEngine } from './workspace-snapshot-engine';

/** Files the system would run, install, or follow rather than show. */
const LAUNCHABLE_EXTENSIONS: ReadonlySet<string> = new Set([
  '.exe', '.com', '.bat', '.cmd', '.ps1', '.psm1', '.vbs', '.vbe', '.js', '.jse', '.wsf', '.wsh',
  '.hta', '.scr', '.msi', '.msp', '.lnk', '.url', '.appref-ms', '.pif', '.cpl', '.jar', '.reg',
  '.application', '.gadget', '.scf', '.inf', '.sh', '.command', '.app'
]);

/** Whether opening the file would run it: such files are revealed instead. */
export function isLaunchableFile(path: string): boolean {
  return LAUNCHABLE_EXTENSIONS.has(extname(path).toLowerCase());
}

/**
 * Whether a file must be revealed rather than opened: judged by both the name
 * the renderer asked for and the file a link really leads to.
 */
export function opensAsLaunchable(requestedPath: string, realPath: string): boolean {
  return isLaunchableFile(requestedPath) || isLaunchableFile(realPath);
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
