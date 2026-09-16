import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { fileOpenSafety, openSafetyByName, openSafetyFor, resolveOpenTarget } from './safe-open';

const windows = { platform: 'win32', pathExt: '.COM;.EXE;.BAT;.CMD' } as const;
const linux = { platform: 'linux', pathExt: undefined } as const;

describe('fileOpenSafety', () => {
  it.each([
    'setup.exe', 'run.BAT', 'tools/script.cmd', 'Shortcut.lnk', 'site.url', 'app.appref-ms',
    'start.command', 'Tool.app', 'installer.MSI', 'settings.reg', 'cache.pyc',
    'help.chm', 'addin.xll', 'launch.jnlp', 'plugin.dll', 'driver.sys', 'folder.library-ms',
    'console.msc', 'Shell.terminal', 'Link.webloc', 'Build.workflow', 'Installer.pkg', 'Disk.DMG',
    'Doc.fileloc', 'Site.inetloc', 'Step.action', 'Bundle.mpkg', 'tool.deb', 'tool.rpm',
    'Tool.AppImage', 'installer.run', 'app.flatpakref', 'repo.flatpakrepo', 'tool.snap'
  ])('never opens %s', (path) => {
    expect(fileOpenSafety(path, windows)).toBe('reveal');
    expect(fileOpenSafety(path, linux)).toBe('reveal');
  });

  it.each([
    'tool.py', 'gui.PYW', 'bundle.pyz', 'task.rb', 'report.pl', 'deploy.ps1', 'module.psm1',
    'types.ps1xml', 'console.psc1', 'build.sh', 'setup.zsh', 'run.bash', 'config.fish', 'old.csh',
    'old.ksh', 'macro.vbs', 'macro.vbe', 'form.vb', 'index.js', 'macro.jse', 'task.wsf', 'task.wsh',
    'task.ws', 'types.mof', 'script.scpt', 'app.desktop'
  ])('asks before opening %s', (path) => {
    expect(fileOpenSafety(path, windows)).toBe('confirm');
    expect(fileOpenSafety(path, linux)).toBe('confirm');
  });

  it.each(['src/index.ts', 'README.md', 'image.png', 'Makefile', 'notes.txt', 'data.json', 'style.css'])(
    'opens %s',
    (path) => {
      expect(fileOpenSafety(path, windows)).toBe('open');
      expect(fileOpenSafety(path, linux)).toBe('open');
    }
  );

  it('never opens a PATHEXT extension, and only on Windows', () => {
    expect(fileOpenSafety('tool.foo', { platform: 'win32', pathExt: '.COM;.EXE;.FOO' })).toBe('reveal');
    expect(fileOpenSafety('TOOL.Foo', { platform: 'win32', pathExt: ' .com ; .Foo ;' })).toBe('reveal');
    expect(fileOpenSafety('tool.foo', { platform: 'win32', pathExt: undefined })).toBe('open');
    expect(fileOpenSafety('tool.foo', { platform: 'linux', pathExt: '.COM;.EXE;.FOO' })).toBe('open');
  });

  it('still asks about a script that PATHEXT lists, as Python installs do', () => {
    expect(fileOpenSafety('tool.py', { platform: 'win32', pathExt: '.COM;.EXE;.PY;.PYW' })).toBe('confirm');
    expect(fileOpenSafety('gui.pyw', { platform: 'win32', pathExt: '.COM;.EXE;.PY;.PYW' })).toBe('confirm');
    expect(fileOpenSafety('cache.pyc', { platform: 'win32', pathExt: '.COM;.EXE;.PY' })).toBe('reveal');
  });
});

describe('openSafetyByName', () => {
  it('judges a file by both the name asked for and the file it really is, strictest first', () => {
    expect(openSafetyByName('notes.txt', 'C:/work/tool.exe', windows)).toBe('reveal');
    expect(openSafetyByName('run.bat', '/work/run.txt', linux)).toBe('reveal');
    expect(openSafetyByName('notes.txt', '/work/tool.py', linux)).toBe('confirm');
    expect(openSafetyByName('tool.py', '/work/tool.exe', linux)).toBe('reveal');
    expect(openSafetyByName('notes.txt', '/work/notes.txt', linux)).toBe('open');
  });
});

describe('openSafetyFor', () => {
  const statWith = (mode: number, isFile = true) => vi.fn(async () => ({ mode, isFile: () => isFile }));

  it('reveals a regular file with any execute bit on macOS and Linux', async () => {
    await expect(openSafetyFor('bin/tool', '/work/bin/tool', { ...linux, stat: statWith(0o100744) }))
      .resolves.toBe('reveal');
    await expect(openSafetyFor('bin/tool', '/work/bin/tool', { platform: 'darwin', pathExt: undefined, stat: statWith(0o100601) }))
      .resolves.toBe('reveal');
    // An executable script is shown rather than asked about, since the bit says it is meant to run.
    await expect(openSafetyFor('run.py', '/work/run.py', { ...linux, stat: statWith(0o100755) }))
      .resolves.toBe('reveal');
    await expect(openSafetyFor('run.py', '/work/run.py', { ...linux, stat: statWith(0o100644) }))
      .resolves.toBe('confirm');
    await expect(openSafetyFor('src/index.ts', '/work/src/index.ts', { ...linux, stat: statWith(0o100644) }))
      .resolves.toBe('open');
    await expect(openSafetyFor('src', '/work/src', { ...linux, stat: statWith(0o40755, false) }))
      .resolves.toBe('open');
  });

  it('reveals a file whose mode cannot be read', async () => {
    const stat = vi.fn(async () => {
      throw new Error('EACCES');
    });
    await expect(openSafetyFor('bin/tool', '/work/bin/tool', { ...linux, stat })).resolves.toBe('reveal');
  });

  it('ignores execute bits on Windows but still judges by name', async () => {
    const stat = statWith(0o100777);
    await expect(openSafetyFor('notes.txt', 'C:/work/notes.txt', { ...windows, stat })).resolves.toBe('open');
    await expect(openSafetyFor('tool.py', 'C:/work/tool.py', { ...windows, stat })).resolves.toBe('confirm');
    await expect(openSafetyFor('tool.exe', 'C:/work/tool.exe', { ...windows, stat })).resolves.toBe('reveal');
    expect(stat).not.toHaveBeenCalled();
  });

  it.skipIf(process.platform === 'win32')('reveals an extensionless executable on disk', async () => {
    const folder = mkdtempSync(join(tmpdir(), 'lumora-safe-exec-'));
    try {
      writeFileSync(join(folder, 'tool'), '#!/bin/sh\n');
      chmodSync(join(folder, 'tool'), 0o755);
      writeFileSync(join(folder, 'notes'), 'hello');
      chmodSync(join(folder, 'notes'), 0o644);

      await expect(openSafetyFor('tool', join(folder, 'tool'))).resolves.toBe('reveal');
      await expect(openSafetyFor('notes', join(folder, 'notes'))).resolves.toBe('open');
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

  it('follows a directory link inside the workspace to the file it really holds', async () => {
    writeFileSync(join(workspace, 'sub', 'build.bat'), '@echo off');
    // A junction needs no privileges on Windows, so this link case runs everywhere.
    symlinkSync(join(workspace, 'sub'), join(workspace, 'mirror'), 'junction');

    const target = await resolveOpenTarget(workspace, 'mirror/build.bat');

    expect(target).toEqual({ exists: true, path: realpathSync(join(workspace, 'sub', 'build.bat')) });
    await expect(openSafetyFor('mirror/build.bat', target.path)).resolves.toBe('reveal');
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
