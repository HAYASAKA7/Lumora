import { describe, expect, it, vi } from 'vitest';

import {
  buildVersionInvocation,
  probeVersion,
  type VersionInvocation
} from './version-probe';

describe('buildVersionInvocation', () => {
  it('runs native Unix executables directly with a constant argument', () => {
    expect(
      buildVersionInvocation('/usr/local/bin/codex', {
        platform: 'linux',
        env: {}
      })
    ).toEqual({
      file: '/usr/local/bin/codex',
      args: ['--version']
    });
  });

  it('runs native Windows executables directly', () => {
    expect(
      buildVersionInvocation('C:\\tools\\claude.exe', {
        platform: 'win32',
        env: {}
      })
    ).toEqual({
      file: 'C:\\tools\\claude.exe',
      args: ['--version']
    });
  });

  it('routes Windows command wrappers through the configured command processor', () => {
    expect(
      buildVersionInvocation('C:\\Program Files\\Codex\\codex.cmd', {
        platform: 'win32',
        env: { ComSpec: 'C:\\Windows\\System32\\cmd.exe' }
      })
    ).toEqual({
      file: 'C:\\Windows\\System32\\cmd.exe',
      windowsVerbatimArguments: true,
      args: [
        '/d',
        '/s',
        '/c',
        '""C:\\Program Files\\Codex\\codex.cmd" --version"'
      ]
    });
  });

  it('rejects wrapper paths that could break command quoting', () => {
    for (const executablePath of [
      'C:\\bad"path\\codex.cmd',
      'C:\\bad\npath\\codex.cmd',
      'C:\\%TEMP%\\codex.cmd'
    ]) {
      expect(() =>
        buildVersionInvocation(executablePath, {
          platform: 'win32',
          env: {}
        })
      ).toThrow('cannot be invoked safely');
    }
  });
});

describe('probeVersion', () => {
  it('returns the first non-empty stdout line', async () => {
    const execute = vi.fn(async (_invocation: VersionInvocation) => ({
      stdout: '\n  codex-cli 1.2.3  \nextra detail',
      stderr: ''
    }));

    await expect(
      probeVersion('/usr/bin/codex', {
        platform: 'linux',
        env: {},
        execute
      })
    ).resolves.toBe('codex-cli 1.2.3');
    expect(execute).toHaveBeenCalledWith({
      file: '/usr/bin/codex',
      args: ['--version']
    });
  });

  it('falls back to stderr and caps public output', async () => {
    const longVersion = `Claude Code ${'x'.repeat(300)}`;

    const version = await probeVersion('/usr/bin/claude', {
      platform: 'darwin',
      env: {},
      execute: async () => ({ stdout: '', stderr: longVersion })
    });

    expect(version).toHaveLength(256);
    expect(version.startsWith('Claude Code')).toBe(true);
  });

  it('rejects blank output and execution failures with a stable internal code', async () => {
    await expect(
      probeVersion('/usr/bin/codex', {
        platform: 'linux',
        env: {},
        execute: async () => ({ stdout: '  ', stderr: '\n' })
      })
    ).rejects.toMatchObject({ code: 'VERSION_PROBE_FAILED' });

    await expect(
      probeVersion('/usr/bin/codex', {
        platform: 'linux',
        env: {},
        execute: async () => {
          throw new Error('secret process detail');
        }
      })
    ).rejects.toMatchObject({
      code: 'VERSION_PROBE_FAILED',
      message: 'The provider version command failed.'
    });
  });
});
