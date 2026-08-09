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
      runCommand,
      readWindowsUserEnvironment: async () => ({})
    });

    expect(resolved).toBe(env);
    expect(runCommand).not.toHaveBeenCalled();
  });

  it('fills missing Claude authentication variables from the current Windows user environment', async () => {
    const resolved = await resolveApplicationEnvironment({
      platform: 'win32',
      env: { PATH: 'C:\\Windows\\System32' },
      readWindowsUserEnvironment: async () => ({
        ANTHROPIC_API_KEY: 'windows-api-key',
        ANTHROPIC_AUTH_TOKEN: 'windows-auth-token',
        ANTHROPIC_BASE_URL: 'https://gateway.example.test'
      })
    });

    expect(resolved).toMatchObject({
      ANTHROPIC_API_KEY: 'windows-api-key',
      ANTHROPIC_AUTH_TOKEN: 'windows-auth-token',
      ANTHROPIC_BASE_URL: 'https://gateway.example.test'
    });
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

  it('recovers missing Claude authentication variables from the login shell', async () => {
    const runCommand = vi.fn(async (invocation: ShellPathInvocation) => ({
      stdout: [
        invocation.outputStartMarker,
        '/opt/homebrew/bin:/usr/bin',
        invocation.outputEndMarker,
        '__LUMORA_PROVIDER_ENV_BEGIN_5E76A1B2__',
        'ANTHROPIC_API_KEY=recovered-api-key',
        'ANTHROPIC_AUTH_TOKEN=recovered-auth-token',
        'ANTHROPIC_BASE_URL=https://gateway.example.test',
        '__LUMORA_PROVIDER_ENV_END_5E76A1B2__'
      ].join('\n'),
      stderr: '',
      exitCode: 0
    }));

    const resolved = await resolveApplicationEnvironment({
      platform: 'darwin',
      env: {
        PATH: '/usr/bin:/bin',
        SHELL: '/bin/zsh',
        ANTHROPIC_API_KEY: 'inherited-api-key'
      },
      shellExists: async (path) => path === '/bin/zsh',
      runCommand
    });

    expect(resolved).toMatchObject({
      ANTHROPIC_API_KEY: 'inherited-api-key',
      ANTHROPIC_AUTH_TOKEN: 'recovered-auth-token',
      ANTHROPIC_BASE_URL: 'https://gateway.example.test'
    });
  });

  it('rejects a malformed provider environment block instead of accepting partial secrets', async () => {
    const runCommand = vi.fn(async (invocation: ShellPathInvocation) => ({
      stdout: [
        invocation.outputStartMarker,
        '/usr/local/bin:/usr/bin',
        invocation.outputEndMarker,
        '__LUMORA_PROVIDER_ENV_BEGIN_5E76A1B2__',
        'ANTHROPIC_API_KEY=partial-secret',
        'injected-line',
        'ANTHROPIC_AUTH_TOKEN=auth-token',
        'ANTHROPIC_BASE_URL=https://gateway.example.test',
        '__LUMORA_PROVIDER_ENV_END_5E76A1B2__'
      ].join('\n'),
      stderr: '',
      exitCode: 0
    }));

    const resolved = await resolveApplicationEnvironment({
      platform: 'linux',
      env: { PATH: '/usr/bin', SHELL: '/bin/zsh' },
      shellExists: async (path) => path === '/bin/zsh',
      runCommand
    });

    expect(resolved).not.toHaveProperty('ANTHROPIC_API_KEY');
    expect(resolved).not.toHaveProperty('ANTHROPIC_AUTH_TOKEN');
    expect(resolved).not.toHaveProperty('ANTHROPIC_BASE_URL');
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
