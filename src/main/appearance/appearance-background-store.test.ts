import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AppearanceBackgroundStore } from './appearance-background-store';

const cleanup: string[] = [];

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((path) => rm(path, {
    force: true,
    recursive: true
  })));
});

describe('AppearanceBackgroundStore', () => {
  it('normalizes, bounds, and stores a managed PNG copy', async () => {
    const root = await mkdtemp(join(tmpdir(), 'lumora-appearance-'));
    cleanup.push(root);
    const source = join(root, 'source.webp');
    await writeFile(source, Buffer.from('source image'));
    const resized = {
      isEmpty: () => false,
      getSize: () => ({ width: 3840, height: 1920 }),
      resize: vi.fn(),
      toPNG: () => Buffer.from('normalized png')
    };
    const image = {
      isEmpty: () => false,
      getSize: () => ({ width: 5000, height: 2500 }),
      resize: vi.fn(() => resized),
      toPNG: vi.fn()
    };
    const store = new AppearanceBackgroundStore({
      directory: join(root, 'managed'),
      loadImage: vi.fn(() => image)
    });

    const state = await store.importFrom(source);

    expect(image.resize).toHaveBeenCalledWith({ width: 3840, height: 1920 });
    expect(await readFile(store.path)).toEqual(Buffer.from('normalized png'));
    expect(state.available).toBe(true);
    expect(state.revision).toMatch(/^\d+-\d+$/);
    await expect(store.getState()).resolves.toEqual(state);
  });

  it('rejects undecodable images and leaves no managed copy', async () => {
    const root = await mkdtemp(join(tmpdir(), 'lumora-appearance-'));
    cleanup.push(root);
    const source = join(root, 'bad.png');
    await writeFile(source, Buffer.from('not an image'));
    const store = new AppearanceBackgroundStore({
      directory: join(root, 'managed'),
      loadImage: () => ({
        isEmpty: () => true,
        getSize: () => ({ width: 0, height: 0 }),
        resize: vi.fn(),
        toPNG: () => Buffer.alloc(0)
      })
    });

    await expect(store.importFrom(source)).rejects.toThrow(
      'The selected file is not a supported image.'
    );
    await expect(store.getState()).resolves.toEqual({
      available: false,
      revision: null
    });
  });

  it('rejects image formats outside PNG, JPEG, and WebP', async () => {
    const root = await mkdtemp(join(tmpdir(), 'lumora-appearance-'));
    cleanup.push(root);
    const source = join(root, 'animated.gif');
    await writeFile(source, Buffer.from('gif'));
    const store = new AppearanceBackgroundStore({
      directory: join(root, 'managed'),
      loadImage: vi.fn()
    });

    await expect(store.importFrom(source)).rejects.toThrow(
      'Choose a PNG, JPEG, or WebP image.'
    );
  });

  it('restores the previous managed image if replacement cannot be committed', async () => {
    const root = await mkdtemp(join(tmpdir(), 'lumora-appearance-'));
    cleanup.push(root);
    const directory = join(root, 'managed');
    const managedPath = join(directory, 'background.png');
    const source = join(root, 'replacement.png');
    await mkdir(directory, { recursive: true });
    await writeFile(managedPath, Buffer.from('previous png'));
    await writeFile(source, Buffer.from('source image'));
    const store = new AppearanceBackgroundStore({
      directory,
      loadImage: () => ({
        isEmpty: () => false,
        getSize: () => ({ width: 1920, height: 1080 }),
        resize: vi.fn(),
        toPNG: () => Buffer.from('replacement png')
      }),
      renameFile: async (from, to) => {
        if (from.endsWith('.tmp') && to === managedPath) {
          throw new Error('simulated commit failure');
        }
        await rename(from, to);
      }
    });

    await expect(store.importFrom(source)).rejects.toThrow('simulated commit failure');
    await expect(readFile(managedPath)).resolves.toEqual(Buffer.from('previous png'));
  });
});
