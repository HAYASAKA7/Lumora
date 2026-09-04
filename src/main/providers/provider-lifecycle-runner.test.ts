import { describe, expect, it, vi } from 'vitest';

import {
  buildProviderLifecycleInvocation,
  classifyLifecycleFailure,
  ProviderLifecycleError,
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
      args: ['install', '--global', '@moonshot-ai/kimi-code@latest'],
      runtimePath: '/usr/bin'
    });
  });

  it('uses the Node installation it verified when npm comes from another prefix', async () => {
    const execute = vi.fn(async () => undefined);
    await runProviderLifecycle('kimi', {
      platform: 'win32',
      env: { PATH: 'C:\\OldNode;D:\\npm-global' },
      findExecutable: async (command) =>
        command === 'node'
          ? 'C:\\VerifiedNode\\node.exe'
          : 'D:\\npm-global\\npm.cmd',
      probeVersion: async () => 'v24.0.0',
      execute
    });

    expect(execute).toHaveBeenCalledWith(expect.objectContaining({
      runtimePath: 'C:\\VerifiedNode'
    }));
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

  it('reports a running provider separately from an ordinary failure', async () => {
    await expect(
      runProviderLifecycle('codex', {
        platform: 'win32',
        env: { ComSpec: 'C:\\Windows\\system32\\cmd.exe' },
        findExecutable: async () => 'C:\\npm\\npm.cmd',
        execute: async () => {
          throw new ProviderLifecycleError('PROVIDER_LIFECYCLE_BUSY');
        }
      })
    ).rejects.toMatchObject({ code: 'PROVIDER_LIFECYCLE_BUSY' });
  });

  it('stops the lifecycle when the caller cancels it', async () => {
    const controller = new AbortController();
    const execute = vi.fn(async () => {
      controller.abort();
      throw new ProviderLifecycleError('PROVIDER_LIFECYCLE_CANCELLED');
    });

    await expect(
      runProviderLifecycle('copilot', {
        platform: 'linux',
        env: {},
        findExecutable: async () => '/usr/bin/npm',
        signal: controller.signal,
        execute
      })
    ).rejects.toMatchObject({ code: 'PROVIDER_LIFECYCLE_CANCELLED' });
  });

  it('refuses to start once the caller has already cancelled', async () => {
    const controller = new AbortController();
    controller.abort();
    const execute = vi.fn(async () => undefined);

    await expect(
      runProviderLifecycle('copilot', {
        platform: 'linux',
        env: {},
        findExecutable: async () => '/usr/bin/npm',
        signal: controller.signal,
        execute
      })
    ).rejects.toMatchObject({ code: 'PROVIDER_LIFECYCLE_CANCELLED' });
    expect(execute).not.toHaveBeenCalled();
  });
});

describe('classifyLifecycleFailure', () => {
  /**
   * npm output can carry registry credentials, so the text never reaches the
   * user. Only the shape of the failure is read out of it.
   */
  it('recognizes a package whose files are held open', () => {
    expect(classifyLifecycleFailure(
      'npm error code EBUSY\nnpm error syscall rename\n' +
      "npm error EBUSY: resource busy or locked, rename 'codex.exe'"
    )).toBe('busy');
    expect(classifyLifecycleFailure(
      'npm error code EPERM\nnpm error errno -4048'
    )).toBe('busy');
  });

  it('treats every other failure as an ordinary one', () => {
    expect(classifyLifecycleFailure('npm error code E404')).toBe('failed');
    expect(classifyLifecycleFailure('')).toBe('failed');
    expect(classifyLifecycleFailure('npm error code ENOTFOUND registry'))
      .toBe('failed');
  });
});
