import { describe, expect, it } from 'vitest';

import { findExecutable } from './executable-locator';

describe('findExecutable', () => {
  it('uses Windows PATH order and PATHEXT without a shell', async () => {
    const checked: string[] = [];

    const result = await findExecutable('codex', {
      platform: 'win32',
      env: {
        Path: 'C:\\first;C:\\second',
        PATHEXT: '.EXE;.CMD'
      },
      candidateExists: async (candidate) => {
        checked.push(candidate);
        return candidate === 'C:\\second\\codex.CMD';
      }
    });

    expect(result).toBe('C:\\second\\codex.CMD');
    expect(checked).toEqual([
      'C:\\first\\codex.EXE',
      'C:\\first\\codex.CMD',
      'C:\\second\\codex.EXE',
      'C:\\second\\codex.CMD'
    ]);
  });

  it('handles case-insensitive environment names and quoted Windows entries', async () => {
    const result = await findExecutable('claude', {
      platform: 'win32',
      env: {
        PATH: '"C:\\Program Files\\Claude"',
        pathext: '.cmd'
      },
      candidateExists: async (candidate) =>
        candidate === 'C:\\Program Files\\Claude\\claude.cmd'
    });

    expect(result).toBe('C:\\Program Files\\Claude\\claude.cmd');
  });

  it('uses safe Windows executable extensions when PATHEXT is absent', async () => {
    const checked: string[] = [];

    await findExecutable('codex', {
      platform: 'win32',
      env: { Path: 'C:\\tools' },
      candidateExists: async (candidate) => {
        checked.push(candidate);
        return false;
      }
    });

    expect(checked).toEqual([
      'C:\\tools\\codex.EXE',
      'C:\\tools\\codex.COM',
      'C:\\tools\\codex.CMD',
      'C:\\tools\\codex.BAT'
    ]);
  });

  it('checks the exact executable name in Unix PATH order', async () => {
    const checked: string[] = [];

    const result = await findExecutable('claude', {
      platform: 'linux',
      env: { PATH: '/usr/local/bin:/usr/bin' },
      candidateExists: async (candidate) => {
        checked.push(candidate);
        return candidate === '/usr/bin/claude';
      }
    });

    expect(result).toBe('/usr/bin/claude');
    expect(checked).toEqual([
      '/usr/local/bin/claude',
      '/usr/bin/claude'
    ]);
  });

  it('returns null for an absent or empty PATH', async () => {
    const candidateExists = async () => true;

    await expect(
      findExecutable('codex', {
        platform: 'darwin',
        env: {},
        candidateExists
      })
    ).resolves.toBeNull();

    await expect(
      findExecutable('codex', {
        platform: 'linux',
        env: { PATH: '::' },
        candidateExists
      })
    ).resolves.toBeNull();
  });

  it('rejects command names that could escape PATH entries', async () => {
    await expect(
      findExecutable('../codex', {
        platform: 'linux',
        env: { PATH: '/usr/bin' },
        candidateExists: async () => true
      })
    ).rejects.toThrow('simple executable name');
  });
});
