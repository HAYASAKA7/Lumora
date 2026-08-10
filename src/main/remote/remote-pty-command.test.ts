import { describe, expect, it } from 'vitest';

import { buildRemotePtyCommand } from './remote-pty-command';

describe('buildRemotePtyCommand', () => {
  it.each(['linux', 'darwin'] as const)(
    'quotes the workspace, executable, and every argument on %s',
    (platform) => {
      const command = buildRemotePtyCommand({
        platform,
        cwd: "/home/user/it's work",
        executablePath: "/opt/Agent Tools/agent's-cli",
        args: ['resume', 'native id', 'compare A & B', '你好']
      });

      expect(command).toBe(
        "cd '/home/user/it'\"'\"'s work' && exec '/opt/Agent Tools/agent'\"'\"'s-cli' 'resume' 'native id' 'compare A & B' '你好'"
      );
    }
  );

  it('uses literal PowerShell values for Windows command shims', () => {
    const command = buildRemotePtyCommand({
      platform: 'win32',
      cwd: "C:\\Users\\O'Brien\\Project & Test",
      executablePath: 'C:\\Program Files\\Agent\\agent.cmd',
      args: ['--resume', "native'id", 'compare A & B', '你好']
    });

    const encoded = command.match(/-EncodedCommand ([A-Za-z0-9+/=]+)$/u)?.[1];
    if (encoded === undefined) throw new Error('Missing encoded command.');
    expect(Buffer.from(encoded, 'base64').toString('utf16le')).toBe(
      "$ErrorActionPreference = 'Stop'; Set-Location -LiteralPath 'C:\\Users\\O''Brien\\Project & Test'; & 'C:\\Program Files\\Agent\\agent.cmd' '--resume' 'native''id' 'compare A & B' '你好'; exit $LASTEXITCODE"
    );
  });

  it.each(['linux', 'darwin'] as const)(
    'passes only explicit Lumora launch values to the remote shell on %s',
    (platform) => {
      expect(buildRemotePtyCommand({
        platform,
        cwd: '/srv/lumora',
        executablePath: '/bin/bash',
        args: ['-ilc', 'eval "exec $LUMORA_PROVIDER_COMMAND"'],
        env: { LUMORA_PROVIDER_COMMAND: "codexp --profile 'remote'" }
      })).toBe(
        "cd '/srv/lumora' && exec env 'LUMORA_PROVIDER_COMMAND=codexp --profile '\"'\"'remote'\"'\"'' '/bin/bash' '-ilc' 'eval \"exec $LUMORA_PROVIDER_COMMAND\"'"
      );
    }
  );

  it('sets explicit Lumora launch values inside the encoded Windows command', () => {
    const command = buildRemotePtyCommand({
      platform: 'win32',
      cwd: 'C:\\work',
      executablePath: 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
      args: ['-NoLogo', '-Command', '& $env:LUMORA_PROVIDER_COMMAND'],
      env: { LUMORA_PROVIDER_COMMAND: "codexp --profile 'remote'" }
    });
    const encoded = command.match(/-EncodedCommand ([A-Za-z0-9+/=]+)$/u)?.[1];
    if (encoded === undefined) throw new Error('Missing encoded command.');

    expect(Buffer.from(encoded, 'base64').toString('utf16le')).toContain(
      "$env:LUMORA_PROVIDER_COMMAND = 'codexp --profile ''remote''';"
    );
  });

  it('rejects arbitrary environment names', () => {
    expect(() => buildRemotePtyCommand({
      platform: 'linux',
      cwd: '/tmp/work',
      executablePath: '/bin/agent',
      args: [],
      env: { PATH: '/private/local/path' }
    })).toThrow('environment');
  });

  it.each([
    { platform: 'linux' as const, cwd: 'relative', executablePath: '/bin/agent' },
    { platform: 'darwin' as const, cwd: '/tmp/work', executablePath: 'agent' },
    { platform: 'win32' as const, cwd: 'relative', executablePath: 'C:\\agent.exe' },
    { platform: 'win32' as const, cwd: 'C:\\work', executablePath: 'agent.exe' }
  ])('rejects non-absolute remote paths', (input) => {
    expect(() => buildRemotePtyCommand({ ...input, args: [] })).toThrow(
      'absolute'
    );
  });

  it.each(['line\nfeed', 'carriage\rreturn', 'nul\0value'])('rejects control-line input', (value) => {
    expect(() => buildRemotePtyCommand({
      platform: 'linux',
      cwd: '/tmp/work',
      executablePath: '/bin/agent',
      args: [value]
    })).toThrow('invalid');
  });
});
