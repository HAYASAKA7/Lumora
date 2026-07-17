import { describe, expect, it, vi } from 'vitest';

import {
  buildProviderUpdateInvocation,
  updateProviderExecutable,
  type ProviderUpdateInvocation
} from './provider-updater';

describe('buildProviderUpdateInvocation', () => {
  it.each([
    ['linux' as const, '/usr/local/bin/codex'],
    ['darwin' as const, '/opt/homebrew/bin/claude']
  ])('runs a native %s executable directly', (platform, executablePath) => {
    expect(
      buildProviderUpdateInvocation(executablePath, { platform, env: {} })
    ).toEqual({ file: executablePath, args: ['update'] });
  });

  it('runs a native Windows executable directly', () => {
    expect(
      buildProviderUpdateInvocation('C:\\tools\\codex.exe', {
        platform: 'win32',
        env: {}
      })
    ).toEqual({ file: 'C:\\tools\\codex.exe', args: ['update'] });
  });

  it.each(['cmd', 'bat'])('guards a Windows .%s wrapper invocation', (extension) => {
    const path = `C:\\Program Files\\Claude\\claude.${extension}`;
    expect(
      buildProviderUpdateInvocation(path, {
        platform: 'win32',
        env: { ComSpec: 'C:\\Windows\\System32\\cmd.exe' }
      })
    ).toEqual({
      file: 'C:\\Windows\\System32\\cmd.exe',
      args: ['/d', '/s', '/c', `""${path}" update"`],
      windowsVerbatimArguments: true
    });
  });

  it.each([
    ['linux' as const, 'codex'],
    ['win32' as const, 'C:\\bad%TEMP%\\codex.cmd'],
    ['win32' as const, 'C:\\bad"path\\codex.cmd']
  ])('rejects unsafe executable path %s %s', (platform, executablePath) => {
    expect(() =>
      buildProviderUpdateInvocation(executablePath, { platform, env: {} })
    ).toThrow();
  });
});

describe('updateProviderExecutable', () => {
  it('executes only the guarded invocation', async () => {
    const execute = vi.fn(async (_invocation: ProviderUpdateInvocation) => undefined);

    await updateProviderExecutable('/usr/bin/codex', {
      platform: 'linux',
      env: {},
      execute
    });

    expect(execute).toHaveBeenCalledWith({
      file: '/usr/bin/codex',
      args: ['update']
    });
  });

  it('hides executor details behind a stable failure', async () => {
    await expect(
      updateProviderExecutable('/usr/bin/claude', {
        platform: 'linux',
        env: {},
        execute: async () => {
          throw new Error('secret command output');
        }
      })
    ).rejects.toMatchObject({
      code: 'PROVIDER_UPDATE_FAILED',
      message: 'The provider update could not be completed.'
    });
  });
});
