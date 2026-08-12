import { randomUUID } from 'node:crypto';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join, posix, win32 } from 'node:path';

import type { SystemInfo } from '../../shared/contracts';
import {
  formatTerminalImageReference,
  MAX_TERMINAL_IMAGE_BYTES
} from '../terminal/terminal-image-stager';
import type { RemoteFileTransfer } from './ssh-client';

interface RemoteTerminalImageStagerOptions {
  localRootDirectory: string;
  maxFilesPerRuntime?: number;
  maxBytesPerRuntime?: number;
}

interface StageRemoteImageInput {
  runtimeId: string;
  png: Buffer;
  platform: SystemInfo['platform'];
  baseDirectory: string;
  files: RemoteFileTransfer;
}

interface StagedRemoteFile {
  path: string;
  bytes: number;
}

const DEFAULT_MAX_FILES_PER_RUNTIME = 20;
const DEFAULT_MAX_BYTES_PER_RUNTIME = 100 * 1024 * 1024;

function safeRuntimeId(runtimeId: string): string {
  return runtimeId.replace(/[^a-zA-Z0-9-]/gu, '_');
}

function remoteDirectories(input: StageRemoteImageInput): string[] {
  const runtimeId = safeRuntimeId(input.runtimeId);
  if (input.platform === 'win32') {
    const lumora = win32.join(input.baseDirectory, 'Lumora');
    const temporary = win32.join(lumora, 'tmp');
    const images = win32.join(temporary, 'terminal-images');
    return [lumora, temporary, images, win32.join(images, runtimeId)];
  }
  const lumora = posix.join(input.baseDirectory, '.lumora');
  const temporary = posix.join(lumora, 'tmp');
  const images = posix.join(temporary, 'terminal-images');
  return [lumora, temporary, images, posix.join(images, runtimeId)];
}

async function ensureDirectories(
  files: RemoteFileTransfer,
  directories: readonly string[]
): Promise<void> {
  for (const directory of directories) {
    if ((await files.stat(directory)).exists) continue;
    await files.mkdir(directory);
    await files.chmod(directory, 0o700);
  }
}

export class RemoteTerminalImageStager {
  private readonly remoteFiles = new Map<string, StagedRemoteFile[]>();
  private readonly maxFilesPerRuntime: number;
  private readonly maxBytesPerRuntime: number;

  constructor(private readonly options: RemoteTerminalImageStagerOptions) {
    this.maxFilesPerRuntime = options.maxFilesPerRuntime ?? DEFAULT_MAX_FILES_PER_RUNTIME;
    this.maxBytesPerRuntime = options.maxBytesPerRuntime ?? DEFAULT_MAX_BYTES_PER_RUNTIME;
  }

  async stage(input: StageRemoteImageInput): Promise<{
    remotePath: string;
    pasteText: string;
  }> {
    const existing = this.remoteFiles.get(input.runtimeId) ?? [];
    const usedBytes = existing.reduce((total, file) => total + file.bytes, 0);
    if (
      input.png.length === 0 ||
      input.png.length > MAX_TERMINAL_IMAGE_BYTES
    ) {
      throw new Error('TERMINAL_IMAGE_INVALID');
    }
    if (
      existing.length >= this.maxFilesPerRuntime ||
      usedBytes + input.png.length > this.maxBytesPerRuntime
    ) {
      throw new Error('TERMINAL_IMAGE_QUOTA_EXCEEDED');
    }

    const localDirectory = join(
      this.options.localRootDirectory,
      safeRuntimeId(input.runtimeId)
    );
    await mkdir(localDirectory, { recursive: true, mode: 0o700 });
    const identifier = randomUUID();
    const localPath = join(localDirectory, `${identifier}.png`);
    const directories = remoteDirectories(input);
    const paths = input.platform === 'win32' ? win32 : posix;
    const finalPath = paths.join(directories.at(-1)!, `${identifier}.png`);
    const uploadPath = `${finalPath}.upload`;
    let uploaded = false;
    try {
      await writeFile(localPath, input.png, { flag: 'wx', mode: 0o600 });
      await ensureDirectories(input.files, directories);
      await input.files.upload(localPath, uploadPath);
      uploaded = true;
      const transferred = await input.files.stat(uploadPath);
      if (!transferred.exists || transferred.size !== input.png.length) {
        throw new Error('invalid transferred size');
      }
      await input.files.chmod(uploadPath, 0o600);
      await input.files.rename(uploadPath, finalPath);
      uploaded = false;
      existing.push({ path: finalPath, bytes: input.png.length });
      this.remoteFiles.set(input.runtimeId, existing);
      return {
        remotePath: finalPath,
        pasteText: formatTerminalImageReference(finalPath, input.platform)
      };
    } catch {
      if (uploaded) {
        try {
          await input.files.remove(uploadPath);
        } catch {
          // The primary transfer error remains authoritative.
        }
      }
      throw new Error('TERMINAL_IMAGE_REMOTE_TRANSFER_FAILED');
    } finally {
      await rm(localPath, { force: true });
    }
  }

  async cleanupRuntime(
    runtimeId: string,
    files: RemoteFileTransfer
  ): Promise<void> {
    const paths = this.remoteFiles.get(runtimeId);
    this.remoteFiles.delete(runtimeId);
    if (paths === undefined) return;
    await Promise.allSettled(paths.map(({ path }) => files.remove(path)));
  }
}
