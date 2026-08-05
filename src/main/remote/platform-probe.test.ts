import { describe, expect, it, vi } from 'vitest';

import {
  MAX_PLATFORM_PROBE_OUTPUT_BYTES,
  POSIX_PLATFORM_PROBE_COMMAND,
  WINDOWS_PLATFORM_PROBE_COMMAND,
  probeRemotePlatform
} from './platform-probe';

describe('probeRemotePlatform', () => {
  it('normalizes Linux and macOS platform facts from the bounded POSIX probe', async () => {
    const execute = vi.fn().mockResolvedValue({
      exitCode: 0,
      stdout: [
        'LUMORA_KERNEL=Linux',
        'LUMORA_ARCH=aarch64',
        'LUMORA_HOME=/home/builder',
        'LUMORA_SHELL=/bin/bash'
      ].join('\n'),
      stderr: ''
    });

    await expect(probeRemotePlatform(execute)).resolves.toEqual({
      platform: 'linux',
      architecture: 'arm64',
      homeDirectory: '/home/builder',
      helperBaseDirectory: '/home/builder',
      defaultShell: '/bin/bash'
    });
    expect(execute).toHaveBeenCalledWith(POSIX_PLATFORM_PROBE_COMMAND, {
      maxOutputBytes: MAX_PLATFORM_PROBE_OUTPUT_BYTES,
      timeoutMs: 10_000
    });

    execute.mockResolvedValueOnce({
      exitCode: 0,
      stdout: [
        'LUMORA_KERNEL=Darwin',
        'LUMORA_ARCH=x86_64',
        'LUMORA_HOME=/Users/builder',
        'LUMORA_SHELL=/bin/zsh'
      ].join('\n'),
      stderr: ''
    });
    await expect(probeRemotePlatform(execute)).resolves.toMatchObject({
      platform: 'darwin',
      architecture: 'x64'
    });
  });

  it('falls back to a fixed PowerShell probe for Windows OpenSSH', async () => {
    const execute = vi.fn()
      .mockResolvedValueOnce({ exitCode: 1, stdout: '', stderr: 'not found' })
      .mockResolvedValueOnce({
        exitCode: 0,
        stdout: JSON.stringify({
          platform: 'win32',
          architecture: 'AMD64',
          homeDirectory: 'C:\\Users\\builder',
          helperBaseDirectory: 'C:\\Users\\builder\\AppData\\Local',
          defaultShell: 'powershell.exe'
        }),
        stderr: ''
      });

    await expect(probeRemotePlatform(execute)).resolves.toEqual({
      platform: 'win32',
      architecture: 'x64',
      homeDirectory: 'C:\\Users\\builder',
      helperBaseDirectory: 'C:\\Users\\builder\\AppData\\Local',
      defaultShell: 'powershell.exe'
    });
    expect(execute.mock.calls[1]).toEqual([
      WINDOWS_PLATFORM_PROBE_COMMAND,
      { maxOutputBytes: MAX_PLATFORM_PROBE_OUTPUT_BYTES, timeoutMs: 10_000 }
    ]);
  });

  it('rejects successful but malformed and oversized probe output', async () => {
    await expect(probeRemotePlatform(async () => ({
      exitCode: 0,
      stdout: 'LUMORA_KERNEL=Linux',
      stderr: ''
    }))).rejects.toThrow('invalid platform response');

    await expect(probeRemotePlatform(async () => ({
      exitCode: 0,
      stdout: 'x'.repeat(MAX_PLATFORM_PROBE_OUTPUT_BYTES + 1),
      stderr: ''
    }))).rejects.toThrow('output limit');
  });

  it('returns a sanitized failure when neither target probe succeeds', async () => {
    const execute = vi.fn().mockResolvedValue({
      exitCode: 127,
      stdout: '',
      stderr: 'private remote diagnostic'
    });

    await expect(probeRemotePlatform(execute)).rejects.toThrow(
      'Lumora could not identify the remote platform.'
    );
  });
});
