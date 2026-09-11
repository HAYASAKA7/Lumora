import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { StructuredImageStore } from './structured-image-store';

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'lumora-structured-images-'));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

function createStore(
  overrides: Partial<ConstructorParameters<typeof StructuredImageStore>[0]> = {}
) {
  let next = 0;
  return new StructuredImageStore({
    rootDirectory: root,
    decode: () => ({ width: 640, height: 480 }),
    createToken: () => {
      next += 1;
      return `image-${next}`;
    },
    ...overrides
  });
}

function caught(operation: () => unknown): unknown {
  try {
    operation();
  } catch (error) {
    return error;
  }
  return null;
}

describe('StructuredImageStore', () => {
  it('stages an image for its session and resolves the token to the file', async () => {
    const store = createStore();

    const staged = await store.stage({
      connectionId: 'connection-1',
      mimeType: 'image/png',
      data: PNG
    });

    expect(staged).toEqual({ token: 'image-1', width: 640, height: 480, bytes: PNG.byteLength });
    const [image] = store.resolve('connection-1', ['image-1']);
    expect(image?.mimeType).toBe('image/png');
    expect(image?.path.endsWith('image-1.png')).toBe(true);
    expect(new Uint8Array(await readFile(image!.path))).toEqual(PNG);
  });

  it('keeps a JPEG as a JPEG', async () => {
    const store = createStore();

    await store.stage({ connectionId: 'connection-1', mimeType: 'image/jpeg', data: JPEG });

    expect(store.resolve('connection-1', ['image-1'])[0]?.path.endsWith('image-1.jpg')).toBe(true);
  });

  it('refuses bytes that are not the image type they claim to be', async () => {
    const store = createStore();

    await expect(store.stage({
      connectionId: 'connection-1',
      mimeType: 'image/png',
      data: JPEG
    })).rejects.toMatchObject({ code: 'STRUCTURED_IMAGE_INVALID' });
    expect(await readdir(root)).toEqual([]);
  });

  it('refuses data the decoder cannot read as an image', async () => {
    const store = createStore({ decode: () => null });

    await expect(store.stage({
      connectionId: 'connection-1',
      mimeType: 'image/png',
      data: PNG
    })).rejects.toMatchObject({ code: 'STRUCTURED_IMAGE_INVALID' });
  });

  it('refuses an image larger than an agent is sent', async () => {
    const store = createStore({ decode: () => ({ width: 4_096, height: 100 }) });

    await expect(store.stage({
      connectionId: 'connection-1',
      mimeType: 'image/png',
      data: PNG
    })).rejects.toMatchObject({ code: 'STRUCTURED_IMAGE_INVALID' });
  });

  it('keeps only the newest images of a long session', async () => {
    const store = createStore({ maxImagesPerConnection: 2 });
    const image = { connectionId: 'connection-1', mimeType: 'image/png' as const, data: PNG };

    await store.stage(image);
    const [oldest] = store.resolve('connection-1', ['image-1']);
    await store.stage(image);
    await store.stage(image);

    expect(caught(() => store.resolve('connection-1', ['image-1']))).toMatchObject({
      code: 'STRUCTURED_IMAGE_UNKNOWN'
    });
    await expect(readFile(oldest!.path)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(store.resolve('connection-1', ['image-2', 'image-3'])).toHaveLength(2);
  });

  it('lets the oldest images go once a session reaches its byte budget', async () => {
    const store = createStore({ maxBytesPerConnection: PNG.byteLength * 2 });
    const image = { connectionId: 'connection-1', mimeType: 'image/png' as const, data: PNG };

    await store.stage(image);
    await store.stage(image);
    await store.stage(image);

    expect(caught(() => store.resolve('connection-1', ['image-1']))).toMatchObject({
      code: 'STRUCTURED_IMAGE_UNKNOWN'
    });
    expect(store.resolve('connection-1', ['image-2', 'image-3'])).toHaveLength(2);
  });

  it('keeps every image of one drop, though they are staged side by side', async () => {
    const store = createStore();
    const image = { connectionId: 'connection-1', mimeType: 'image/png' as const, data: PNG };

    const staged = await Promise.all([store.stage(image), store.stage(image), store.stage(image)]);

    expect(store.resolve('connection-1', staged.map(({ token }) => token))).toHaveLength(3);
  });

  it('never resolves a token staged for another session', async () => {
    const store = createStore();
    await store.stage({ connectionId: 'connection-1', mimeType: 'image/png', data: PNG });

    // A token proves nothing on its own: it only means something inside the
    // session that staged it.
    expect(caught(() => store.resolve('connection-2', ['image-1']))).toMatchObject({
      code: 'STRUCTURED_IMAGE_UNKNOWN'
    });
  });

  it('removes a session’s images and forgets its tokens when it closes', async () => {
    const store = createStore();
    await store.stage({ connectionId: 'connection-1', mimeType: 'image/png', data: PNG });

    await store.cleanupConnection('connection-1');

    expect(await readdir(root)).toEqual([]);
    expect(caught(() => store.resolve('connection-1', ['image-1']))).toMatchObject({
      code: 'STRUCTURED_IMAGE_UNKNOWN'
    });
  });
});
