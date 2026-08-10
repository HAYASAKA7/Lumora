import { describe, expect, it } from 'vitest';

import {
  createHelperDirectoryCommand,
  createHelperDigestCommand,
  createRemoteHelperPaths,
  helperLaunchCommand
} from './helper-remote-paths';

describe('remote helper paths', () => {
  it('builds contained per-user POSIX paths and safely quotes apostrophes', () => {
    const paths = createRemoteHelperPaths({
      platform: 'linux',
      baseDirectory: "/home/o'brien",
      helperVersion: '0.1.0',
      temporaryId: 'upload-123'
    });

    expect(paths).toEqual({
      rootDirectory: "/home/o'brien/.lumora/helper",
      versionDirectory: "/home/o'brien/.lumora/helper/0.1.0",
      executablePath: "/home/o'brien/.lumora/helper/0.1.0/lumora-helper",
      temporaryPath: "/home/o'brien/.lumora/helper/0.1.0/.lumora-helper.upload-123.tmp"
    });
    expect(createHelperDirectoryCommand(paths, 'linux')).toContain("o'\"'\"'brien");
    expect(helperLaunchCommand(paths, 'linux', {
      homeDirectory: "/home/o'brien",
      defaultShell: '/bin/zsh'
    })).toBe(
      "HOME='/home/o'\"'\"'brien' SHELL='/bin/zsh' " +
      "LUMORA_LOGIN_SHELL='/bin/zsh' exec " +
      "'/home/o'\"'\"'brien/.lumora/helper/0.1.0/lumora-helper'"
    );
    expect(createHelperDigestCommand(paths.temporaryPath, 'linux'))
      .toContain("sha256sum -- '/home/o'\"'\"'brien");
  });

  it('uses LocalAppData and PowerShell literal quoting on Windows', () => {
    const paths = createRemoteHelperPaths({
      platform: 'win32',
      baseDirectory: "C:\\Users\\O'Brien\\AppData\\Local",
      helperVersion: '0.1.0',
      temporaryId: 'upload-123'
    });

    expect(paths.executablePath).toBe(
      "C:\\Users\\O'Brien\\AppData\\Local\\Lumora\\helper\\0.1.0\\lumora-helper.exe"
    );
    expect(createHelperDirectoryCommand(paths, 'win32')).toContain("O''Brien");
    const launch = helperLaunchCommand(paths, 'win32', {
      homeDirectory: "C:\\Users\\O'Brien",
      defaultShell: 'powershell.exe'
    });
    expect(launch).toContain("$env:HOME = 'C:\\Users\\O''Brien'");
    expect(launch).toContain("$env:USERPROFILE = 'C:\\Users\\O''Brien'");
    expect(launch).toContain("$env:LUMORA_LOGIN_SHELL = 'powershell.exe'");
    expect(launch).toContain("& 'C:\\Users\\O''Brien");
    expect(createHelperDigestCommand(paths.temporaryPath, 'win32'))
      .toContain('Get-FileHash -Algorithm SHA256');
  });

  it('rejects relative bases, control characters, and unsafe versions or IDs', () => {
    const base = {
      platform: 'darwin' as const,
      baseDirectory: '/Users/builder',
      helperVersion: '0.1.0',
      temporaryId: 'upload-123'
    };
    expect(() => createRemoteHelperPaths({ ...base, baseDirectory: 'relative' }))
      .toThrow(/invalid/i);
    expect(() => createRemoteHelperPaths({ ...base, baseDirectory: '/tmp/evil\npath' }))
      .toThrow(/invalid/i);
    expect(() => createRemoteHelperPaths({ ...base, helperVersion: '../current' }))
      .toThrow(/invalid/i);
    expect(() => createRemoteHelperPaths({ ...base, temporaryId: '../escape' }))
      .toThrow(/invalid/i);
  });
});
