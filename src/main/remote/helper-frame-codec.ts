import { REMOTE_HELPER_MAX_CONTROL_FRAME_BYTES } from '../../shared/remote-helper-protocol';

export class HelperFrameProtocolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HelperFrameProtocolError';
  }
}

interface HelperFrameDecoderOptions {
  maxFrameBytes?: number;
}

export function encodeHelperFrame(
  value: unknown,
  maxFrameBytes = REMOTE_HELPER_MAX_CONTROL_FRAME_BYTES
): Buffer {
  let payload: Buffer;
  try {
    payload = Buffer.from(JSON.stringify(value), 'utf8');
  } catch {
    throw new HelperFrameProtocolError('The helper frame is not valid JSON.');
  }
  if (payload.length === 0 || payload.length > maxFrameBytes) {
    throw new HelperFrameProtocolError('The helper frame size is invalid.');
  }
  const frame = Buffer.allocUnsafe(4 + payload.length);
  frame.writeUInt32BE(payload.length, 0);
  payload.copy(frame, 4);
  return frame;
}

export function createHelperFrameDecoder({
  maxFrameBytes = REMOTE_HELPER_MAX_CONTROL_FRAME_BYTES
}: HelperFrameDecoderOptions = {}) {
  let failed = false;
  const header = Buffer.alloc(4);
  let headerBytes = 0;
  let payload: Buffer | null = null;
  let payloadBytes = 0;

  const fail = (message: string): never => {
    failed = true;
    throw new HelperFrameProtocolError(message);
  };

  return {
    push(chunk: Buffer): unknown[] {
      if (failed) return fail('The helper frame decoder has already failed.');
      const values: unknown[] = [];
      let offset = 0;
      while (offset < chunk.length) {
        if (payload === null) {
          const headerRemaining = 4 - headerBytes;
          const copied = Math.min(headerRemaining, chunk.length - offset);
          chunk.copy(header, headerBytes, offset, offset + copied);
          headerBytes += copied;
          offset += copied;
          if (headerBytes < 4) continue;
          const size = header.readUInt32BE(0);
          headerBytes = 0;
          if (size === 0 || size > maxFrameBytes) {
            return fail('The helper frame size is invalid.');
          }
          payload = Buffer.allocUnsafe(size);
          payloadBytes = 0;
        }

        const payloadRemaining = payload.length - payloadBytes;
        const copied = Math.min(payloadRemaining, chunk.length - offset);
        chunk.copy(payload, payloadBytes, offset, offset + copied);
        payloadBytes += copied;
        offset += copied;
        if (payloadBytes < payload.length) continue;

        let value: unknown;
        try {
          value = JSON.parse(payload.toString('utf8')) as unknown;
        } catch {
          return fail('The helper frame contains invalid JSON.');
        }
        if (value === null || typeof value !== 'object' || Array.isArray(value)) {
          return fail('The helper frame must contain a JSON object.');
        }
        values.push(value);
        payload = null;
        payloadBytes = 0;
      }
      return values;
    },

    finish(): void {
      if (failed) return fail('The helper frame decoder has already failed.');
      if (headerBytes !== 0 || payload !== null) {
        return fail('The helper stream ended with an incomplete frame.');
      }
    }
  };
}

interface TrackedResponseIdentity {
  generation: number;
  requestId: string;
}

export class RemoteHelperResponseTracker {
  readonly #pending = new Set<string>();
  readonly #completed = new Set<string>();
  readonly #expired = new Set<string>();

  constructor(readonly generation: number) {}

  register(requestId: string): void {
    if (this.#pending.has(requestId) || this.#completed.has(requestId)) {
      throw new HelperFrameProtocolError('The helper request ID is duplicated.');
    }
    this.#pending.add(requestId);
  }

  expire(requestId: string): boolean {
    if (!this.#pending.delete(requestId)) return false;
    this.#expired.add(requestId);
    return true;
  }

  accept(response: TrackedResponseIdentity): boolean {
    if (response.generation !== this.generation) {
      throw new HelperFrameProtocolError('The helper response belongs to a stale connection.');
    }
    if (this.#completed.has(response.requestId)) {
      throw new HelperFrameProtocolError('The helper response is duplicated.');
    }
    if (this.#expired.delete(response.requestId)) return false;
    if (!this.#pending.delete(response.requestId)) {
      throw new HelperFrameProtocolError('The helper response has an unknown request ID.');
    }
    this.#completed.add(response.requestId);
    return true;
  }
}
