import { describe, expect, it } from 'vitest';

import { resolvePtyInvocation } from './pty-invocation';

describe('resolvePtyInvocation', () => {
  it('launches native executables directly on every platform', () => {
    expect(
      resolvePtyInvocation({
        platform: 'linux',
        executablePath: '/usr/local/bin/codex',
        args: [],
        command: null,
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
      command: null,
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

  it('quotes the fixed handoff prompt for a Windows command shim', () => {
    const prompt = 'Read context at C:\\Users\\Test User\\Lumora\\context';
    const invocation = resolvePtyInvocation({
      platform: 'win32',
      executablePath: 'C:\\Tools\\codex.cmd',
      args: [prompt],
      command: null,
      env: { ComSpec: 'C:\\Windows\\System32\\cmd.exe' },
      terminalProfile: {
        id: 'a'.repeat(64), kind: 'detected', name: 'Command Prompt',
        shellFamily: 'cmd', executablePath: 'C:\\Windows\\System32\\cmd.exe',
        args: [], available: true, recommended: true
      }
    });

    expect(invocation.args.at(-1)).toBe(
      'call "%LUMORA_PROVIDER_EXECUTABLE%" "Read context at C:\\Users\\Test User\\Lumora\\context"'
    );
    const unsafePrompt = 'Compare A & B and %VALUE%!';
    const unsafeInvocation = resolvePtyInvocation({
      platform: 'win32',
      executablePath: 'C:\\Tools\\codex.cmd',
      args: [unsafePrompt],
      command: null,
      env: { SystemRoot: 'C:\\Windows' },
      terminalProfile: {
        id: 'a'.repeat(64), kind: 'detected', name: 'Command Prompt',
        shellFamily: 'cmd', executablePath: 'cmd.exe', args: [],
        available: true, recommended: true
      },
      isExecutableFile: (path) => path === 'C:\\Tools\\codex.ps1'
    });
    expect(unsafeInvocation.executablePath).toBe(
      'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe'
    );
    expect(unsafeInvocation.args.join(' ')).not.toContain(unsafePrompt);
    expect(unsafeInvocation.env.LUMORA_PROVIDER_ARGUMENTS).toBe(
      JSON.stringify([unsafePrompt])
    );
    expect(unsafeInvocation.env.LUMORA_PROVIDER_EXECUTABLE).toBe(
      'C:\\Tools\\codex.ps1'
    );
  });

  it('rejects unsafe arguments for a batch provider without a safe shim', () => {
    expect(() => resolvePtyInvocation({
      platform: 'win32',
      executablePath: 'C:\\Tools\\codex.bat',
      args: ['Compare A & B and %VALUE%!'],
      command: null,
      env: { SystemRoot: 'C:\\Windows' },
      terminalProfile: {
        id: 'a'.repeat(64), kind: 'custom', name: 'Native host',
        shellFamily: 'other', executablePath: 'native', args: [],
        available: true, recommended: false
      },
      isExecutableFile: () => false
    })).toThrow('cannot safely pass');
  });

  it('launches a native provider directly when cmd cannot preserve its arguments', () => {
    const prompt = 'Compare A & B and %VALUE%!';
    const invocation = resolvePtyInvocation({
      platform: 'win32',
      executablePath: 'C:\\Tools\\codex.exe',
      args: [prompt],
      command: null,
      env: { SystemRoot: 'C:\\Windows' },
      terminalProfile: {
        id: 'a'.repeat(64), kind: 'detected', name: 'Command Prompt',
        shellFamily: 'cmd', executablePath: 'cmd.exe', args: [],
        available: true, recommended: true
      }
    });

    expect(invocation).toEqual({
      executablePath: 'C:\\Tools\\codex.exe',
      args: [prompt],
      env: { SystemRoot: 'C:\\Windows' }
    });
  });

  it('does not reinterpret a custom cmd command under another shell', () => {
    expect(() => resolvePtyInvocation({
      platform: 'win32',
      executablePath: 'C:\\Tools\\codex.cmd',
      args: ['Compare A & B and %VALUE%!'],
      command: 'set MODE=review & codexp',
      env: { SystemRoot: 'C:\\Windows' },
      terminalProfile: {
        id: 'a'.repeat(64), kind: 'detected', name: 'Command Prompt',
        shellFamily: 'cmd', executablePath: 'cmd.exe', args: [],
        available: true, recommended: true
      }
    })).toThrow('cannot safely pass');
  });

  it('launches providers through the selected PowerShell profile', () => {
    const invocation = resolvePtyInvocation({
      platform: 'win32',
      executablePath: 'C:\\Tools & Tests\\claude.cmd',
      args: [],
      command: null,
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

  it('evaluates a custom command through the selected PowerShell profile', () => {
    const invocation = resolvePtyInvocation({
      platform: 'win32',
      executablePath: 'C:\\Tools\\codex.cmd',
      args: [],
      command: 'codexp',
      env: {},
      terminalProfile: {
        id: 'b'.repeat(64), kind: 'detected', name: 'PowerShell 7',
        shellFamily: 'pwsh', executablePath: 'C:\\Program Files\\PowerShell\\7\\pwsh.exe',
        args: [], available: true, recommended: true
      }
    } as Parameters<typeof resolvePtyInvocation>[0] & { command: string });

    expect(invocation).toEqual({
      executablePath: 'C:\\Program Files\\PowerShell\\7\\pwsh.exe',
      args: [
        '-NoLogo',
        '-Command',
        '& ([scriptblock]::Create($env:LUMORA_PROVIDER_COMMAND)); exit $LASTEXITCODE'
      ],
      env: { LUMORA_PROVIDER_COMMAND: 'codexp' }
    });
    expect(invocation.args.join(' ')).not.toContain('codexp');
  });

  it('passes resume arguments to a custom PowerShell command', () => {
    const invocation = resolvePtyInvocation({
      platform: 'win32',
      executablePath: 'C:\\Tools\\codex.cmd',
      args: ['resume', 'native-session-123'],
      command: 'codexp',
      env: {},
      terminalProfile: {
        id: 'b'.repeat(64), kind: 'detected', name: 'PowerShell 7',
        shellFamily: 'pwsh', executablePath: 'pwsh.exe',
        args: [], available: true, recommended: true
      }
    });

    expect(invocation).toEqual({
      executablePath: 'pwsh.exe',
      args: [
        '-NoLogo',
        '-Command',
        '$lumoraArgs = @($env:LUMORA_PROVIDER_ARGUMENTS | ConvertFrom-Json); & ([scriptblock]::Create($env:LUMORA_PROVIDER_COMMAND + \' @args\')) @lumoraArgs; exit $LASTEXITCODE'
      ],
      env: {
        LUMORA_PROVIDER_COMMAND: 'codexp',
        LUMORA_PROVIDER_ARGUMENTS: '["resume","native-session-123"]'
      }
    });
    expect(invocation.args.join(' ')).not.toContain('native-session-123');
  });

  it('passes resume arguments to a custom command through bash', () => {
    const invocation = resolvePtyInvocation({
      platform: 'linux',
      executablePath: '/usr/local/bin/codex',
      args: ['resume', 'native-session-123'],
      command: 'codexp',
      env: {},
      terminalProfile: {
        id: 'b'.repeat(64), kind: 'detected', name: 'Bash',
        shellFamily: 'bash', executablePath: '/bin/bash',
        args: [], available: true, recommended: true
      }
    });

    expect(invocation).toEqual({
      executablePath: '/bin/bash',
      args: [
        '-i',
        '-c',
        'eval "lumora_provider_command() { $LUMORA_PROVIDER_COMMAND \\"\\$@\\"; }"; lumora_provider_command "$@"',
        'lumora-provider',
        'resume',
        'native-session-123'
      ],
      env: { LUMORA_PROVIDER_COMMAND: 'codexp' }
    });
  });

  it('passes native resume arguments atomically through zsh on macOS', () => {
    const invocation = resolvePtyInvocation({
      platform: 'darwin',
      executablePath: '/opt/homebrew/bin/claude',
      args: ['--resume', 'native-session-123'],
      command: null,
      env: {},
      terminalProfile: {
        id: 'b'.repeat(64), kind: 'detected', name: 'Zsh',
        shellFamily: 'zsh', executablePath: '/bin/zsh',
        args: ['-l'], available: true, recommended: true
      }
    });

    expect(invocation).toEqual({
      executablePath: '/bin/zsh',
      args: [
        '-l',
        '-c',
        'exec "$LUMORA_PROVIDER_EXECUTABLE" "$@"',
        'lumora-provider',
        '--resume',
        'native-session-123'
      ],
      env: { LUMORA_PROVIDER_EXECUTABLE: '/opt/homebrew/bin/claude' }
    });
  });

  it('rejects custom commands for shells without known command syntax', () => {
    expect(() =>
      resolvePtyInvocation({
        platform: 'linux',
        executablePath: '/usr/local/bin/codex',
        args: [],
        command: 'codexp',
        env: {},
        terminalProfile: {
          id: 'b'.repeat(64), kind: 'custom', name: 'Custom shell',
          shellFamily: 'other', executablePath: '/tools/custom-shell',
          args: [], available: true, recommended: false
        }
      } as Parameters<typeof resolvePtyInvocation>[0] & { command: string })
    ).toThrow('does not support custom provider commands');
  });

});
