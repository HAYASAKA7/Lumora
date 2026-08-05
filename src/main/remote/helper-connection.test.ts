import { PassThrough } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';

import { encodeHelperFrame } from './helper-frame-codec';
import {
  RemoteHelperConnectionError,
  connectRemoteHelper
} from './helper-connection';
import type { RemoteExecChannel } from './ssh-client';

function channel() {
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const close = vi.fn(() => {
    stdin.destroy();
    stdout.destroy();
    stderr.destroy();
  });
  return {
    value: { stdin, stdout, stderr, close } satisfies RemoteExecChannel,
    stdin,
    stdout,
    stderr,
    close
  };
}

function response(overrides: Record<string, unknown> = {}) {
  return {
    protocolVersion: 1,
    kind: 'response',
    generation: 7,
    requestId: 'request-1',
    operation: 'handshake',
    ok: true,
    result: {
      helperVersion: '0.1.0',
      protocolVersion: 1,
      platform: 'linux',
      architecture: 'x64',
      homeDirectory: '/home/builder',
      defaultShell: '/bin/bash',
      capabilities: ['system-info']
    },
    ...overrides
  };
}

describe('remote helper connection', () => {
  it('writes one handshake and accepts a fragmented matching response', async () => {
    const remote = channel();
    const written: Buffer[] = [];
    remote.stdin.on('data', (chunk: Buffer) => written.push(chunk));
    const connecting = connectRemoteHelper({
      channel: remote.value,
      generation: 7,
      expectedPlatform: 'linux',
      expectedArchitecture: 'x64',
      createRequestId: () => 'request-1'
    });
    const frame = encodeHelperFrame(response());
    remote.stdout.write(frame.subarray(0, 3));
    remote.stdout.write(frame.subarray(3));

    const connected = await connecting;
    expect(connected.info).toMatchObject({
      helperVersion: '0.1.0',
      platform: 'linux',
      architecture: 'x64'
    });
    expect(Buffer.concat(written).length).toBeGreaterThan(4);
    connected.close();
    connected.close();
    expect(remote.close).toHaveBeenCalledOnce();
  });

  it.each([
    ['stale generation', response({ generation: 6 })],
    ['wrong platform', response({ result: { ...response().result as object, platform: 'darwin' } })],
    ['unexpected request', response({ requestId: 'another-request' })]
  ])('rejects %s without exposing protocol details', async (_label, value) => {
    const remote = channel();
    const connecting = connectRemoteHelper({
      channel: remote.value,
      generation: 7,
      expectedPlatform: 'linux',
      expectedArchitecture: 'x64',
      createRequestId: () => 'request-1'
    });
    remote.stdout.write(encodeHelperFrame(value));

    await expect(connecting).rejects.toMatchObject({
      name: RemoteHelperConnectionError.name,
      code: 'HELPER_INCOMPATIBLE'
    });
    expect(remote.close).toHaveBeenCalledOnce();
  });

  it('rejects malformed frames and bounded stderr', async () => {
    const malformed = channel();
    const first = connectRemoteHelper({
      channel: malformed.value,
      generation: 7,
      expectedPlatform: 'linux',
      expectedArchitecture: 'x64',
      createRequestId: () => 'request-1'
    });
    malformed.stdout.write(Buffer.from([0, 0, 0, 0]));
    await expect(first).rejects.toMatchObject({ code: 'HELPER_INCOMPATIBLE' });

    const noisy = channel();
    const second = connectRemoteHelper({
      channel: noisy.value,
      generation: 7,
      expectedPlatform: 'linux',
      expectedArchitecture: 'x64',
      createRequestId: () => 'request-1'
    });
    noisy.stderr.write(Buffer.alloc(64 * 1024 + 1));
    await expect(second).rejects.toMatchObject({ code: 'HELPER_INCOMPATIBLE' });
  });

  it('times out and closes a silent helper channel', async () => {
    vi.useFakeTimers();
    const remote = channel();
    const connecting = connectRemoteHelper({
      channel: remote.value,
      generation: 7,
      expectedPlatform: 'linux',
      expectedArchitecture: 'x64',
      createRequestId: () => 'request-1',
      timeoutMs: 25
    });
    const rejection = expect(connecting).rejects.toMatchObject({
      code: 'HELPER_TIMEOUT'
    });
    await vi.advanceTimersByTimeAsync(25);
    await rejection;
    expect(remote.close).toHaveBeenCalledOnce();
    vi.useRealTimers();
  });
});
