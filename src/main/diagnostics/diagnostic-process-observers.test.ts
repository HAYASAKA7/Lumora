import { EventEmitter } from 'node:events';

import { describe, expect, it, vi } from 'vitest';

import { installDiagnosticProcessObservers } from './diagnostic-process-observers';

describe('installDiagnosticProcessObservers', () => {
  it('records process and Electron child failures without recording raw errors', async () => {
    const processHost = new EventEmitter();
    const appHost = new EventEmitter();
    const record = vi.fn().mockResolvedValue(undefined);
    const dispose = installDiagnosticProcessObservers({
      processHost,
      appHost,
      record
    });

    processHost.emit('uncaughtExceptionMonitor', new Error('C:\\secret'));
    processHost.emit('unhandledRejection', new Error('/home/private'));
    appHost.emit('render-process-gone', {}, {}, { reason: 'crashed' });
    appHost.emit('child-process-gone', {}, { type: 'Utility', reason: 'oom' });
    await Promise.resolve();

    expect(record).toHaveBeenCalledTimes(4);
    expect(record.mock.calls.map(([event]) => event)).toEqual([
      expect.objectContaining({
        subsystem: 'application',
        operation: 'uncaught-exception',
        code: 'UNCAUGHT_EXCEPTION'
      }),
      expect.objectContaining({
        subsystem: 'application',
        operation: 'unhandled-rejection',
        code: 'UNHANDLED_REJECTION'
      }),
      expect.objectContaining({
        subsystem: 'renderer',
        operation: 'process-gone',
        code: 'RENDERER_CRASHED'
      }),
      expect.objectContaining({
        subsystem: 'application',
        operation: 'child-process-gone',
        code: 'CHILD_OOM'
      })
    ]);
    expect(JSON.stringify(record.mock.calls)).not.toContain('secret');
    expect(JSON.stringify(record.mock.calls)).not.toContain('private');

    dispose();
    processHost.emit('unhandledRejection', new Error('after dispose'));
    expect(record).toHaveBeenCalledTimes(4);
  });

  it('normalizes unknown Electron reasons to bounded safe codes', async () => {
    const processHost = new EventEmitter();
    const appHost = new EventEmitter();
    const record = vi.fn().mockResolvedValue(undefined);
    installDiagnosticProcessObservers({ processHost, appHost, record });

    appHost.emit('render-process-gone', {}, {}, {
      reason: '../../Unexpected reason with a very long private value'
    });
    await Promise.resolve();

    expect(record).toHaveBeenCalledWith(expect.objectContaining({
      code: 'RENDERER_UNKNOWN'
    }));
  });
});
