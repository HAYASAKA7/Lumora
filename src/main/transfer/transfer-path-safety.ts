import { lstat } from 'node:fs/promises';
import { lstatSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';

export class TransferPathError extends Error {
  constructor(
    readonly code: string,
    message: string
  ) {
    super(message);
    this.name = 'TransferPathError';
  }
}

export function assertSafeArchiveEntryName(name: string): string {
  if (
    name.length < 1 ||
    name.length > 1_024 ||
    name.includes('\0') ||
    name.includes('\\') ||
    name.startsWith('/') ||
    /^[a-zA-Z]:/.test(name) ||
    isAbsolute(name)
  ) {
    throw new TransferPathError('ARCHIVE_ENTRY_UNSAFE', 'Archive entry name is unsafe.');
  }
  const segments = name.split('/');
  if (segments.some((segment) => segment.length === 0 || segment === '.' || segment === '..')) {
    throw new TransferPathError('ARCHIVE_ENTRY_UNSAFE', 'Archive entry name is unsafe.');
  }
  return segments.join('/');
}

export function assertContainedPath(root: string, relativeName: string): string {
  const safeName = assertSafeArchiveEntryName(relativeName);
  try {
    if (lstatSync(root).isSymbolicLink()) {
      throw new TransferPathError(
        'ARCHIVE_STAGING_UNSAFE',
        'Archive staging directory cannot be a symbolic link.'
      );
    }
  } catch (error) {
    if (error instanceof TransferPathError) throw error;
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  const rootPath = resolve(root);
  const destination = resolve(rootPath, ...safeName.split('/'));
  const fromRoot = relative(rootPath, destination);
  if (fromRoot === '..' || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot)) {
    throw new TransferPathError('ARCHIVE_ENTRY_UNSAFE', 'Archive entry escapes staging.');
  }
  return destination;
}

export async function assertRegularFile(path: string): Promise<number> {
  const status = await lstat(path);
  if (!status.isFile() || status.isSymbolicLink()) {
    throw new TransferPathError(
      'ARCHIVE_SOURCE_NOT_REGULAR',
      'Archive sources must be regular files.'
    );
  }
  return status.size;
}
