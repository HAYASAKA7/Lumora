import { randomUUID } from 'node:crypto';

import {
  REMOTE_HELPER_PROTOCOL_VERSION,
  RemoteHelperResponseSchema,
  type RemoteHelperSystemInfo
} from '../../shared/remote-helper-protocol';
import {
  RemoteHelperResponseTracker,
  createHelperFrameDecoder,
  encodeHelperFrame
} from './helper-frame-codec';
import type { RemoteExecChannel } from './ssh-client';

const DEFAULT_HANDSHAKE_TIMEOUT_MS = 10_000;
const MAX_STDERR_BYTES = 64 * 1024;

export type RemoteHelperConnectionErrorCode =
  | 'HELPER_INCOMPATIBLE'
  | 'HELPER_TIMEOUT';

export class RemoteHelperConnectionError extends Error {
  constructor(readonly code: RemoteHelperConnectionErrorCode) {
    super(code === 'HELPER_TIMEOUT'
      ? 'The remote helper did not answer in time.'
      : 'The remote helper is incompatible with this Lumora version.');
    this.name = 'RemoteHelperConnectionError';
  }
}

export interface ConnectedRemoteHelper {
  info: RemoteHelperSystemInfo;
  close(): void;
}

export function connectRemoteHelper(input: {
  channel: RemoteExecChannel;
  generation: number;
  expectedPlatform: 'win32' | 'darwin' | 'linux';
  expectedArchitecture: 'x64' | 'arm64';
  createRequestId?: () => string;
  timeoutMs?: number;
}): Promise<ConnectedRemoteHelper> {
  return new Promise((resolve, reject) => {
    const requestId = (input.createRequestId ?? randomUUID)();
    const tracker = new RemoteHelperResponseTracker(input.generation);
    const decoder = createHelperFrameDecoder();
    let stderrBytes = 0;
    let settled = false;
    let connectedClosed = false;

    const cleanup = () => {
      clearTimeout(timeout);
      input.channel.stdout.removeListener('data', onData);
      input.channel.stdout.removeListener('error', onStreamFailure);
      input.channel.stdout.removeListener('end', onStreamFailure);
      input.channel.stdout.removeListener('close', onStreamFailure);
      input.channel.stderr.removeListener('data', onStderr);
      input.channel.stderr.removeListener('error', onStreamFailure);
    };
    const fail = (code: RemoteHelperConnectionErrorCode) => {
      if (settled) return;
      settled = true;
      cleanup();
      input.channel.close();
      reject(new RemoteHelperConnectionError(code));
    };
    const onStreamFailure = () => fail('HELPER_INCOMPATIBLE');
    const onStderr = (chunk: Buffer | string) => {
      stderrBytes += Buffer.isBuffer(chunk)
        ? chunk.length
        : Buffer.byteLength(chunk, 'utf8');
      if (stderrBytes > MAX_STDERR_BYTES) fail('HELPER_INCOMPATIBLE');
    };
    const onData = (chunk: Buffer | string) => {
      if (settled) return;
      try {
        const values = decoder.push(
          Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
        );
        for (const value of values) {
          const response = RemoteHelperResponseSchema.parse(value);
          if (response.operation !== 'handshake') {
            return fail('HELPER_INCOMPATIBLE');
          }
          tracker.accept(response);
          if (!response.ok) return fail('HELPER_INCOMPATIBLE');
          const info = response.result;
          if (
            info.platform !== input.expectedPlatform ||
            info.architecture !== input.expectedArchitecture ||
            info.protocolVersion !== REMOTE_HELPER_PROTOCOL_VERSION
          ) return fail('HELPER_INCOMPATIBLE');
          settled = true;
          cleanup();
          resolve({
            info,
            close() {
              if (connectedClosed) return;
              connectedClosed = true;
              input.channel.close();
            }
          });
          return;
        }
      } catch {
        fail('HELPER_INCOMPATIBLE');
      }
    };
    const timeout = setTimeout(
      () => fail('HELPER_TIMEOUT'),
      input.timeoutMs ?? DEFAULT_HANDSHAKE_TIMEOUT_MS
    );
    timeout.unref?.();

    input.channel.stdout.on('data', onData);
    input.channel.stdout.on('error', onStreamFailure);
    input.channel.stdout.on('end', onStreamFailure);
    input.channel.stdout.on('close', onStreamFailure);
    input.channel.stderr.on('data', onStderr);
    input.channel.stderr.on('error', onStreamFailure);

    try {
      tracker.register(requestId);
      input.channel.stdin.write(encodeHelperFrame({
        protocolVersion: REMOTE_HELPER_PROTOCOL_VERSION,
        kind: 'request',
        generation: input.generation,
        requestId,
        operation: 'handshake',
        payload: {}
      }));
    } catch {
      fail('HELPER_INCOMPATIBLE');
    }
  });
}
