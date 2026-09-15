import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { isLaunchableFile, opensAsLaunchable, resolveOpenTarget } from './safe-open';

describe('isLaunchableFile', () => {
  it.each([
    'setup.exe', 'run.BAT', 'tools/script.cmd', 'deploy.ps1', 'Shortcut.lnk', 'site.url', 'app.appref-ms',
    'build.sh', 'start.command', 'Tool.app', 'installer.MSI', 'macro.vbs', 'index.js', 'settings.reg'
  ])('treats %s as something that runs', (path) => {
    expect(isLaunchableFile(path)).toBe(true);
  });

  it.each(['src/index.ts', 'README.md', 'image.png', 'Makefile', 'notes.txt', 'data.json'])(
    'treats %s as a document',
    (path) => {
      expect(isLaunchableFile(path)).toBe(false);
    }
  );
});

describe('opensAsLaunchable', () => {
  it('judges a file by both the name asked for and the file it really is', () => {
    expect(opensAsLaunchable('notes.txt', 'C:\work\tool.exe')).toBe(true);
    expect(opensAsLaunchable('run.bat', '/work/run.txt')).toBe(true);
    expect(opensAsLaunchable('notes.txt', '/work/notes.txt')).toBe(false);
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
