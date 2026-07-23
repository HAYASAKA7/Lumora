import { describe, expect, it, vi } from 'vitest';

import {
  resolveApplicationEnvironment,
  type ShellPathInvocation,
  type ShellPathOutput
} from './login-shell-path';

function successfulPath(
  path: string
): (invocation: ShellPathInvocation) => Promise<ShellPathOutput> {
  return async (invocation) => ({
    stdout: `${invocation.outputStartMarker}\n${path}\n${invocation.outputEndMarker}\n`,
    stderr: '',
    exitCode: 0
  });
}

describe('resolveApplicationEnvironment', () => {
  it('leaves Windows environments unchanged without launching a shell', async () => {
    const env = { PATH: 'C:\\Windows\\System32' };
    const runCommand = vi.fn();

    const resolved = await resolveApplicationEnvironment({
      platform: 'win32',
      env,
      runCommand
    });

    expect(resolved).toBe(env);
    expect(runCommand).not.toHaveBeenCalled();
  });

  it('recovers the macOS login-shell PATH and preserves inherited entries', async () => {
    const runCommand = vi.fn(successfulPath('/opt/homebrew/bin:/usr/local/bin'));

    const resolved = await resolveApplicationEnvironment({
      platform: 'darwin',
      env: { PATH: '/usr/bin:/bin', SHELL: '/bin/zsh', LANG: 'en_US.UTF-8' },
      shellExists: async (path) => path === '/bin/zsh',
      runCommand
    });

    expect(runCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        file: '/bin/zsh',
        args: ['-ilc', expect.any(String)]
      })
    );
    expect(resolved).toEqual({
      PATH: '/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin',
      SHELL: '/bin/zsh',
      LANG: 'en_US.UTF-8'
    });
  });

  it('combines Linux bash interactive and login PATH values with interactive entries first', async () => {
    const runCommand = vi.fn(async (invocation: ShellPathInvocation) => {
      const path =
        invocation.args[0] === '-ic'
          ? '/home/user/.nvm/current/bin:/usr/bin'
          : '/home/user/bin:/usr/local/bin:/usr/bin';
      return successfulPath(path)(invocation);
    });

    const resolved = await resolveApplicationEnvironment({
      platform: 'linux',
      env: { PATH: '/usr/bin:/bin', SHELL: '/bin/bash' },
      shellExists: async (path) => path === '/bin/bash',
      runCommand
    });

    expect(runCommand).toHaveBeenCalledTimes(2);
    expect(runCommand.mock.calls.map(([invocation]) => invocation.args[0])).toEqual([
      '-lc',
      '-ic'
    ]);
    expect(resolved.PATH).toBe(
      '/home/user/.nvm/current/bin:/usr/bin:/home/user/bin:/usr/local/bin:/bin'
    );
  });

  it('falls back to the inherited GUI environment when shell recovery fails', async () => {
    const env = { PATH: '/usr/bin:/bin', SHELL: '/bin/zsh' };

    const resolved = await resolveApplicationEnvironment({
      platform: 'darwin',
      env,
      shellExists: async () => true,
      runCommand: async () => ({
        stdout: 'startup noise without trusted markers',
        stderr: '',
        exitCode: 0
      })
    });

    expect(resolved).toBe(env);
  });

  it('uses a known executable fallback when SHELL is unsafe', async () => {
    const runCommand = vi.fn(successfulPath('/home/user/.local/bin:/usr/bin'));

    const resolved = await resolveApplicationEnvironment({
      platform: 'linux',
      env: { PATH: '/usr/bin', SHELL: 'bash; unexpected-command' },
      shellExists: async (path) => path === '/bin/bash',
      runCommand
    });

    expect(runCommand).toHaveBeenCalledWith(
      expect.objectContaining({ file: '/bin/bash' })
    );
    expect(resolved.PATH).toBe('/home/user/.local/bin:/usr/bin');
  });
});
