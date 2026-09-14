import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';

import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ConnectedRemoteHelper } from '../remote/helper-connection';
import { createLocalProcessSampler, type LocalHelperProcess } from './local-process-sampler';

class FakeHelperProcess extends EventEmitter implements LocalHelperProcess {
  readonly stdin = new PassThrough();
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  readonly kill = vi.fn(() => true);
}

const result = { processes: [], truncated: false };

function harness(options: { failConnect?: boolean } = {}) {
  let now = 0;
  const children: FakeHelperProcess[] = [];
  const helpers: Array<ConnectedRemoteHelper & { close: ReturnType<typeof vi.fn> }> = [];
  const connect = vi.fn(async (input: Parameters<typeof import('../remote/helper-connection').connectRemoteHelper>[0]) => {
    if (options.failConnect === true) throw new Error('handshake failed');
    const helper = {
      info: {} as ConnectedRemoteHelper['info'],
      scanDiscovery: vi.fn(),
      scanSessionPage: vi.fn(),
      runProviderLifecycle: vi.fn(),
      sampleProcessTree: vi.fn(async () => result),
      close: vi.fn(() => input.channel.close())
    };
    helpers.push(helper);
    return helper;
  });
  const sampler = createLocalProcessSampler({
    resolveExecutable: async () => 'C:\\Lumora\\helper\\lumora-helper.exe',
    platform: 'win32',
    architecture: 'x64',
    startHelper: () => {
      const child = new FakeHelperProcess();
      children.push(child);
      return child;
    },
    connect: connect as never,
    idleMs: 15_000,
    retryAfterMs: 30_000,
    now: () => now
  });
  return {
    sampler, children, helpers, connect,
    advance(ms: number) {
      now += ms;
    }
  };
}

describe('local process sampler', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('starts the helper once, reuses it, and stops it after samples stop', async () => {
    vi.useFakeTimers();
    const { sampler, children, helpers, connect } = harness();

    await expect(sampler.sample(4242)).resolves.toEqual(result);
    await sampler.sample(4242);
    expect(children).toHaveLength(1);
    expect(connect).toHaveBeenCalledWith(expect.objectContaining({
      expectedPlatform: 'win32', expectedArchitecture: 'x64'
    }));
    expect(helpers[0]!.sampleProcessTree).toHaveBeenCalledWith(4242);

    await vi.advanceTimersByTimeAsync(14_999);
    expect(children[0]!.kill).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(children[0]!.kill).toHaveBeenCalledOnce();

    await sampler.sample(4242);
    expect(children).toHaveLength(2);
    sampler.close();
    await vi.advanceTimersByTimeAsync(0);
    expect(children[1]!.kill).toHaveBeenCalledOnce();
  });

  it('starts a new helper when the running one exits', async () => {
    const { sampler, children } = harness();

    await sampler.sample(4242);
    children[0]!.emit('exit');
    await sampler.sample(4242);

    expect(children).toHaveLength(2);
    sampler.close();
  });

  it('waits before starting a helper again after it failed', async () => {
    const { sampler, children, advance } = harness({ failConnect: true });

    await expect(sampler.sample(4242)).rejects.toThrow('could not read process information');
    await expect(sampler.sample(4242)).rejects.toThrow('could not read process information');
    expect(children).toHaveLength(1);

    advance(30_000);
    await expect(sampler.sample(4242)).rejects.toThrow();
    expect(children).toHaveLength(2);
    sampler.close();
  });
});
