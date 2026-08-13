import { describe, expect, it, vi } from 'vitest';

import {
  buildProviderLifecycleInvocation,
  runProviderLifecycle,
  type ProviderLifecycleInvocation
} from './provider-lifecycle-runner';

describe('buildProviderLifecycleInvocation', () => {
  it('uses a fixed npm package recipe without a shell on Unix', () => {
    expect(
      buildProviderLifecycleInvocation('gemini', '/usr/bin/npm', {
        platform: 'linux',
        env: {}
      })
    ).toEqual({
      file: '/usr/bin/npm',
      args: [
        'install',
        '--global',
        '@google/gemini-cli@latest'
      ]
    });
  });

  it('guards the fixed npm recipe through a Windows command wrapper', () => {
    expect(
      buildProviderLifecycleInvocation(
        'opencode',
        'C:\\Program Files\\nodejs\\npm.cmd',
        {
          platform: 'win32',
          env: { ComSpec: 'C:\\Windows\\System32\\cmd.exe' }
        }
      )
    ).toEqual({
      file: 'C:\\Windows\\System32\\cmd.exe',
      args: [
        '/d',
        '/s',
        '/c',
        '""C:\\Program Files\\nodejs\\npm.cmd" install --global opencode-ai@latest"'
      ],
      windowsVerbatimArguments: true
    });
  });

  it('rejects guide-only providers and unsafe package-manager paths', () => {
    expect(() =>
      buildProviderLifecycleInvocation('amp', '/usr/bin/npm', {
        platform: 'linux',
        env: {}
      })
    ).toThrow('official installation guide');
    expect(() =>
      buildProviderLifecycleInvocation(
        'gemini',
        'C:\\bad%TEMP%\\npm.cmd',
        { platform: 'win32', env: {} }
      )
    ).toThrow('safely');
  });
});

describe('runProviderLifecycle', () => {
  it('resolves npm then executes only the allowlisted invocation', async () => {
    const execute = vi.fn(
      async (_invocation: ProviderLifecycleInvocation) => undefined
    );
    const findExecutable = vi.fn(async () => '/usr/bin/npm');

    await runProviderLifecycle('copilot', {
      platform: 'linux',
      env: {},
      findExecutable,
      execute
    });

    expect(findExecutable).toHaveBeenCalledWith('npm');
    expect(execute).toHaveBeenCalledWith({
      file: '/usr/bin/npm',
      args: ['install', '--global', '@github/copilot@latest']
    });
  });

  it('returns stable failures without leaking executor output', async () => {
    await expect(
      runProviderLifecycle('crush', {
        platform: 'linux',
        env: {},
        findExecutable: async () => '/usr/bin/npm',
        execute: async () => {
          throw new Error('private registry token');
        }
      })
    ).rejects.toMatchObject({
      code: 'PROVIDER_LIFECYCLE_FAILED',
      message: 'The provider installation could not be completed.'
    });
  });

  it('requires Node 22.19 or newer before installing Kimi Code with npm', async () => {
    const execute = vi.fn(async () => undefined);
    const findExecutable = vi.fn(async (command: string) =>
      command === 'npm' ? '/usr/bin/npm' : '/usr/bin/node'
    );

    await expect(
      runProviderLifecycle('kimi', {
        action: 'install',
        platform: 'linux',
        env: {},
        findExecutable,
        probeVersion: async () => 'v22.18.0',
        execute
      })
    ).rejects.toMatchObject({
      code: 'PROVIDER_PACKAGE_MANAGER_UNAVAILABLE'
    });
    expect(execute).not.toHaveBeenCalled();

    await runProviderLifecycle('kimi', {
      action: 'install',
      platform: 'linux',
      env: {},
      findExecutable,
      probeVersion: async () => 'v22.19.0',
      execute
    });
    expect(execute).toHaveBeenCalledWith({
      file: '/usr/bin/npm',
      args: ['install', '--global', '@moonshot-ai/kimi-code@latest']
    });
  });

  it('does not replace Kimi Code through npm during updates', async () => {
    await expect(
      runProviderLifecycle('kimi', {
        action: 'update',
        platform: 'linux',
        env: {},
        findExecutable: async () => '/usr/bin/npm'
      })
    ).rejects.toMatchObject({ code: 'PROVIDER_INSTALL_GUIDE_REQUIRED' });
  });
});
