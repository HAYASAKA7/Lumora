import { randomUUID } from 'node:crypto';

import {
  REMOTE_HELPER_PROTOCOL_VERSION,
  RemoteHelperRequestSchema,
  RemoteHelperResponseSchema,
  type RemoteHelperDiscoveryResult,
  type RemoteHelperResponse,
  type RemoteHelperSessionScanResult,
  type RemoteHelperSystemInfo
} from '../../shared/remote-helper-protocol';
import type { ProviderId } from '../../shared/contracts';
import {
  RemoteHelperResponseTracker,
  createHelperFrameDecoder,
  encodeHelperFrame
} from './helper-frame-codec';
import type { RemoteExecChannel } from './ssh-client';

const DEFAULT_REQUEST_TIMEOUT_MS = 10_000;
const DEFAULT_DISCOVERY_REQUEST_TIMEOUT_MS = 75_000;
const MAX_STDERR_BYTES = 64 * 1024;

export type RemoteHelperConnectionErrorCode =
  | 'HELPER_INCOMPATIBLE'
  | 'HELPER_TIMEOUT'
  | 'HELPER_REQUEST_FAILED';

export class RemoteHelperConnectionError extends Error {
  constructor(readonly code: RemoteHelperConnectionErrorCode) {
    super(code === 'HELPER_TIMEOUT'
      ? 'The remote helper did not answer in time.'
      : code === 'HELPER_REQUEST_FAILED'
        ? 'The remote helper could not complete the request.'
        : 'The remote helper is incompatible with this Lumora version.');
    this.name = 'RemoteHelperConnectionError';
  }
}

export interface ConnectedRemoteHelper {
  info: RemoteHelperSystemInfo;
  scanDiscovery(
    enabledProviders: readonly ProviderId[]
  ): Promise<RemoteHelperDiscoveryResult>;
  scanSessionPage(
    provider: ProviderId,
    cursor: string | null,
    limit: number
  ): Promise<RemoteHelperSessionScanResult>;
  close(): void;
}

interface PendingRequest {
  operation: RemoteHelperResponse['operation'];
  resolve(response: RemoteHelperResponse): void;
  reject(error: RemoteHelperConnectionError): void;
  timeout: ReturnType<typeof setTimeout>;
}

export function connectRemoteHelper(input: {
  channel: RemoteExecChannel;
  generation: number;
  expectedPlatform: 'win32' | 'darwin' | 'linux';
  expectedArchitecture: 'x64' | 'arm64';
  createRequestId?: () => string;
  timeoutMs?: number;
  discoveryTimeoutMs?: number;
}): Promise<ConnectedRemoteHelper> {
  const tracker = new RemoteHelperResponseTracker(input.generation);
  const decoder = createHelperFrameDecoder();
  const pending = new Map<string, PendingRequest>();
  const createRequestId = input.createRequestId ?? randomUUID;
  const timeoutMs = input.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  const discoveryTimeoutMs = input.discoveryTimeoutMs ?? Math.max(
    timeoutMs,
    DEFAULT_DISCOVERY_REQUEST_TIMEOUT_MS
  );
  let stderrBytes = 0;
  let closed = false;
  let channelClosed = false;

  const closeChannel = () => {
    if (channelClosed) return;
    channelClosed = true;
    input.channel.close();
  };
  const cleanupListeners = () => {
    input.channel.stdout.removeListener('data', onData);
    input.channel.stdout.removeListener('error', onStreamFailure);
    input.channel.stdout.removeListener('end', onStreamFailure);
    input.channel.stdout.removeListener('close', onStreamFailure);
    input.channel.stderr.removeListener('data', onStderr);
    input.channel.stderr.removeListener('error', onStreamFailure);
  };
  const failConnection = (code: RemoteHelperConnectionErrorCode) => {
    if (closed) return;
    closed = true;
    cleanupListeners();
    const error = new RemoteHelperConnectionError(code);
    for (const request of pending.values()) {
      clearTimeout(request.timeout);
      request.reject(error);
    }
    pending.clear();
    closeChannel();
  };
  const onStreamFailure = () => failConnection('HELPER_INCOMPATIBLE');
  const onStderr = (chunk: Buffer | string) => {
    stderrBytes += Buffer.isBuffer(chunk)
      ? chunk.length
      : Buffer.byteLength(chunk, 'utf8');
    if (stderrBytes > MAX_STDERR_BYTES) failConnection('HELPER_INCOMPATIBLE');
  };
  const onData = (chunk: Buffer | string) => {
    if (closed) return;
    try {
      const values = decoder.push(
        Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      );
      for (const value of values) {
        const response = RemoteHelperResponseSchema.parse(value);
        if (!tracker.accept(response)) continue;
        const request = pending.get(response.requestId);
        if (request === undefined || request.operation !== response.operation) {
          failConnection('HELPER_INCOMPATIBLE');
          return;
        }
        pending.delete(response.requestId);
        clearTimeout(request.timeout);
        if (!response.ok) {
          request.reject(new RemoteHelperConnectionError('HELPER_REQUEST_FAILED'));
        } else {
          request.resolve(response);
        }
      }
    } catch {
      failConnection('HELPER_INCOMPATIBLE');
    }
  };

  input.channel.stdout.on('data', onData);
  input.channel.stdout.on('error', onStreamFailure);
  input.channel.stdout.on('end', onStreamFailure);
  input.channel.stdout.on('close', onStreamFailure);
  input.channel.stderr.on('data', onStderr);
  input.channel.stderr.on('error', onStreamFailure);

  const send = (
    operation: RemoteHelperResponse['operation'],
    payload: Record<string, unknown>,
    requestTimeoutMs = timeoutMs
  ): Promise<RemoteHelperResponse> => {
    if (closed) {
      return Promise.reject(
        new RemoteHelperConnectionError('HELPER_INCOMPATIBLE')
      );
    }
    const requestId = createRequestId();
    const request = RemoteHelperRequestSchema.parse({
      protocolVersion: REMOTE_HELPER_PROTOCOL_VERSION,
      kind: 'request',
      generation: input.generation,
      requestId,
      operation,
      payload
    });
    return new Promise((resolve, reject) => {
      try {
        tracker.register(requestId);
        const timeout = setTimeout(() => {
          const request = pending.get(requestId);
          if (request === undefined) return;
          pending.delete(requestId);
          tracker.expire(requestId);
          request.reject(new RemoteHelperConnectionError('HELPER_TIMEOUT'));
        }, requestTimeoutMs);
        timeout.unref?.();
        pending.set(requestId, { operation, resolve, reject, timeout });
        input.channel.stdin.write(encodeHelperFrame(request));
      } catch {
        failConnection('HELPER_INCOMPATIBLE');
      }
    });
  };

  return send('handshake', {}).then((response) => {
    if (response.operation !== 'handshake' || !response.ok) {
      failConnection('HELPER_INCOMPATIBLE');
      throw new RemoteHelperConnectionError('HELPER_INCOMPATIBLE');
    }
    const info = response.result;
    if (
      info.platform !== input.expectedPlatform ||
      info.architecture !== input.expectedArchitecture ||
      info.protocolVersion !== REMOTE_HELPER_PROTOCOL_VERSION
    ) {
      failConnection('HELPER_INCOMPATIBLE');
      throw new RemoteHelperConnectionError('HELPER_INCOMPATIBLE');
    }
    return Object.freeze({
      info,
      async scanDiscovery(enabledProviders: readonly ProviderId[]) {
        const discovery = await send('discovery-scan', {
          enabledProviders: [...enabledProviders]
        }, discoveryTimeoutMs);
        if (discovery.operation !== 'discovery-scan' || !discovery.ok) {
          throw new RemoteHelperConnectionError('HELPER_INCOMPATIBLE');
        }
        return discovery.result;
      },
      async scanSessionPage(
        provider: ProviderId,
        cursor: string | null,
        limit: number
      ) {
        const sessions = await send('session-scan', {
          provider,
          cursor,
          limit
        }, discoveryTimeoutMs);
        if (sessions.operation !== 'session-scan' || !sessions.ok) {
          throw new RemoteHelperConnectionError('HELPER_INCOMPATIBLE');
        }
        return sessions.result;
      },
      close() {
        failConnection('HELPER_INCOMPATIBLE');
      }
    });
  }).catch((error: unknown) => {
    failConnection(error instanceof RemoteHelperConnectionError
      ? error.code
      : 'HELPER_INCOMPATIBLE');
    throw error instanceof RemoteHelperConnectionError
      ? error
      : new RemoteHelperConnectionError('HELPER_INCOMPATIBLE');
  });
}
