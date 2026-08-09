import { describe, expect, it, vi } from 'vitest';

const { spawnMock } = vi.hoisted(() => ({
  spawnMock: vi.fn()
}));

vi.mock('node-pty', () => ({
  spawn: spawnMock
}));

import { PtyProcessExitedError } from './runtime-host';
import { runPtyOperation, spawnPty } from './pty-adapter';

describe('spawnPty', () => {
  it('does not pass the unsupported encoding option to node-pty', () => {
    spawnMock.mockReturnValue({
      pid: 42,
      write: vi.fn(),
      resize: vi.fn(),
      kill: vi.fn(),
      onData: vi.fn(() => ({ dispose: vi.fn() })),
      onExit: vi.fn(() => ({ dispose: vi.fn() }))
    });

    spawnPty({
      executablePath: 'powershell.exe',
      args: ['-NoLogo'],
      cwd: 'D:\\work',
      env: { PATH: 'C:\\Windows\\System32' },
      cols: 100,
      rows: 30
    });

    const spawnOptions = spawnMock.mock.calls[0]?.[2];
    expect(spawnOptions).not.toHaveProperty('encoding');
    expect(spawnOptions).toMatchObject({
      name: 'xterm-256color',
      handleFlowControl: true
    });
  });
});

describe('runPtyOperation', () => {
  it.each([
    Object.assign(new Error('broken pipe'), { code: 'EPIPE' }),
    Object.assign(new Error('stream destroyed'), {
      code: 'ERR_STREAM_DESTROYED'
    }),
    Object.assign(new Error('write after end'), {
      code: 'ERR_STREAM_WRITE_AFTER_END'
    }),
    Object.assign(new Error('socket closed'), { code: 'ERR_SOCKET_CLOSED' }),
    new Error('Cannot resize a pty that has already exited'),
    new Error('write after end')
  ])('normalizes native terminal exit errors', (error) => {
    expect(() =>
      runPtyOperation(() => {
        throw error;
      })
    ).toThrow(PtyProcessExitedError);
  });

  it('preserves unrelated native terminal operation failures', () => {
    const failure = new Error('unexpected live PTY failure');

    expect(() =>
      runPtyOperation(() => {
        throw failure;
      })
    ).toThrow(failure);
  });
});
