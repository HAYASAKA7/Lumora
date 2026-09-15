import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { isLaunchableFile, opensAsLaunchable, resolveOpenTarget, shouldRevealInstead } from './safe-open';

const windows = { platform: 'win32', pathExt: '.COM;.EXE;.BAT;.CMD' } as const;
const linux = { platform: 'linux', pathExt: undefined } as const;

describe('isLaunchableFile', () => {
  it.each([
    'setup.exe', 'run.BAT', 'tools/script.cmd', 'deploy.ps1', 'Shortcut.lnk', 'site.url', 'app.appref-ms',
    'build.sh', 'start.command', 'Tool.app', 'installer.MSI', 'macro.vbs', 'index.js', 'settings.reg',
    'tool.py', 'gui.PYW', 'task.rb', 'report.pl', 'help.chm', 'addin.xll', 'launch.jnlp', 'setup.zsh',
    'config.fish', 'types.ps1xml', 'plugin.dll', 'driver.sys', 'folder.library-ms', 'console.msc'
  ])('treats %s as something that runs', (path) => {
    expect(isLaunchableFile(path, windows)).toBe(true);
    expect(isLaunchableFile(path, linux)).toBe(true);
  });

  it.each(['src/index.ts', 'README.md', 'image.png', 'Makefile', 'notes.txt', 'data.json'])(
    'treats %s as a document',
    (path) => {
      expect(isLaunchableFile(path, windows)).toBe(false);
      expect(isLaunchableFile(path, linux)).toBe(false);
    }
  );

  it('treats every PATHEXT extension as something that runs on Windows only', () => {
    expect(isLaunchableFile('tool.foo', { platform: 'win32', pathExt: '.COM;.EXE;.FOO' })).toBe(true);
    expect(isLaunchableFile('TOOL.Foo', { platform: 'win32', pathExt: ' .com ; .Foo ;' })).toBe(true);
    expect(isLaunchableFile('tool.foo', { platform: 'win32', pathExt: undefined })).toBe(false);
    expect(isLaunchableFile('tool.foo', { platform: 'linux', pathExt: '.COM;.EXE;.FOO' })).toBe(false);
  });
});

describe('opensAsLaunchable', () => {
  it('judges a file by both the name asked for and the file it really is', () => {
    expect(opensAsLaunchable('notes.txt', 'C:/work/tool.exe', windows)).toBe(true);
    expect(opensAsLaunchable('run.bat', '/work/run.txt', linux)).toBe(true);
    expect(opensAsLaunchable('notes.txt', '/work/notes.txt', linux)).toBe(false);
  });
});

describe('shouldRevealInstead', () => {
  const statWith = (mode: number, isFile = true) => vi.fn(async () => ({ mode, isFile: () => isFile }));

  it('reveals a regular file with any execute bit on macOS and Linux', async () => {
    await expect(shouldRevealInstead('bin/tool', '/work/bin/tool', { ...linux, stat: statWith(0o100744) }))
      .resolves.toBe(true);
    await expect(shouldRevealInstead('bin/tool', '/work/bin/tool', { platform: 'darwin', pathExt: undefined, stat: statWith(0o100601) }))
      .resolves.toBe(true);
    await expect(shouldRevealInstead('src/index.ts', '/work/src/index.ts', { ...linux, stat: statWith(0o100644) }))
      .resolves.toBe(false);
    await expect(shouldRevealInstead('src', '/work/src', { ...linux, stat: statWith(0o40755, false) }))
      .resolves.toBe(false);
  });

  it('reveals a file whose mode cannot be read', async () => {
    const stat = vi.fn(async () => {
      throw new Error('EACCES');
    });
    await expect(shouldRevealInstead('bin/tool', '/work/bin/tool', { ...linux, stat })).resolves.toBe(true);
  });

  it('ignores execute bits on Windows but still judges by name', async () => {
    const stat = statWith(0o100777);
    await expect(shouldRevealInstead('notes.txt', 'C:/work/notes.txt', { ...windows, stat })).resolves.toBe(false);
    await expect(shouldRevealInstead('tool.py', 'C:/work/tool.py', { ...windows, stat })).resolves.toBe(true);
    expect(stat).not.toHaveBeenCalled();
  });

  it.skipIf(process.platform === 'win32')('reveals an extensionless executable on disk', async () => {
    const folder = mkdtempSync(join(tmpdir(), 'lumora-safe-exec-'));
    try {
      writeFileSync(join(folder, 'tool'), '#!/bin/sh\n');
      chmodSync(join(folder, 'tool'), 0o755);
      writeFileSync(join(folder, 'notes'), 'hello');
      chmodSync(join(folder, 'notes'), 0o644);

      await expect(shouldRevealInstead('tool', join(folder, 'tool'))).resolves.toBe(true);
      await expect(shouldRevealInstead('notes', join(folder, 'notes'))).resolves.toBe(false);
    } finally {
      rmSync(folder, { recursive: true, force: true });
    }
  });
});

describe('resolveOpenTarget', () => {
  let root: string;
  let workspace: string;
  let outside: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'lumora-safe-open-'));
    workspace = join(root, 'workspace');
    outside = join(root, 'outside');
    mkdirSync(join(workspace, 'sub'), { recursive: true });
    mkdirSync(outside);
    writeFileSync(join(workspace, 'sub', 'notes.txt'), 'hello');
    writeFileSync(join(outside, 'secret.txt'), 'secret');
    symlinkSync(outside, join(workspace, 'linked'), 'junction');
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('finds a file inside the workspace', async () => {
    await expect(resolveOpenTarget(workspace, 'sub/notes.txt'))
      .resolves.toEqual({ exists: true, path: realpathSync(join(workspace, 'sub', 'notes.txt')) });
  });

  it('returns the real path a link inside the workspace leads to', async (context) => {
    writeFileSync(join(workspace, 'sub', 'build.bat'), '@echo off');
    try {
      symlinkSync(join(workspace, 'sub', 'build.bat'), join(workspace, 'notes.txt'), 'file');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EPERM') {
        context.skip('Creating file symlinks needs privileges on this Windows account.');
      }
      throw error;
    }

    await expect(resolveOpenTarget(workspace, 'notes.txt'))
      .resolves.toEqual({ exists: true, path: realpathSync(join(workspace, 'sub', 'build.bat')) });
  });

  it('refuses paths that leave the workspace by name or through a link', async () => {
    await expect(resolveOpenTarget(workspace, '../outside/secret.txt')).rejects.toThrow();
    await expect(resolveOpenTarget(workspace, 'linked/secret.txt')).rejects.toThrow();
    await expect(resolveOpenTarget(workspace, 'linked/missing.txt')).rejects.toThrow();
  });

  it('points a missing file at its nearest folder inside the workspace', async () => {
    await expect(resolveOpenTarget(workspace, 'sub/deleted.txt'))
      .resolves.toEqual({ exists: false, path: realpathSync(join(workspace, 'sub')) });
    await expect(resolveOpenTarget(workspace, 'gone/deeper/deleted.txt'))
      .resolves.toEqual({ exists: false, path: realpathSync(workspace) });
  });
});
