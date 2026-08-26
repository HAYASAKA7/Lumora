import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';

import { describe, expect, it, vi } from 'vitest';

import {
  LineJsonRpcError,
  createLineJsonRpcTransport,
  type JsonRpcLineProcess
} from './line-json-rpc';

class FakeLineProcess extends EventEmitter implements JsonRpcLineProcess {
  readonly stdin = new PassThrough();
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  readonly kill = vi.fn(() => {
    this.emit('exit', null, 'SIGTERM');
    return true;
  });

  constructor() {
    super();
    this.stdin.on('finish', () => this.emit('exit', 0, null));
  }
}

function readLines(stream: PassThrough, accept: (message: unknown) => void): void {
  let buffer = '';
  stream.setEncoding('utf8');
  stream.on('data', (chunk: string) => {
    buffer += chunk;
    let newline = buffer.indexOf('\n');
    while (newline >= 0) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (line.length > 0) accept(JSON.parse(line));
      newline = buffer.indexOf('\n');
    }
  });
}

describe('line JSON-RPC transport', () => {
  it('exchanges requests and delivers notifications', async () => {
    const process = new FakeLineProcess();
    readLines(process.stdin, (message) => {
      const request = message as { id: number; method: string };
      process.stdout.write(`${JSON.stringify({
        jsonrpc: '2.0',
        id: request.id,
        result: { method: request.method }
      })}\n`);
    });
    const transport = createLineJsonRpcTransport(process);
    const notifications: unknown[] = [];
    const unsubscribe = transport.onNotification((notification) => {
      notifications.push(notification);
    });

    await expect(transport.request('initialize', { client: 'lumora' }))
      .resolves.toEqual({ method: 'initialize' });

    process.stdout.write(`${JSON.stringify({
      jsonrpc: '2.0',
      method: 'session/update',
      params: { sessionId: 'native-01' }
    })}\n`);
    expect(notifications).toEqual([{
      method: 'session/update',
      params: { sessionId: 'native-01' }
    }]);

    unsubscribe();
    await transport.close();
  });

  it('accepts several individually bounded messages delivered in one chunk', async () => {
    const process = new FakeLineProcess();
    const transport = createLineJsonRpcTransport(process, {
      maxFrameBytes: 96
    });
    const notifications: unknown[] = [];
    transport.onNotification((notification) => notifications.push(notification));

    const first = JSON.stringify({
      jsonrpc: '2.0',
      method: 'turn/started',
      params: { id: 'one' }
    });
    const second = JSON.stringify({
      jsonrpc: '2.0',
      method: 'turn/completed',
      params: { id: 'one' }
    });
    expect(Buffer.byteLength(first)).toBeLessThanOrEqual(96);
    expect(Buffer.byteLength(second)).toBeLessThanOrEqual(96);
    expect(Buffer.byteLength(`${first}\n${second}\n`)).toBeGreaterThan(96);

    process.stdout.write(`${first}\n${second}\n`);

    expect(notifications).toEqual([
      { method: 'turn/started', params: { id: 'one' } },
      { method: 'turn/completed', params: { id: 'one' } }
    ]);
    await transport.close();
  });

  it('handles provider-initiated requests without exposing a generic callback', async () => {
    const process = new FakeLineProcess();
    const written: unknown[] = [];
    readLines(process.stdin, (message) => written.push(message));
    const transport = createLineJsonRpcTransport(process, {
      handleRequest: async ({ method, params }) => ({
        method,
        accepted: params !== null
      })
    });

    process.stdout.write(`${JSON.stringify({
      jsonrpc: '2.0',
      id: 41,
      method: 'session/request_permission',
      params: { optionId: 'allow_once' }
    })}\n`);

    await vi.waitFor(() => {
      expect(written).toContainEqual({
        jsonrpc: '2.0',
        id: 41,
        result: {
          method: 'session/request_permission',
          accepted: true
        }
      });
    });
    await transport.close();
  });

  it('fails boundedly on timeout, malformed JSON, and oversized frames', async () => {
    const stalledProcess = new FakeLineProcess();
    const stalled = createLineJsonRpcTransport(stalledProcess, {
      requestTimeoutMs: 10
    });
    await expect(stalled.request('initialize', null)).rejects.toMatchObject({
      code: 'STRUCTURED_TRANSPORT_TIMEOUT'
    });
    await stalled.close();

    const malformedProcess = new FakeLineProcess();
    const malformed = createLineJsonRpcTransport(malformedProcess);
    const pendingMalformed = malformed.request('initialize', null);
    malformedProcess.stdout.write('{not-json}\n');
    await expect(pendingMalformed).rejects.toBeInstanceOf(LineJsonRpcError);
    await malformed.close();

    const oversizedProcess = new FakeLineProcess();
    const oversized = createLineJsonRpcTransport(oversizedProcess, {
      maxFrameBytes: 32
    });
    const pendingOversized = oversized.request('initialize', null);
    oversizedProcess.stdout.write('x'.repeat(33));
    await expect(pendingOversized).rejects.toMatchObject({
      code: 'STRUCTURED_TRANSPORT_LIMIT_EXCEEDED'
    });
    await oversized.close();
  });

  it('makes close idempotent and rejects late operations quietly', async () => {
    const process = new FakeLineProcess();
    const transport = createLineJsonRpcTransport(process);

    await Promise.all([transport.close(), transport.close()]);
    expect(process.kill).not.toHaveBeenCalled();
    await expect(transport.request('late', null)).rejects.toMatchObject({
      code: 'STRUCTURED_TRANSPORT_CLOSED'
    });
  });

  it('rejects all pending work when the provider exits unexpectedly', async () => {
    const process = new FakeLineProcess();
    const transport = createLineJsonRpcTransport(process);
    const pending = transport.request('thread/read', { threadId: 'native-01' });
    const exits: unknown[] = [];
    transport.onExit((error) => exits.push(error));

    process.emit('exit', 1, null);

    await expect(pending).rejects.toMatchObject({
      code: 'STRUCTURED_TRANSPORT_EXITED'
    });
    expect(exits).toMatchObject([{
      code: 'STRUCTURED_TRANSPORT_EXITED'
    }]);
  });
});
