import { describe, expect, it, vi } from 'vitest';

import type { RemoteCommandExecutor } from './platform-probe';
import type { RemoteFileTransfer } from './ssh-client';
import {
  inspectRemoteHelper,
  installRemoteHelper
} from './helper-installer';
import { createRemoteHelperPaths } from './helper-remote-paths';

const digest = 'a'.repeat(64);
const paths = createRemoteHelperPaths({
  platform: 'linux',
  baseDirectory: '/home/builder',
  helperVersion: '0.1.0',
  temporaryId: 'upload-123'
});

function files(overrides: Partial<RemoteFileTransfer> = {}): RemoteFileTransfer {
  return {
    stat: vi.fn().mockResolvedValue({ exists: false, size: null }),
    mkdir: vi.fn().mockResolvedValue(undefined),
    upload: vi.fn().mockResolvedValue(undefined),
    chmod: vi.fn().mockResolvedValue(undefined),
    rename: vi.fn().mockResolvedValue(undefined),
    remove: vi.fn().mockResolvedValue(undefined),
    close: vi.fn(),
    ...overrides
  };
}

function executor(hash = digest): RemoteCommandExecutor {
  return vi.fn().mockImplementation(async (command: string) => ({
    exitCode: 0,
    stdout: command.includes('mkdir') ? '' : `${hash}  helper\n`,
    stderr: ''
  }));
}

const artifact = {
  helperVersion: '0.1.0',
  protocolVersion: 1,
  platform: 'linux' as const,
  architecture: 'x64' as const,
  absolutePath: 'D:\\Lumora\\resources\\helper',
  size: 42,
  sha256: digest,
  capabilities: ['system-info' as const]
};

describe('remote helper installer', () => {
  it('distinguishes missing, exact, and invalid installed artifacts', async () => {
    await expect(inspectRemoteHelper({
      files: files(), execute: executor(), paths, artifact
    })).resolves.toMatchObject({ status: 'missing' });

    await expect(inspectRemoteHelper({
      files: files({ stat: vi.fn().mockResolvedValue({ exists: true, size: 42 }) }),
      execute: executor(), paths, artifact
    })).resolves.toMatchObject({ status: 'installed' });

    await expect(inspectRemoteHelper({
      files: files({ stat: vi.fn().mockResolvedValue({ exists: true, size: 9 }) }),
      execute: executor(), paths, artifact
    })).resolves.toMatchObject({ status: 'invalid' });

    await expect(inspectRemoteHelper({
      files: files({ stat: vi.fn().mockResolvedValue({ exists: true, size: 42 }) }),
      execute: executor('b'.repeat(64)), paths, artifact
    })).resolves.toMatchObject({ status: 'invalid' });
  });

  it('uploads, verifies, chmods, and atomically activates a missing Unix helper', async () => {
    const transfer = files({
      stat: vi.fn()
        .mockResolvedValueOnce({ exists: false, size: null })
        .mockResolvedValueOnce({ exists: true, size: 42 })
    });
    const execute = executor();

    await installRemoteHelper({
      files: transfer,
      execute,
      paths,
      artifact,
      replaceExisting: false
    });

    expect(transfer.upload).toHaveBeenCalledWith(
      artifact.absolutePath,
      paths.temporaryPath
    );
    expect(transfer.chmod).toHaveBeenCalledWith(paths.temporaryPath, 0o700);
    expect(transfer.rename).toHaveBeenCalledWith(
      paths.temporaryPath,
      paths.executablePath
    );
    expect(transfer.remove).not.toHaveBeenCalledWith(paths.executablePath);
  });

  it('requires replacement permission and removes an invalid destination only after verification', async () => {
    const transfer = files({
      stat: vi.fn()
        .mockResolvedValueOnce({ exists: true, size: 9 })
        .mockResolvedValueOnce({ exists: true, size: 9 })
        .mockResolvedValueOnce({ exists: true, size: 42 })
    });

    await expect(installRemoteHelper({
      files: transfer,
      execute: executor(),
      paths,
      artifact,
      replaceExisting: false
    })).rejects.toMatchObject({ code: 'REPLACEMENT_REQUIRED' });

    await installRemoteHelper({
      files: transfer,
      execute: executor(),
      paths,
      artifact,
      replaceExisting: true
    });
    expect(transfer.remove).toHaveBeenCalledWith(paths.executablePath);
    expect(transfer.rename).toHaveBeenCalled();
  });

  it('cleans a temporary upload without masking the original failure', async () => {
    const transfer = files({
      stat: vi.fn()
        .mockResolvedValueOnce({ exists: false, size: null })
        .mockRejectedValueOnce(new Error('private stat failure')),
      remove: vi.fn().mockRejectedValue(new Error('private cleanup failure'))
    });

    await expect(installRemoteHelper({
      files: transfer,
      execute: executor(),
      paths,
      artifact,
      replaceExisting: false
    })).rejects.toMatchObject({ code: 'INSTALL_FAILED' });
    expect(transfer.remove).toHaveBeenCalledWith(paths.temporaryPath);
  });
});
