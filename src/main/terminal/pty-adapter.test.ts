import { describe, expect, it } from 'vitest';

import { PtyProcessExitedError } from './runtime-host';
import { runPtyOperation } from './pty-adapter';

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
