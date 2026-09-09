import { describe, expect, it, vi } from 'vitest';

import { createProcessTerminator } from './terminate-process';

function child(pid: number | undefined) {
  return { pid, kill: vi.fn(() => true) };
}

describe('process terminator', () => {
  it('takes down the whole tree on Windows', () => {
    // A provider installed by npm is a .cmd shim, so Lumora spawns
    // cmd.exe, which spawns node. Killing what we spawned leaves the agent
    // itself running, which is how a probe leaks a process.
    const run = vi.fn();
    const target = child(4242);

    createProcessTerminator({ platform: 'win32', run })(target);

    expect(run).toHaveBeenCalledWith(
      'taskkill',
      ['/pid', '4242', '/t', '/f'],
      expect.any(Function)
    );
    expect(target.kill).not.toHaveBeenCalled();
  });

  it('signals the process directly everywhere else', () => {
    const run = vi.fn();
    const target = child(4242);

    createProcessTerminator({ platform: 'darwin', run })(target);

    expect(target.kill).toHaveBeenCalledOnce();
    expect(run).not.toHaveBeenCalled();
  });

  it('falls back to the direct signal when there is no pid to chase', () => {
    const run = vi.fn();
    const target = child(undefined);

    createProcessTerminator({ platform: 'win32', run })(target);

    expect(target.kill).toHaveBeenCalledOnce();
    expect(run).not.toHaveBeenCalled();
  });

  it('still signals the process when the tree kill cannot run', () => {
    // Losing taskkill must not leave the process untouched.
    const run = vi.fn((
      _file: string,
      _args: readonly string[],
      onFailure: () => void
    ) => { onFailure(); });
    const target = child(4242);

    createProcessTerminator({ platform: 'win32', run })(target);

    expect(target.kill).toHaveBeenCalledOnce();
  });
});
