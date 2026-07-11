import { describe, expect, it } from 'vitest';

import { resolvePtyInvocation } from './pty-invocation';

describe('resolvePtyInvocation', () => {
  it('launches native executables directly on every platform', () => {
    expect(
      resolvePtyInvocation({
        platform: 'linux',
        executablePath: '/usr/local/bin/codex',
        args: [],
        env: { SHELL: '/bin/bash' },
        terminalProfile: {
          id: 'a'.repeat(64), kind: 'detected', name: 'Bash',
          shellFamily: 'bash', executablePath: '/bin/bash',
          args: ['-l'], available: true, recommended: true
        }
      })
    ).toEqual({
      executablePath: '/bin/bash',
      args: ['-l', '-c', 'exec "$LUMORA_PROVIDER_EXECUTABLE"'],
      env: {
        SHELL: '/bin/bash',
        LUMORA_PROVIDER_EXECUTABLE: '/usr/local/bin/codex'
      }
    });
  });

  it('uses a fixed Windows command-shim program without interpolating the path', () => {
    const invocation = resolvePtyInvocation({
      platform: 'win32',
      executablePath: 'C:\\Tools & Tests\\codex.cmd',
      args: [],
      env: { ComSpec: 'C:\\Windows\\System32\\cmd.exe' },
      terminalProfile: {
        id: 'a'.repeat(64), kind: 'detected', name: 'Command Prompt',
        shellFamily: 'cmd', executablePath: 'C:\\Windows\\System32\\cmd.exe',
        args: [], available: true, recommended: true
      }
    });

    expect(invocation.executablePath).toBe('C:\\Windows\\System32\\cmd.exe');
    expect(invocation.args).toEqual([
      '/d',
      '/s',
      '/c',
      '""%LUMORA_PROVIDER_EXECUTABLE%""'
    ]);
    expect(invocation.args.join(' ')).not.toContain('Tools & Tests');
    expect(invocation.env.LUMORA_PROVIDER_EXECUTABLE).toBe(
      'C:\\Tools & Tests\\codex.cmd'
    );
  });

  it('launches providers through the selected PowerShell profile', () => {
    const invocation = resolvePtyInvocation({
      platform: 'win32',
      executablePath: 'C:\\Tools & Tests\\claude.cmd',
      args: [],
      env: {},
      terminalProfile: {
        id: 'b'.repeat(64), kind: 'custom', name: 'Project PowerShell',
        shellFamily: 'pwsh', executablePath: 'C:\\tools\\pwsh.exe',
        args: ['-NoProfile'], available: true, recommended: false
      }
    });

    expect(invocation).toEqual({
      executablePath: 'C:\\tools\\pwsh.exe',
      args: [
        '-NoProfile',
        '-NoLogo',
        '-Command',
        '& $env:LUMORA_PROVIDER_EXECUTABLE; exit $LASTEXITCODE'
      ],
      env: {
        LUMORA_PROVIDER_EXECUTABLE: 'C:\\Tools & Tests\\claude.cmd'
      }
    });
  });

  it('rejects command-shim arguments until a non-interpolating adapter exists', () => {
    expect(() =>
      resolvePtyInvocation({
        platform: 'win32',
        executablePath: 'C:\\Tools\\claude.bat',
        args: ['resume', 'native-id'],
        env: {},
        terminalProfile: {
          id: 'a'.repeat(64), kind: 'detected', name: 'PowerShell 7',
          shellFamily: 'pwsh', executablePath: 'C:\\tools\\pwsh.exe',
          args: [], available: true, recommended: true
        }
      })
    ).toThrow('does not accept provider arguments');
  });
});
