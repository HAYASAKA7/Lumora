import { createHash } from 'node:crypto';
import { realpath as resolveRealPath, stat } from 'node:fs/promises';
import { posix, win32 } from 'node:path';

import type { SystemInfo } from '../../shared/contracts';

type SupportedPlatform = SystemInfo['platform'];
type PathExists = (candidate: string) => Promise<boolean>;
type Realpath = (candidate: string) => Promise<string>;

export interface CanonicalWorkspacePath {
  id: string;
  canonicalPath: string;
  identityKey: string;
  displayName: string;
  available: boolean;
}

interface CanonicalizeWorkspaceOptions {
  platform: SupportedPlatform;
  pathExists?: PathExists;
  realpath?: Realpath;
}

async function isDirectory(candidate: string): Promise<boolean> {
  try {
    return (await stat(candidate)).isDirectory();
  } catch {
    return false;
  }
}

function removeNonRootTrailingSeparators(
  candidate: string,
  platform: SupportedPlatform
): string {
  const pathApi = platform === 'win32' ? win32 : posix;
  const root = pathApi.parse(candidate).root;
  if (candidate.length <= root.length) {
    return candidate;
  }

  return platform === 'win32'
    ? candidate.replace(/[\\/]+$/, '')
    : candidate.replace(/\/+$/, '');
}

function normalizeAbsolutePath(
  candidate: string,
  platform: SupportedPlatform
): string {
  if (candidate.includes('\0')) {
    throw new Error('Workspace paths cannot contain NUL characters.');
  }

  const pathApi = platform === 'win32' ? win32 : posix;
  if (!pathApi.isAbsolute(candidate)) {
    throw new Error('Workspace paths must be absolute.');
  }

  const normalized = removeNonRootTrailingSeparators(
    pathApi.normalize(candidate),
    platform
  );
  if (normalized.length > 32_768) {
    throw new Error('Workspace paths are too long.');
  }

  return normalized;
}

export async function canonicalizeWorkspacePath(
  candidate: string,
  {
    platform,
    pathExists = isDirectory,
    realpath = resolveRealPath
  }: CanonicalizeWorkspaceOptions
): Promise<CanonicalWorkspacePath> {
  const lexicalPath = normalizeAbsolutePath(candidate, platform);
  const available = await pathExists(lexicalPath);
  const canonicalPath = available
    ? normalizeAbsolutePath(await realpath(lexicalPath), platform)
    : lexicalPath;
  const identityKey =
    platform === 'win32' ? canonicalPath.toLocaleLowerCase('en-US') : canonicalPath;
  const id = createHash('sha256')
    .update(platform)
    .update('\0')
    .update(identityKey)
    .digest('hex');
  const pathApi = platform === 'win32' ? win32 : posix;

  return {
    id,
    canonicalPath,
    identityKey,
    displayName: pathApi.basename(canonicalPath) || canonicalPath,
    available
  };
}
