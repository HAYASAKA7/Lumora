import { describe, expect, it } from 'vitest';

import { buildStructuredProcessInvocation } from './process-invocation';

describe('structured provider process invocation', () => {
  it('runs native executables directly on POSIX platforms', () => {
    expect(buildStructuredProcessInvocation(
      '/usr/local/bin/gemini',
      ['--acp'],
      { platform: 'darwin', env: {} }
    )).toEqual({
      file: '/usr/local/bin/gemini',
      args: ['--acp'],
      windowsVerbatimArguments: false
    });
  });

  it('runs native Windows executables directly', () => {
    expect(buildStructuredProcessInvocation(
      'C:\\Tools\\claude.exe',
      ['--version'],
      { platform: 'win32', env: {} }
    )).toEqual({
      file: 'C:\\Tools\\claude.exe',
      args: ['--version'],
      windowsVerbatimArguments: false
    });
  });

  it('routes Windows npm wrappers through the configured command processor', () => {
    expect(buildStructuredProcessInvocation(
      'C:\\Program Files\\nodejs\\gemini.cmd',
      ['--acp'],
      {
        platform: 'win32',
        env: { ComSpec: 'C:\\Windows\\System32\\cmd.exe' }
      }
    )).toEqual({
      file: 'C:\\Windows\\System32\\cmd.exe',
      args: [
        '/d',
        '/s',
        '/c',
        '""C:\\Program Files\\nodejs\\gemini.cmd" --acp"'
      ],
      windowsVerbatimArguments: true
    });
  });

  it('rejects relative paths and shell metacharacters', () => {
    expect(() => buildStructuredProcessInvocation(
      'gemini',
      ['--acp'],
      { platform: 'linux', env: {} }
    )).toThrow('absolute');

    expect(() => buildStructuredProcessInvocation(
      'C:\\bad%path\\gemini.cmd',
      ['--acp'],
      { platform: 'win32', env: {} }
    )).toThrow('safely');

    expect(() => buildStructuredProcessInvocation(
      'C:\\tools\\gemini.cmd',
      ['--acp & calc'],
      { platform: 'win32', env: {} }
    )).toThrow('argument');
  });
});
