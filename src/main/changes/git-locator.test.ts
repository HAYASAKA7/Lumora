import { describe, expect, it, vi } from 'vitest';

import { createGitLocator } from './git-locator';

function harness(platform: 'win32' | 'darwin' | 'linux', results: ReadonlyArray<string | null>) {
  let now = 0;
  let call = 0;
  const locate = vi.fn(async () => results[Math.min(call++, results.length - 1)] ?? null);
  const locator = createGitLocator({ locate, platform, clock: () => now });
  return {
    locate,
    locator,
    advance(milliseconds: number) {
      now += milliseconds;
    }
  };
}

describe('createGitLocator', () => {
  it('keeps a found git for the whole run and shares one lookup between callers', async () => {
    const { advance, locate, locator } = harness('win32', ['C:\\Program Files\\Git\\cmd\\git.exe']);

    const [first, second] = await Promise.all([locator(), locator()]);
    advance(24 * 60 * 60 * 1_000);

    expect(first).toBe('C:\\Program Files\\Git\\cmd\\git.exe');
    expect(second).toBe(first);
    await expect(locator()).resolves.toBe(first);
    expect(locate).toHaveBeenCalledOnce();
  });

  it('looks again a minute after git was not found', async () => {
    const { advance, locate, locator } = harness('linux', [null, '/usr/bin/git']);

    await expect(locator()).resolves.toBeNull();
    advance(59_999);
    await expect(locator()).resolves.toBeNull();
    expect(locate).toHaveBeenCalledOnce();

    advance(1);
    await expect(locator()).resolves.toBe('/usr/bin/git');
    expect(locate).toHaveBeenCalledTimes(2);
  });

  it('treats a failed lookup as not found', async () => {
    const locate = vi.fn(async () => {
      throw new Error('PATH unreadable');
    });
    const locator = createGitLocator({ locate, platform: 'linux', clock: () => 0 });

    await expect(locator()).resolves.toBeNull();
  });

  it.each([
    ['linux', 'git'],
    ['linux', './git'],
    ['win32', 'git.exe'],
    ['win32', 'C:\\Git\\cmd\\git.cmd'],
    ['win32', 'C:\\Git\\cmd\\git.bat'],
    ['win32', 'C:\\Git\\cmd\\git']
  ] as const)('trusts only an absolute git executable (%s: %s)', async (platform, path) => {
    const { locator } = harness(platform, [path]);

    await expect(locator()).resolves.toBeNull();
  });

  it.each([
    ['win32', 'C:\\Git\\cmd\\GIT.EXE'],
    ['darwin', '/opt/homebrew/bin/git']
  ] as const)('accepts %s: %s', async (platform, path) => {
    const { locator } = harness(platform, [path]);

    await expect(locator()).resolves.toBe(path);
  });
});
