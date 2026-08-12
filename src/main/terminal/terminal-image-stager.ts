import { randomUUID } from 'node:crypto';
import { mkdir, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { SystemInfo } from '../../shared/contracts';

export const MAX_TERMINAL_IMAGE_BYTES = 20 * 1024 * 1024;
export const MAX_TERMINAL_IMAGE_DIMENSION = 8_192;
const DEFAULT_MAX_FILES_PER_RUNTIME = 20;
const DEFAULT_MAX_BYTES_PER_RUNTIME = 100 * 1024 * 1024;
const DEFAULT_STALE_AFTER_MS = 24 * 60 * 60 * 1_000;

interface StagedFile {
  path: string;
  bytes: number;
}

interface TerminalImageStagerOptions {
  rootDirectory: string;
  maxFilesPerRuntime?: number;
  maxBytesPerRuntime?: number;
  staleAfterMs?: number;
  clock?: () => Date;
}

interface StageLocalInput {
  runtimeId: string;
  png: Buffer;
  width: number;
  height: number;
  platform: SystemInfo['platform'];
}

function safeRuntimeDirectory(runtimeId: string): string {
  return runtimeId.replace(/[^a-zA-Z0-9-]/gu, '_');
}

export function formatTerminalImageReference(
  path: string,
  _platform: SystemInfo['platform']
): string {
  return `[Pasted image: "${path.replace(/"/gu, '\\"')}"]`;
}

export class TerminalImageStager {
  private readonly files = new Map<string, StagedFile[]>();
  private readonly maxFilesPerRuntime: number;
  private readonly maxBytesPerRuntime: number;
  private readonly staleAfterMs: number;
  private readonly clock: () => Date;

  constructor(private readonly options: TerminalImageStagerOptions) {
    this.maxFilesPerRuntime =
      options.maxFilesPerRuntime ?? DEFAULT_MAX_FILES_PER_RUNTIME;
    this.maxBytesPerRuntime =
      options.maxBytesPerRuntime ?? DEFAULT_MAX_BYTES_PER_RUNTIME;
    this.staleAfterMs = options.staleAfterMs ?? DEFAULT_STALE_AFTER_MS;
    this.clock = options.clock ?? (() => new Date());
  }

  async stageLocal(input: StageLocalInput): Promise<{
    path: string;
    pasteText: string;
  }> {
    if (
      input.png.length === 0 ||
      input.png.length > MAX_TERMINAL_IMAGE_BYTES ||
      !Number.isSafeInteger(input.width) ||
      !Number.isSafeInteger(input.height) ||
      input.width <= 0 ||
      input.height <= 0 ||
      input.width > MAX_TERMINAL_IMAGE_DIMENSION ||
      input.height > MAX_TERMINAL_IMAGE_DIMENSION
    ) {
      throw new Error('TERMINAL_IMAGE_INVALID');
    }
    const existing = this.files.get(input.runtimeId) ?? [];
    const usedBytes = existing.reduce((total, file) => total + file.bytes, 0);
    if (
      existing.length >= this.maxFilesPerRuntime ||
      usedBytes + input.png.length > this.maxBytesPerRuntime
    ) {
      throw new Error('TERMINAL_IMAGE_QUOTA_EXCEEDED');
    }

    const runtimeDirectory = join(
      this.options.rootDirectory,
      safeRuntimeDirectory(input.runtimeId)
    );
    await mkdir(runtimeDirectory, { recursive: true, mode: 0o700 });
    const path = join(runtimeDirectory, `${randomUUID()}.png`);
    await writeFile(path, input.png, { flag: 'wx', mode: 0o600 });
    existing.push({ path, bytes: input.png.length });
    this.files.set(input.runtimeId, existing);
    return {
      path,
      pasteText: formatTerminalImageReference(path, input.platform)
    };
  }

  async cleanupRuntime(runtimeId: string): Promise<void> {
    this.files.delete(runtimeId);
    try {
      await rm(
        join(this.options.rootDirectory, safeRuntimeDirectory(runtimeId)),
        { recursive: true, force: true }
      );
    } catch {
      // Runtime shutdown must not surface a cleanup failure to the user.
    }
  }

  async cleanupStale({ maxDirectories }: { maxDirectories: number }): Promise<number> {
    let entries;
    try {
      entries = await readdir(this.options.rootDirectory, { withFileTypes: true });
    } catch {
      return 0;
    }
    const active = new Set(
      [...this.files.keys()].map((runtimeId) => safeRuntimeDirectory(runtimeId))
    );
    const threshold = this.clock().getTime() - this.staleAfterMs;
    let removed = 0;
    for (const entry of entries) {
      if (removed >= maxDirectories || !entry.isDirectory() || active.has(entry.name)) {
        continue;
      }
      const path = join(this.options.rootDirectory, entry.name);
      try {
        if ((await stat(path)).mtimeMs >= threshold) continue;
        await rm(path, { recursive: true, force: true });
        removed += 1;
      } catch {
        // Stale cleanup is best effort and never blocks terminal startup.
      }
    }
    return removed;
  }
}
