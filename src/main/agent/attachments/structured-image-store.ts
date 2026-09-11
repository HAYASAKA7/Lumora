import { randomUUID } from 'node:crypto';
import { mkdir, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import {
  STRUCTURED_IMAGE_MAX_BYTES,
  STRUCTURED_IMAGE_MAX_DIMENSION,
  type StructuredImageMimeType
} from '../../../shared/agent/contracts';

const DEFAULT_MAX_IMAGES_PER_CONNECTION = 64;
const DEFAULT_MAX_BYTES_PER_CONNECTION = 200 * 1024 * 1024;
const DEFAULT_STALE_AFTER_MS = 24 * 60 * 60 * 1_000;

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const;
const JPEG_SIGNATURE = [0xff, 0xd8, 0xff] as const;
const EXTENSIONS: Readonly<Record<StructuredImageMimeType, string>> = {
  'image/png': 'png',
  'image/jpeg': 'jpg'
};

export interface ResolvedStructuredImage {
  path: string;
  mimeType: StructuredImageMimeType;
  width: number;
  height: number;
  bytes: number;
}

export class StructuredImageStoreError extends Error {
  constructor(
    readonly code: 'STRUCTURED_IMAGE_INVALID' | 'STRUCTURED_IMAGE_UNKNOWN'
  ) {
    super(code);
    this.name = 'StructuredImageStoreError';
  }
}

interface StructuredImageStoreOptions {
  rootDirectory: string;
  /**
   * Decodes the bytes to prove they are an image, returning its size, or null
   * when they are not. The main process passes Electron's decoder; the bytes
   * come from the renderer and are never trusted on their label alone.
   */
  decode(data: Uint8Array): { width: number; height: number } | null;
  maxImagesPerConnection?: number;
  maxBytesPerConnection?: number;
  staleAfterMs?: number;
  clock?: () => Date;
  createToken?: () => string;
}

function startsWith(data: Uint8Array, signature: readonly number[]): boolean {
  return signature.every((byte, index) => data[index] === byte);
}

function safeDirectory(connectionId: string): string {
  return connectionId.replace(/[^a-zA-Z0-9-]/gu, '_');
}

function validDimension(value: number): boolean {
  return Number.isSafeInteger(value) &&
    value > 0 &&
    value <= STRUCTURED_IMAGE_MAX_DIMENSION;
}

/**
 * Holds the images a Unified UI session has attached, on disk, behind opaque
 * tokens.
 *
 * The renderer sends bytes and gets a token back; only an adapter, through the
 * runtime host, turns a token into a file. A path therefore never travels from
 * the renderer to the main process, and a token staged for one session cannot
 * be used by another. Files follow the same rules as terminal image pastes: a
 * private directory per session, files written once, and removal when the
 * session closes. Unlike a paste, a session does not run out of room: past its
 * budget it keeps only its newest images.
 */
export class StructuredImageStore {
  private readonly images = new Map<string, Map<string, ResolvedStructuredImage>>();
  private readonly maxImagesPerConnection: number;
  private readonly maxBytesPerConnection: number;
  private readonly staleAfterMs: number;
  private readonly clock: () => Date;
  private readonly createToken: () => string;

  constructor(private readonly options: StructuredImageStoreOptions) {
    this.maxImagesPerConnection =
      options.maxImagesPerConnection ?? DEFAULT_MAX_IMAGES_PER_CONNECTION;
    this.maxBytesPerConnection =
      options.maxBytesPerConnection ?? DEFAULT_MAX_BYTES_PER_CONNECTION;
    this.staleAfterMs = options.staleAfterMs ?? DEFAULT_STALE_AFTER_MS;
    this.clock = options.clock ?? (() => new Date());
    this.createToken = options.createToken ?? randomUUID;
  }

  async stage(input: {
    connectionId: string;
    mimeType: StructuredImageMimeType;
    data: Uint8Array;
  }): Promise<{ token: string; width: number; height: number; bytes: number }> {
    const { connectionId, mimeType, data } = input;
    const signature = mimeType === 'image/png' ? PNG_SIGNATURE : JPEG_SIGNATURE;
    if (
      data.byteLength === 0 ||
      data.byteLength > STRUCTURED_IMAGE_MAX_BYTES ||
      !startsWith(data, signature)
    ) {
      throw new StructuredImageStoreError('STRUCTURED_IMAGE_INVALID');
    }
    const size = this.options.decode(data);
    if (size === null || !validDimension(size.width) || !validDimension(size.height)) {
      throw new StructuredImageStoreError('STRUCTURED_IMAGE_INVALID');
    }

    const directory = join(this.options.rootDirectory, safeDirectory(connectionId));
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const token = this.createToken();
    const path = join(directory, `${token}.${EXTENSIONS[mimeType]}`);
    await writeFile(path, data, { flag: 'wx', mode: 0o600 });
    const image: ResolvedStructuredImage = {
      path,
      mimeType,
      width: size.width,
      height: size.height,
      bytes: data.byteLength
    };

    // Count against the session's images as they are now, not as they were
    // before the write: the images of one drop are staged side by side.
    const kept: Array<[string, ResolvedStructuredImage]> = [
      ...(this.images.get(connectionId) ?? new Map<string, ResolvedStructuredImage>()),
      [token, image]
    ];
    const evicted: ResolvedStructuredImage[] = [];
    let usedBytes = kept.reduce((total, [, entry]) => total + entry.bytes, 0);
    // A long session keeps only its newest images. The ones still waiting in
    // the composer are the newest few, and an older one was read when it was
    // sent, so letting it go costs nothing.
    while (
      kept.length > 1 &&
      (kept.length > this.maxImagesPerConnection || usedBytes > this.maxBytesPerConnection)
    ) {
      const [, oldest] = kept.shift()!;
      evicted.push(oldest);
      usedBytes -= oldest.bytes;
    }
    this.images.set(connectionId, new Map(kept));
    await Promise.all(evicted.map((entry) => rm(entry.path, { force: true }).catch(() => undefined)));
    return { token, width: image.width, height: image.height, bytes: image.bytes };
  }

  /** Every token must belong to this session, or none is resolved. */
  resolve(connectionId: string, tokens: readonly string[]): readonly ResolvedStructuredImage[] {
    const staged = this.images.get(connectionId);
    return tokens.map((token) => {
      const image = staged?.get(token);
      if (image === undefined) {
        throw new StructuredImageStoreError('STRUCTURED_IMAGE_UNKNOWN');
      }
      return image;
    });
  }

  async cleanupConnection(connectionId: string): Promise<void> {
    this.images.delete(connectionId);
    try {
      await rm(join(this.options.rootDirectory, safeDirectory(connectionId)), {
        recursive: true,
        force: true
      });
    } catch {
      // Closing a session must not surface a cleanup failure to the user.
    }
  }

  /** Removes folders left behind by sessions from an earlier run. */
  async cleanupStale({ maxDirectories }: { maxDirectories: number }): Promise<number> {
    let entries;
    try {
      entries = await readdir(this.options.rootDirectory, { withFileTypes: true });
    } catch {
      return 0;
    }
    const active = new Set([...this.images.keys()].map(safeDirectory));
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
        // Stale cleanup is best effort and never blocks startup.
      }
    }
    return removed;
  }
}
