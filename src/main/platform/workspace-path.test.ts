import { describe, expect, it, vi } from 'vitest';

import { canonicalizeWorkspacePath } from './workspace-path';

describe('canonicalizeWorkspacePath', () => {
  it('normalizes Windows paths and case-folds only their identity', async () => {
    const pathExists = vi.fn(async () => true);
    const realpath = vi.fn(async () => 'C:\\Dev\\Repo');

    const first = await canonicalizeWorkspacePath(
      'c:\\Dev\\Other\\..\\Repo\\',
      { platform: 'win32', pathExists, realpath }
    );
    const second = await canonicalizeWorkspacePath('C:\\DEV\\REPO', {
      platform: 'win32',
      pathExists,
      realpath: async () => 'C:\\DEV\\REPO'
    });

    expect(first).toMatchObject({
      canonicalPath: 'C:\\Dev\\Repo',
      identityKey: 'c:\\dev\\repo',
      displayName: 'Repo',
      available: true
    });
    expect(first.id).toBe(second.id);
  });

  it('keeps UNC roots valid and removes only non-root trailing separators', async () => {
    const workspace = await canonicalizeWorkspacePath(
      '\\\\Server\\Share\\Repo\\',
      {
        platform: 'win32',
        pathExists: async () => false,
        realpath: async (value) => value
      }
    );
    const root = await canonicalizeWorkspacePath('C:\\', {
      platform: 'win32',
      pathExists: async () => false,
      realpath: async (value) => value
    });

    expect(workspace.canonicalPath).toBe('\\\\Server\\Share\\Repo');
    expect(workspace.identityKey).toBe('\\\\server\\share\\repo');
    expect(root.canonicalPath).toBe('C:\\');
  });

  it.each(['darwin', 'linux'] as const)(
    'preserves case-sensitive identity on %s',
    async (platform) => {
      const upper = await canonicalizeWorkspacePath('/work/Repo', {
        platform,
        pathExists: async () => false,
        realpath: async (value) => value
      });
      const lower = await canonicalizeWorkspacePath('/work/repo', {
        platform,
        pathExists: async () => false,
        realpath: async (value) => value
      });

      expect(upper.identityKey).toBe('/work/Repo');
      expect(lower.identityKey).toBe('/work/repo');
      expect(upper.id).not.toBe(lower.id);
    }
  );

  it('uses the real path for an available symlink', async () => {
    const workspace = await canonicalizeWorkspacePath('/work/link', {
      platform: 'linux',
      pathExists: async () => true,
      realpath: async () => '/srv/repos/lumora'
    });

    expect(workspace).toMatchObject({
      canonicalPath: '/srv/repos/lumora',
      identityKey: '/srv/repos/lumora',
      displayName: 'lumora',
      available: true
    });
  });

  it('retains a normalized unavailable path without calling realpath', async () => {
    const realpath = vi.fn(async (value: string) => value);
    const workspace = await canonicalizeWorkspacePath('/work/old/../moved/', {
      platform: 'linux',
      pathExists: async () => false,
      realpath
    });

    expect(workspace).toMatchObject({
      canonicalPath: '/work/moved',
      identityKey: '/work/moved',
      displayName: 'moved',
      available: false
    });
    expect(realpath).not.toHaveBeenCalled();
  });

  it('preserves filesystem roots', async () => {
    const root = await canonicalizeWorkspacePath('/', {
      platform: 'linux',
      pathExists: async () => false,
      realpath: async (value) => value
    });

    expect(root.canonicalPath).toBe('/');
    expect(root.displayName).toBe('/');
  });

  it('rejects relative, empty, NUL-containing, and invalid real paths', async () => {
    const options = {
      platform: 'linux' as const,
      pathExists: async () => false,
      realpath: async (value: string) => value
    };

    await expect(canonicalizeWorkspacePath('repo', options)).rejects.toThrow(
      'absolute'
    );
    await expect(canonicalizeWorkspacePath('', options)).rejects.toThrow(
      'absolute'
    );
    await expect(
      canonicalizeWorkspacePath('/work/\0repo', options)
    ).rejects.toThrow('NUL');
    await expect(
      canonicalizeWorkspacePath('/work/link', {
        ...options,
        pathExists: async () => true,
        realpath: async () => 'relative/result'
      })
    ).rejects.toThrow('absolute');
  });
});
