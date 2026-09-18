import { describe, expect, it } from 'vitest';

import { readCodexNotify } from './codex-notify-config';

describe('readCodexNotify', () => {
  it('finds no program where there is none', () => {
    expect(readCodexNotify('')).toEqual({ state: 'absent' });
    expect(readCodexNotify('model = "gpt-5.6-sol"\n')).toEqual({ state: 'absent' });
  });

  it('reads the program in either kind of string', () => {
    expect(readCodexNotify('notify = ["python3", "/home/me/notify.py"]\n')).toEqual({
      state: 'present',
      command: ['python3', '/home/me/notify.py']
    });
    expect(readCodexNotify("notify = ['C:\\Users\\me\\notify.exe']\n")).toEqual({
      state: 'present',
      command: ['C:\\Users\\me\\notify.exe']
    });
    expect(readCodexNotify('notify = ["C:\\\\Tools\\\\say \\"done\\".exe", "--quiet"]')).toEqual({
      state: 'present',
      command: ['C:\\Tools\\say "done".exe', '--quiet']
    });
  });

  it('reads a list spread over lines, with comments and a trailing comma', () => {
    const text = [
      '# my settings',
      'notify = [',
      '  "node",  # the runtime',
      "  '/opt/notify.js',",
      ']',
      'model = "gpt-5.6-sol"'
    ].join('\n');
    expect(readCodexNotify(text)).toEqual({
      state: 'present',
      command: ['node', '/opt/notify.js']
    });
  });

  it('reads only the top level, where Codex looks', () => {
    const text = [
      'model = "gpt-5.6-sol"',
      '[profiles.work]',
      'notify = ["work-notify"]'
    ].join('\n');
    expect(readCodexNotify(text)).toEqual({ state: 'absent' });
  });

  it('calls anything it cannot read for certain unreadable, so it is never overridden', () => {
    expect(readCodexNotify('notify = "not a list"')).toEqual({ state: 'unreadable' });
    expect(readCodexNotify('notify = ["unterminated]')).toEqual({ state: 'unreadable' });
    expect(readCodexNotify('notify = []')).toEqual({ state: 'unreadable' });
    expect(readCodexNotify('notify = [1, 2]')).toEqual({ state: 'unreadable' });
    expect(readCodexNotify('notify = """multi"""')).toEqual({ state: 'unreadable' });
  });
});
