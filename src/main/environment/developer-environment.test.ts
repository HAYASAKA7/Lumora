import { describe, expect, it, vi } from 'vitest';

import { createDeveloperEnvironmentScanner } from './developer-environment';

describe('createDeveloperEnvironmentScanner', () => {
  it('coalesces overlapping scans and reports one bounded measurement', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const findExecutable = vi.fn(async (command: string) => {
      await gate;
      return `/usr/bin/${command}`;
    });
    const onSettled = vi.fn();
    let elapsed = 100;
    const scanner = createDeveloperEnvironmentScanner(
      { findExecutable, probeVersion: vi.fn(async () => '1.0.0') },
      () => new Date('2026-07-17T01:00:00.000Z'),
      { monotonicClock: () => elapsed, onSettled }
    );

    const first = scanner.scan();
    const second = scanner.scan();
    expect(findExecutable).toHaveBeenCalledTimes(2);
    elapsed = 125;
    release();
    await Promise.all([first, second]);

    expect(findExecutable).toHaveBeenCalledTimes(2);
    expect(onSettled).toHaveBeenCalledOnce();
    expect(onSettled).toHaveBeenCalledWith({
      outcome: 'succeeded',
      durationMs: 25,
      cacheHits: 1
    });
  });

  it('reports Node and npm independently', async () => {
    const findExecutable = vi.fn(async (command: string) =>
      command === 'node' ? '/usr/bin/node' : null
    );
    const probeVersion = vi.fn(async () => 'v24.18.0');
    const scanner = createDeveloperEnvironmentScanner(
      { findExecutable, probeVersion },
      () => new Date('2026-07-17T01:00:00.000Z')
    );

    await expect(scanner.scan()).resolves.toEqual({
      checkedAt: '2026-07-17T01:00:00.000Z',
      node: {
        state: 'ready',
        executablePath: '/usr/bin/node',
        version: 'v24.18.0'
      },
      npm: { state: 'not_found', executablePath: null, version: null }
    });
    expect(findExecutable).toHaveBeenCalledWith('node');
    expect(findExecutable).toHaveBeenCalledWith('npm');
    expect(probeVersion).toHaveBeenCalledOnce();
  });

  it('isolates a version failure to the affected tool', async () => {
    const scanner = createDeveloperEnvironmentScanner({
      findExecutable: vi.fn(async (command: string) => `/usr/local/bin/${command}`),
      probeVersion: vi.fn(async (path: string) => {
        if (path.endsWith('/npm')) throw new Error('probe failed');
        return 'v24.18.0';
      })
    });

    await expect(scanner.scan()).resolves.toMatchObject({
      node: { state: 'ready', version: 'v24.18.0' },
      npm: {
        state: 'probe_failed',
        executablePath: '/usr/local/bin/npm',
        version: null
      }
    });
  });

  it('starts both PATH lookups before either resolves', async () => {
    const resolvers = new Map<string, (value: string) => void>();
    const findExecutable = vi.fn(
      (command: string) =>
        new Promise<string>((resolve) => {
          resolvers.set(command, resolve);
        })
    );
    const scanner = createDeveloperEnvironmentScanner({
      findExecutable,
      probeVersion: vi.fn(async () => '1.0.0')
    });

    const pending = scanner.scan();
    await vi.waitFor(() => expect(findExecutable).toHaveBeenCalledTimes(2));
    resolvers.get('node')!('/usr/bin/node');
    resolvers.get('npm')!('/usr/bin/npm');

    await expect(pending).resolves.toMatchObject({
      node: { state: 'ready' },
      npm: { state: 'ready' }
    });
  });

  it('does not report a locator failure as a missing tool', async () => {
    const scanner = createDeveloperEnvironmentScanner({
      findExecutable: vi.fn(async () => {
        throw new Error('PATH unavailable');
      }),
      probeVersion: vi.fn()
    });

    await expect(scanner.scan()).rejects.toThrow('PATH unavailable');
  });
});
