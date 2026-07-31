import { randomUUID } from 'node:crypto';
import { mkdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { extname, join } from 'node:path';

import {
  AppearanceBackgroundStateSchema,
  type AppearanceBackgroundState
} from '../../shared/contracts';

const MAX_SOURCE_BYTES = 25 * 1024 * 1024;
const MAX_OUTPUT_BYTES = 32 * 1024 * 1024;
const MAX_EDGE_PIXELS = 3840;
const SUPPORTED_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp']);

interface ImageLike {
  isEmpty(): boolean;
  getSize(): { width: number; height: number };
  resize(options: { width: number; height: number }): ImageLike;
  toPNG(): Buffer;
}

interface AppearanceBackgroundStoreOptions {
  directory: string;
  loadImage(path: string): ImageLike;
  renameFile?(from: string, to: string): Promise<void>;
}

export class AppearanceBackgroundStore {
  readonly path: string;
  private readonly directory: string;
  private readonly loadImage: (path: string) => ImageLike;
  private readonly renameFile: (from: string, to: string) => Promise<void>;

  constructor({ directory, loadImage, renameFile = rename }: AppearanceBackgroundStoreOptions) {
    this.directory = directory;
    this.path = join(directory, 'background.png');
    this.loadImage = loadImage;
    this.renameFile = renameFile;
  }

  async getState(): Promise<AppearanceBackgroundState> {
    try {
      const metadata = await stat(this.path);
      if (!metadata.isFile() || metadata.size <= 0) {
        return { available: false, revision: null };
      }
      return AppearanceBackgroundStateSchema.parse({
        available: true,
        revision: `${Math.floor(metadata.mtimeMs)}-${metadata.size}`
      });
    } catch {
      return { available: false, revision: null };
    }
  }

  async importFrom(sourcePath: string): Promise<AppearanceBackgroundState> {
    if (!SUPPORTED_EXTENSIONS.has(extname(sourcePath).toLowerCase())) {
      throw new Error('Choose a PNG, JPEG, or WebP image.');
    }
    const source = await stat(sourcePath);
    if (!source.isFile() || source.size <= 0 || source.size > MAX_SOURCE_BYTES) {
      throw new Error('The selected image must be a file smaller than 25 MB.');
    }

    let image = this.loadImage(sourcePath);
    if (image.isEmpty()) {
      throw new Error('The selected file is not a supported image.');
    }

    const size = image.getSize();
    if (size.width <= 0 || size.height <= 0) {
      throw new Error('The selected file is not a supported image.');
    }
    const largestEdge = Math.max(size.width, size.height);
    if (largestEdge > MAX_EDGE_PIXELS) {
      const ratio = MAX_EDGE_PIXELS / largestEdge;
      image = image.resize({
        width: Math.max(1, Math.round(size.width * ratio)),
        height: Math.max(1, Math.round(size.height * ratio))
      });
    }

    const normalized = image.toPNG();
    if (normalized.length <= 0 || normalized.length > MAX_OUTPUT_BYTES) {
      throw new Error('The selected image could not be normalized safely.');
    }

    await mkdir(this.directory, { recursive: true });
    const temporaryPath = join(this.directory, `background-${randomUUID()}.tmp`);
    const backupPath = join(this.directory, `background-${randomUUID()}.backup`);
    let previousImageMoved = false;
    let replacementCommitted = false;
    try {
      await writeFile(temporaryPath, normalized, { flag: 'wx' });
      try {
        await this.renameFile(this.path, backupPath);
        previousImageMoved = true;
      } catch (error) {
        if (!isMissingFileError(error)) {
          throw error;
        }
      }

      try {
        await this.renameFile(temporaryPath, this.path);
        replacementCommitted = true;
      } catch (commitError) {
        if (previousImageMoved) {
          try {
            await this.renameFile(backupPath, this.path);
          } catch (rollbackError) {
            throw new AggregateError(
              [commitError, rollbackError],
              'Lumora could not replace the background or restore the previous image.'
            );
          }
        }
        throw commitError;
      }
    } finally {
      await rm(temporaryPath, { force: true });
      if (replacementCommitted) {
        await rm(backupPath, { force: true });
      }
    }
    return this.getState();
  }

  async remove(): Promise<AppearanceBackgroundState> {
    await rm(this.path, { force: true });
    return { available: false, revision: null };
  }
}

function isMissingFileError(error: unknown): boolean {
  return typeof error === 'object'
    && error !== null
    && 'code' in error
    && error.code === 'ENOENT';
}
