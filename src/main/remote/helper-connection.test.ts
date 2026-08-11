import { PassThrough } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';

import { createHelperFrameDecoder, encodeHelperFrame } from './helper-frame-codec';
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

  it('keeps the channel alive for correlated discovery requests', async () => {
    const remote = channel();
    const written: Buffer[] = [];
    remote.stdin.on('data', (chunk: Buffer) => written.push(chunk));
    const requestIds = ['request-1', 'request-2'];
    const connecting = connectRemoteHelper({
      channel: remote.value,
      generation: 7,
      expectedPlatform: 'linux',
      expectedArchitecture: 'x64',
      createRequestId: () => requestIds.shift()!,
      timeoutMs: 100
    });
    remote.stdout.write(encodeHelperFrame(response({
      result: {
        ...response().result as object,
        capabilities: ['system-info', 'provider-scan']
      }
    })));
    const connected = await connecting;
    const scanning = connected.scanDiscovery(['codex']);
    remote.stdout.write(encodeHelperFrame({
      protocolVersion: 1,
      kind: 'response',
      generation: 7,
      requestId: 'request-2',
      operation: 'discovery-scan',
      ok: true,
      result: {
        checkedAt: '2026-08-05T04:03:02.000Z',
        node: { state: 'ready', executablePath: '/usr/bin/node', version: 'v24' },
        npm: { state: 'not_found', executablePath: null, version: null },
        providers: [{
          provider: 'codex', state: 'ready',
          executablePath: '/usr/bin/codex', version: 'codex 1.2.3'
        }]
      }
    }));

    await expect(scanning).resolves.toMatchObject({
      providers: [{ provider: 'codex', state: 'ready' }]
    });
    const decoder = createHelperFrameDecoder();
    const requests = decoder.push(Buffer.concat(written));
    expect(requests).toHaveLength(2);
    expect(requests[1]).toMatchObject({
      requestId: 'request-2',
      operation: 'discovery-scan',
      payload: { enabledProviders: ['codex'] }
    });
    expect(remote.close).not.toHaveBeenCalled();
    connected.close();
  });

  it('requests one bounded session metadata page without exposing content', async () => {
    const remote = channel();
    const written: Buffer[] = [];
    remote.stdin.on('data', (chunk: Buffer) => written.push(chunk));
    const requestIds = ['request-1', 'request-2'];
    const connecting = connectRemoteHelper({
      channel: remote.value,
      generation: 7,
      expectedPlatform: 'linux',
      expectedArchitecture: 'x64',
      createRequestId: () => requestIds.shift()!,
      timeoutMs: 100
    });
    remote.stdout.write(encodeHelperFrame(response({
      result: {
        ...response().result as object,
        capabilities: ['system-info', 'session-scan']
      }
    })));
    const connected = await connecting;
    const scanning = connected.scanSessionPage('opencode', null, 50);
    remote.stdout.write(encodeHelperFrame({
      protocolVersion: 1,
      kind: 'response',
      generation: 7,
      requestId: 'request-2',
      operation: 'session-scan',
      ok: true,
      result: {
        provider: 'opencode',
        scannedAt: '2026-08-09T04:03:02.000Z',
        status: 'ready',
        sessions: [{
          nativeId: 'session-1', workspacePath: '/work/lumora',
          title: 'Remote work', createdAt: '2026-08-08T04:03:02.000Z',
          updatedAt: '2026-08-09T04:03:02.000Z', lifetimeTokens: null,
          sourceKey: 'opencode:session-1'
        }],
        invalidCount: 0,
        nextCursor: null
      }
    }));

    await expect(scanning).resolves.toMatchObject({
      provider: 'opencode', sessions: [{ nativeId: 'session-1' }]
    });
    const requests = createHelperFrameDecoder().push(Buffer.concat(written));
    expect(requests[1]).toMatchObject({
      operation: 'session-scan',
      payload: { provider: 'opencode', cursor: null, limit: 50 }
    });
    connected.close();
  });

  it('runs one allowlisted provider lifecycle request after capability negotiation', async () => {
    const remote = channel();
    const written: Buffer[] = [];
    remote.stdin.on('data', (chunk: Buffer) => written.push(chunk));
    const requestIds = ['request-1', 'request-2'];
    const connecting = connectRemoteHelper({
      channel: remote.value,
      generation: 7,
      expectedPlatform: 'linux',
      expectedArchitecture: 'x64',
      createRequestId: () => requestIds.shift()!,
      timeoutMs: 100,
      lifecycleTimeoutMs: 200
    });
    remote.stdout.write(encodeHelperFrame(response({
      result: {
        ...response().result as object,
        capabilities: ['system-info', 'provider-lifecycle']
      }
    })));
    const connected = await connecting;
    const running = connected.runProviderLifecycle('codex', 'install');
    remote.stdout.write(encodeHelperFrame({
      protocolVersion: 1,
      kind: 'response',
      generation: 7,
      requestId: 'request-2',
      operation: 'provider-lifecycle',
      ok: true,
      result: {
        provider: 'codex',
        action: 'install',
        completedAt: '2026-08-11T01:02:03.000Z'
      }
    }));

    await expect(running).resolves.toMatchObject({
      provider: 'codex', action: 'install'
    });
    const requests = createHelperFrameDecoder().push(Buffer.concat(written));
    expect(requests[1]).toMatchObject({
      operation: 'provider-lifecycle',
      payload: { provider: 'codex', action: 'install' }
    });
    expect(JSON.stringify(requests[1])).not.toContain('command');
    connected.close();
  });

  it('rejects provider lifecycle when the helper did not advertise it', async () => {
    const remote = channel();
    const connecting = connectRemoteHelper({
      channel: remote.value,
      generation: 7,
      expectedPlatform: 'linux',
      expectedArchitecture: 'x64',
      createRequestId: () => 'request-1'
    });
    remote.stdout.write(encodeHelperFrame(response()));
    const connected = await connecting;
    await expect(
      connected.runProviderLifecycle('codex', 'update')
    ).rejects.toMatchObject({ code: 'HELPER_INCOMPATIBLE' });
    connected.close();
  });

  it('rejects pending discovery when the connected helper closes', async () => {
    const remote = channel();
    const requestIds = ['request-1', 'request-2'];
    const connecting = connectRemoteHelper({
      channel: remote.value,
      generation: 7,
      expectedPlatform: 'linux',
      expectedArchitecture: 'x64',
      createRequestId: () => requestIds.shift()!,
      timeoutMs: 100
    });
    remote.stdout.write(encodeHelperFrame(response()));
    const connected = await connecting;
    const scanning = connected.scanDiscovery(['codex']);
    connected.close();
    await expect(scanning).rejects.toMatchObject({
      name: RemoteHelperConnectionError.name,
      code: 'HELPER_INCOMPATIBLE'
    });
    expect(remote.close).toHaveBeenCalledOnce();
  });

  it('allows bounded discovery to outlive the short handshake timeout', async () => {
    vi.useFakeTimers();
    const remote = channel();
    const requestIds = ['request-1', 'request-2'];
    const connecting = connectRemoteHelper({
      channel: remote.value,
      generation: 7,
      expectedPlatform: 'linux',
      expectedArchitecture: 'x64',
      createRequestId: () => requestIds.shift()!,
      timeoutMs: 25,
      discoveryTimeoutMs: 75
    });
    remote.stdout.write(encodeHelperFrame(response()));
    const connected = await connecting;
    let settled = false;
    const scanning = connected.scanDiscovery(['codex']).finally(() => {
      settled = true;
    });
    const rejection = expect(scanning).rejects.toMatchObject({
      code: 'HELPER_TIMEOUT'
    });

    await vi.advanceTimersByTimeAsync(25);
    expect(settled).toBe(false);
    expect(remote.close).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(50);
    await rejection;
    expect(remote.close).not.toHaveBeenCalled();
    connected.close();
    vi.useRealTimers();
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
