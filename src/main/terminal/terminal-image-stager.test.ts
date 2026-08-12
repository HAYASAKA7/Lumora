import { access, mkdir, readFile, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtemp } from 'node:fs/promises';

import { afterEach, describe, expect, it } from 'vitest';

import {
  MAX_TERMINAL_IMAGE_BYTES,
  MAX_TERMINAL_IMAGE_DIMENSION,
  TerminalImageStager,
  formatTerminalImageReference
} from './terminal-image-stager';

const roots: string[] = [];
const runtimeId = '5a795d90-06b3-4fca-b9a7-c0d0bf312c1d';

async function root(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), 'lumora-image-stager-'));
  roots.push(path);
  return path;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe('TerminalImageStager', () => {
  it('writes a private randomized PNG and returns a target-readable reference', async () => {
    const directory = await root();
    const stager = new TerminalImageStager({ rootDirectory: directory });
    const png = Buffer.from('png fixture');

    const staged = await stager.stageLocal({
      runtimeId,
      png,
      width: 640,
      height: 480,
      platform: 'win32'
    });

    expect(staged.path).toMatch(/\.png$/);
    expect(staged.pasteText).toBe(`[Pasted image: "${staged.path}"]`);
    expect(await readFile(staged.path)).toEqual(png);
    expect((await stat(staged.path)).size).toBe(png.length);
  });

  it.each([
    { png: Buffer.alloc(MAX_TERMINAL_IMAGE_BYTES + 1), width: 1, height: 1 },
    { png: Buffer.from('x'), width: MAX_TERMINAL_IMAGE_DIMENSION + 1, height: 1 },
    { png: Buffer.from('x'), width: 1, height: MAX_TERMINAL_IMAGE_DIMENSION + 1 },
    { png: Buffer.alloc(0), width: 1, height: 1 }
  ])('rejects invalid or oversized image input', async (input) => {
    const stager = new TerminalImageStager({ rootDirectory: await root() });
    await expect(stager.stageLocal({ runtimeId, platform: 'linux', ...input }))
      .rejects.toThrow('TERMINAL_IMAGE_INVALID');
  });

  it('enforces the per-runtime file count without affecting another runtime', async () => {
    const stager = new TerminalImageStager({
      rootDirectory: await root(),
      maxFilesPerRuntime: 2
    });
    const input = { png: Buffer.from('x'), width: 1, height: 1, platform: 'linux' as const };
    await stager.stageLocal({ runtimeId, ...input });
    await stager.stageLocal({ runtimeId, ...input });
    await expect(stager.stageLocal({ runtimeId, ...input })).rejects.toThrow(
      'TERMINAL_IMAGE_QUOTA_EXCEEDED'
    );
    await expect(stager.stageLocal({
      runtimeId: 'a52d2434-5876-46e8-b33c-f967e4959934',
      ...input
    })).resolves.toBeDefined();
  });

  it('cleans all files for a runtime idempotently', async () => {
    const stager = new TerminalImageStager({ rootDirectory: await root() });
    const staged = await stager.stageLocal({
      runtimeId,
      png: Buffer.from('x'),
      width: 1,
      height: 1,
      platform: 'darwin'
    });

    await stager.cleanupRuntime(runtimeId);
    await stager.cleanupRuntime(runtimeId);
    await expect(access(staged.path)).rejects.toBeDefined();
  });

  it('removes only bounded stale inactive runtime directories', async () => {
    const directory = await root();
    const stale = join(directory, 'stale-runtime');
    const fresh = join(directory, 'fresh-runtime');
    await mkdir(stale, { recursive: true });
    await mkdir(fresh, { recursive: true });
    await writeFile(join(stale, 'image.png'), 'old');
    await writeFile(join(fresh, 'image.png'), 'new');
    await utimes(stale, new Date(0), new Date(0));
    const stager = new TerminalImageStager({
      rootDirectory: directory,
      clock: () => new Date('2026-08-12T00:00:00.000Z')
    });

    expect(await stager.cleanupStale({ maxDirectories: 1 })).toBe(1);
    await expect(access(stale)).rejects.toBeDefined();
    await expect(access(fresh)).resolves.toBeUndefined();
  });
});

describe('formatTerminalImageReference', () => {
  it.each(['win32', 'darwin', 'linux'] as const)(
    'does not generate executable commands for %s paths',
    (platform) => {
      const path = platform === 'win32'
        ? 'C:\\Users\\Me\\Lumora Images\\a&b.png'
        : '/home/me/Lumora Images/a;$(b).png';
      expect(formatTerminalImageReference(path, platform)).toBe(
        `[Pasted image: "${path}"]`
      );
    }
  );
});
