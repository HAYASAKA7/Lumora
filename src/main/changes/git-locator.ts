import { posix, win32 } from 'node:path';

/** How long "git is not installed" is believed before looking again. */
const NOT_FOUND_RETRY_MS = 60_000;

interface GitLocatorOptions {
  locate(): Promise<string | null>;
  platform: NodeJS.Platform;
  clock?: () => number;
}

/** Only an absolute path to a real executable, never a name a working directory could supply. */
function trustedGitPath(path: string | null, platform: NodeJS.Platform): string | null {
  if (path === null) return null;
  if (platform === 'win32') {
    return win32.isAbsolute(path) && path.toLowerCase().endsWith('.exe') ? path : null;
  }
  return posix.isAbsolute(path) ? path : null;
}

/**
 * Finds git when change tracking needs it. A git that was found is kept for
 * the run; one that was not is looked for again after a minute, so installing
 * git takes effect without a restart.
 */
export function createGitLocator({
  locate,
  platform,
  clock = Date.now
}: GitLocatorOptions): () => Promise<string | null> {
  let lookup: Promise<string | null> | null = null;
  let notFoundAt: number | null = null;
  return () => {
    if (lookup !== null && notFoundAt !== null && clock() - notFoundAt >= NOT_FOUND_RETRY_MS) {
      lookup = null;
      notFoundAt = null;
    }
    lookup ??= locate()
      .catch(() => null)
      .then((path) => {
        const trusted = trustedGitPath(path, platform);
        if (trusted === null) notFoundAt = clock();
        return trusted;
      });
    return lookup;
  };
}
