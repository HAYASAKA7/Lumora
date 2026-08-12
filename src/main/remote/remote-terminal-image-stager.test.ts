import { access, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtemp } from 'node:fs/promises';

import { afterEach, describe, expect, it, vi } from 'vitest';

import type { RemoteFileTransfer } from './ssh-client';
import { RemoteTerminalImageStager } from './remote-terminal-image-stager';

const roots: string[] = [];
const runtimeId = '5a795d90-06b3-4fca-b9a7-c0d0bf312c1d';

async function root(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), 'lumora-remote-image-'));
  roots.push(path);
  return path;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

function transfer() {
  const existing = new Set<string>();
  const files: RemoteFileTransfer = {
    stat: vi.fn(async (path) => ({
      exists: existing.has(path),
      size: path.endsWith('.upload') ? 7 : null
    })),
    mkdir: vi.fn(async (path) => { existing.add(path); }),
    upload: vi.fn(async (_local, remote) => { existing.add(remote); }),
    chmod: vi.fn(async () => undefined),
    rename: vi.fn(async (from, to) => {
      existing.delete(from);
      existing.add(to);
    }),
    remove: vi.fn(async (path) => { existing.delete(path); }),
    close: vi.fn()
  };
  return files;
}

describe('RemoteTerminalImageStager', () => {
  it('uploads, verifies, protects, and atomically activates a POSIX image', async () => {
    const files = transfer();
    const localRoot = await root();
    const stager = new RemoteTerminalImageStager({ localRootDirectory: localRoot });

    const result = await stager.stage({
      runtimeId,
      png: Buffer.from('1234567'),
      platform: 'linux',
      baseDirectory: '/home/builder',
      files
    });

    expect(result.remotePath).toMatch(
      new RegExp(`^/home/builder/\\.lumora/tmp/terminal-images/${runtimeId}/.+\\.png$`)
    );
    expect(result.pasteText).toBe(`[Pasted image: "${result.remotePath}"]`);
    expect(files.upload).toHaveBeenCalledWith(
      expect.stringMatching(/\.png$/),
      expect.stringMatching(/\.upload$/)
    );
    expect(files.chmod).toHaveBeenCalledWith(expect.stringMatching(/\.upload$/), 0o600);
    expect(files.rename).toHaveBeenCalledWith(
      expect.stringMatching(/\.upload$/),
      result.remotePath
    );
    const localPath = vi.mocked(files.upload).mock.calls[0]![0];
    await expect(access(localPath)).rejects.toBeDefined();
  });

  it('uses remote Windows paths rather than controller paths', async () => {
    const files = transfer();
    const result = await new RemoteTerminalImageStager({
      localRootDirectory: await root()
    }).stage({
      runtimeId,
      png: Buffer.from('1234567'),
      platform: 'win32',
      baseDirectory: 'D:\\Profiles\\builder\\LocalData',
      files
    });

    expect(result.remotePath).toMatch(
      /^D:\\Profiles\\builder\\LocalData\\Lumora\\tmp\\terminal-images\\.+\.png$/
    );
  });

  it('removes the local controller copy and remote upload after verification failure', async () => {
    const files = transfer();
    vi.mocked(files.stat).mockResolvedValue({ exists: true, size: 6 });
    const stager = new RemoteTerminalImageStager({ localRootDirectory: await root() });

    await expect(stager.stage({
      runtimeId,
      png: Buffer.from('1234567'),
      platform: 'darwin',
      baseDirectory: '/Users/builder',
      files
    })).rejects.toThrow('TERMINAL_IMAGE_REMOTE_TRANSFER_FAILED');
    expect(files.remove).toHaveBeenCalledWith(expect.stringMatching(/\.upload$/));
    const localPath = vi.mocked(files.upload).mock.calls[0]![0];
    await expect(access(localPath)).rejects.toBeDefined();
  });

  it('cleans tracked remote images for one runtime idempotently', async () => {
    const files = transfer();
    const stager = new RemoteTerminalImageStager({ localRootDirectory: await root() });
    const result = await stager.stage({
      runtimeId,
      png: Buffer.from('1234567'),
      platform: 'linux',
      baseDirectory: '/home/builder',
      files
    });

    await stager.cleanupRuntime(runtimeId, files);
    await stager.cleanupRuntime(runtimeId, files);
    expect(files.remove).toHaveBeenCalledWith(result.remotePath);
  });

  it('enforces bounded per-runtime staging before another upload begins', async () => {
    const files = transfer();
    const stager = new RemoteTerminalImageStager({
      localRootDirectory: await root(),
      maxFilesPerRuntime: 1
    });
    const input = {
      runtimeId,
      png: Buffer.from('1234567'),
      platform: 'linux' as const,
      baseDirectory: '/home/builder',
      files
    };

    await stager.stage(input);
    await expect(stager.stage(input)).rejects.toThrow('TERMINAL_IMAGE_QUOTA_EXCEEDED');
    expect(files.upload).toHaveBeenCalledTimes(1);
  });
});
