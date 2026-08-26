import type { Readable, Writable } from 'node:stream';

export type LineJsonRpcErrorCode =
  | 'STRUCTURED_TRANSPORT_CLOSED'
  | 'STRUCTURED_TRANSPORT_EXITED'
  | 'STRUCTURED_TRANSPORT_FAILED'
  | 'STRUCTURED_TRANSPORT_INVALID_MESSAGE'
  | 'STRUCTURED_TRANSPORT_LIMIT_EXCEEDED'
  | 'STRUCTURED_TRANSPORT_PROTOCOL_ERROR'
  | 'STRUCTURED_TRANSPORT_TIMEOUT';

export class LineJsonRpcError extends Error {
  constructor(
    readonly code: LineJsonRpcErrorCode,
    message: string
  ) {
    super(message);
    this.name = 'LineJsonRpcError';
  }
}

export interface JsonRpcLineProcess {
  readonly stdin: Writable;
  readonly stdout: Readable;
  readonly stderr: Readable;
  on(event: 'error', listener: (error: Error) => void): unknown;
  on(
    event: 'exit',
    listener: (code: number | null, signal: NodeJS.Signals | null) => void
  ): unknown;
  once(
    event: 'exit',
    listener: (code: number | null, signal: NodeJS.Signals | null) => void
  ): unknown;
  kill(): boolean;
}

export interface JsonRpcNotification {
  method: string;
  params: unknown;
}

export interface JsonRpcProviderRequest extends JsonRpcNotification {
  id: string | number;
}

export interface LineJsonRpcTransport {
  request(method: string, params: unknown): Promise<unknown>;
  notify(method: string, params?: unknown): Promise<void>;
  onNotification(listener: (notification: JsonRpcNotification) => void): () => void;
  close(): Promise<void>;
}

export interface CreateLineJsonRpcTransportOptions {
  requestTimeoutMs?: number;
  maxFrameBytes?: number;
  closeGraceMs?: number;
  handleRequest?: (request: JsonRpcProviderRequest) => Promise<unknown>;
}

interface PendingRequest {
  resolve(value: unknown): void;
  reject(error: Error): void;
  timer: ReturnType<typeof setTimeout>;
}

const JSON_RPC_VERSION = '2.0';
const SAFE_METHOD = /^[a-zA-Z0-9][a-zA-Z0-9/_.:-]{0,255}$/;

function protocolError(message: string): LineJsonRpcError {
  return new LineJsonRpcError(
    'STRUCTURED_TRANSPORT_PROTOCOL_ERROR',
    message
  );
}

class JsonRpcLineTransport implements LineJsonRpcTransport {
  private readonly pending = new Map<number, PendingRequest>();
  private readonly notificationListeners = new Set<
    (notification: JsonRpcNotification) => void
  >();
  private nextRequestId = 1;
  private buffer = '';
  private terminalError: LineJsonRpcError | null = null;
  private exited = false;
  private closing = false;
  private closePromise: Promise<void> | null = null;

  constructor(
    private readonly process: JsonRpcLineProcess,
    private readonly options: Required<
      Omit<CreateLineJsonRpcTransportOptions, 'handleRequest'>
    > & Pick<CreateLineJsonRpcTransportOptions, 'handleRequest'>
  ) {
    process.stdout.setEncoding('utf8');
    process.stderr.setEncoding('utf8');
    process.stdout.on('data', (chunk: string) => this.acceptOutput(chunk));
    process.stderr.on('data', () => undefined);
    process.on('error', () => {
      this.fail(new LineJsonRpcError(
        'STRUCTURED_TRANSPORT_FAILED',
        'The structured provider process could not start.'
      ));
    });
    process.on('exit', (code) => this.acceptExit(code));
  }

  request(method: string, params: unknown): Promise<unknown> {
    const unavailable = this.unavailableError();
    if (unavailable !== null) return Promise.reject(unavailable);
    if (!SAFE_METHOD.test(method)) {
      return Promise.reject(protocolError('The JSON-RPC method is invalid.'));
    }

    const id = this.nextRequestId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        const error = new LineJsonRpcError(
          'STRUCTURED_TRANSPORT_TIMEOUT',
          `The structured provider request ${method} timed out.`
        );
        reject(error);
        this.fail(error);
      }, this.options.requestTimeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.write({ jsonrpc: JSON_RPC_VERSION, id, method, params }).catch(
        (error: unknown) => {
          clearTimeout(timer);
          this.pending.delete(id);
          const normalized = error instanceof LineJsonRpcError
            ? error
            : new LineJsonRpcError(
              'STRUCTURED_TRANSPORT_FAILED',
              'The structured provider request could not be written.'
            );
          reject(normalized);
          this.fail(normalized);
        }
      );
    });
  }

  async notify(method: string, params: unknown = null): Promise<void> {
    const unavailable = this.unavailableError();
    if (unavailable !== null) throw unavailable;
    if (!SAFE_METHOD.test(method)) {
      throw protocolError('The JSON-RPC method is invalid.');
    }
    await this.write({ jsonrpc: JSON_RPC_VERSION, method, params });
  }

  onNotification(
    listener: (notification: JsonRpcNotification) => void
  ): () => void {
    this.notificationListeners.add(listener);
    return () => this.notificationListeners.delete(listener);
  }

  close(): Promise<void> {
    if (this.closePromise !== null) return this.closePromise;
    this.closing = true;
    this.rejectPending(new LineJsonRpcError(
      'STRUCTURED_TRANSPORT_CLOSED',
      'The structured provider connection was closed.'
    ));
    this.notificationListeners.clear();

    if (this.exited) {
      this.closePromise = Promise.resolve();
      return this.closePromise;
    }

    this.closePromise = new Promise<void>((resolve) => {
      let resolved = false;
      const finish = (): void => {
        if (resolved) return;
        resolved = true;
        clearTimeout(timer);
        resolve();
      };
      const timer = setTimeout(() => {
        if (!this.exited) this.process.kill();
        finish();
      }, this.options.closeGraceMs);
      this.process.once('exit', finish);
      this.process.stdin.end();
    });
    return this.closePromise;
  }

  private unavailableError(): LineJsonRpcError | null {
    if (this.terminalError !== null) return this.terminalError;
    if (this.closing || this.exited) {
      return new LineJsonRpcError(
        'STRUCTURED_TRANSPORT_CLOSED',
        'The structured provider connection is closed.'
      );
    }
    return null;
  }

  private write(message: unknown): Promise<void> {
    let serialized: string;
    try {
      serialized = `${JSON.stringify(message)}\n`;
    } catch {
      return Promise.reject(protocolError('The JSON-RPC message is not serializable.'));
    }
    if (Buffer.byteLength(serialized) > this.options.maxFrameBytes) {
      return Promise.reject(new LineJsonRpcError(
        'STRUCTURED_TRANSPORT_LIMIT_EXCEEDED',
        'The structured provider request exceeded its safety limit.'
      ));
    }

    return new Promise((resolve, reject) => {
      this.process.stdin.write(serialized, (error) => {
        if (error) {
          reject(new LineJsonRpcError(
            'STRUCTURED_TRANSPORT_FAILED',
            'The structured provider request could not be written.'
          ));
          return;
        }
        resolve();
      });
    });
  }

  private acceptOutput(chunk: string): void {
    if (this.terminalError !== null || this.exited) return;
    this.buffer += chunk;

    let newline = this.buffer.indexOf('\n');
    while (newline >= 0) {
      const line = this.buffer.slice(0, newline).trim();
      this.buffer = this.buffer.slice(newline + 1);
      if (line.length > 0) this.acceptLine(line);
      if (this.terminalError !== null) return;
      newline = this.buffer.indexOf('\n');
    }

    if (Buffer.byteLength(this.buffer) > this.options.maxFrameBytes) {
      this.fail(new LineJsonRpcError(
        'STRUCTURED_TRANSPORT_LIMIT_EXCEEDED',
        'The structured provider response exceeded its safety limit.'
      ));
    }
  }

  private acceptLine(line: string): void {
    if (Buffer.byteLength(line) > this.options.maxFrameBytes) {
      this.fail(new LineJsonRpcError(
        'STRUCTURED_TRANSPORT_LIMIT_EXCEEDED',
        'The structured provider response exceeded its safety limit.'
      ));
      return;
    }

    let message: unknown;
    try {
      message = JSON.parse(line);
    } catch {
      this.fail(new LineJsonRpcError(
        'STRUCTURED_TRANSPORT_INVALID_MESSAGE',
        'The structured provider returned invalid JSON.'
      ));
      return;
    }
    if (typeof message !== 'object' || message === null) {
      this.fail(protocolError('The structured provider returned an invalid message.'));
      return;
    }

    const value = message as Record<string, unknown>;
    if (value.jsonrpc !== undefined && value.jsonrpc !== JSON_RPC_VERSION) {
      this.fail(protocolError('The structured provider returned an unsupported protocol version.'));
      return;
    }
    if (typeof value.method === 'string') {
      if (!SAFE_METHOD.test(value.method)) {
        this.fail(protocolError('The structured provider returned an invalid method.'));
        return;
      }
      if (typeof value.id === 'number' || typeof value.id === 'string') {
        void this.handleProviderRequest({
          id: value.id,
          method: value.method,
          params: value.params ?? null
        });
        return;
      }
      const notification = {
        method: value.method,
        params: value.params ?? null
      };
      for (const listener of this.notificationListeners) {
        listener(notification);
      }
      return;
    }
    this.acceptResponse(value);
  }

  private acceptResponse(message: Record<string, unknown>): void {
    if (typeof message.id !== 'number') return;
    const pending = this.pending.get(message.id);
    if (pending === undefined) return;
    clearTimeout(pending.timer);
    this.pending.delete(message.id);
    if (message.error !== undefined) {
      pending.reject(protocolError('The structured provider returned a protocol error.'));
      return;
    }
    pending.resolve(message.result);
  }

  private async handleProviderRequest(
    request: JsonRpcProviderRequest
  ): Promise<void> {
    if (this.options.handleRequest === undefined) {
      await this.write({
        jsonrpc: JSON_RPC_VERSION,
        id: request.id,
        error: { code: -32601, message: 'Method not supported.' }
      }).catch(() => undefined);
      return;
    }
    try {
      const result = await this.options.handleRequest(request);
      await this.write({ jsonrpc: JSON_RPC_VERSION, id: request.id, result });
    } catch {
      await this.write({
        jsonrpc: JSON_RPC_VERSION,
        id: request.id,
        error: { code: -32603, message: 'The client operation failed.' }
      }).catch(() => undefined);
    }
  }

  private acceptExit(code: number | null): void {
    this.exited = true;
    if (this.closing) return;
    this.fail(new LineJsonRpcError(
      'STRUCTURED_TRANSPORT_EXITED',
      code === 0
        ? 'The structured provider exited.'
        : 'The structured provider exited unexpectedly.'
    ));
  }

  private rejectPending(error: LineJsonRpcError): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }

  private fail(error: LineJsonRpcError): void {
    if (this.terminalError !== null) return;
    this.terminalError = error;
    this.rejectPending(error);
    this.notificationListeners.clear();
    if (!this.exited && !this.closing) this.process.kill();
  }
}

export function createLineJsonRpcTransport(
  process: JsonRpcLineProcess,
  options: CreateLineJsonRpcTransportOptions = {}
): LineJsonRpcTransport {
  return new JsonRpcLineTransport(process, {
    requestTimeoutMs: options.requestTimeoutMs ?? 10_000,
    maxFrameBytes: options.maxFrameBytes ?? 1024 * 1024,
    closeGraceMs: options.closeGraceMs ?? 1_000,
    ...(options.handleRequest === undefined
      ? {}
      : { handleRequest: options.handleRequest })
  });
}
