import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import {
  Client,
  type ClientChannel,
  type ConnectConfig,
  type ExecOptions
} from 'ssh2';

import {
  RemoteConnectionProfileSchema,
  RemoteTargetCredentialsSchema,
  type RemoteConnectionProfile,
  type RemoteTargetCredentials
} from '../../shared/contracts';
import { createOpenSshConfigResolver } from './open-ssh-config';
import type { RemoteCommandExecutor, RemoteCommandResult } from './platform-probe';
import { RemoteSshError } from './ssh-errors';

export interface ResolvedSshConfigHost {
  host: string;
  port: number;
  username: string;
}

export interface SftpAdapter {
  stat(
    path: string,
    callback: (error: Error | undefined, attributes?: { size: number }) => void
  ): void;
  mkdir(path: string, callback: (error?: Error) => void): void;
  fastPut(localPath: string, remotePath: string, callback: (error?: Error) => void): void;
  chmod(path: string, mode: number, callback: (error?: Error) => void): void;
  rename(from: string, to: string, callback: (error?: Error) => void): void;
  unlink(path: string, callback: (error?: Error) => void): void;
  end(): void;
}

export interface SshClientAdapter {
  on(event: string, listener: (...args: any[]) => void): this;
  once(event: string, listener: (...args: any[]) => void): this;
  removeListener(event: string, listener: (...args: any[]) => void): this;
  connect(config: Record<string, unknown>): void;
  exec(
    command: string,
    callback: (error: Error | undefined, channel: ClientChannel) => void
  ): void;
  execPty?(
    command: string,
    options: ExecOptions,
    callback: (error: Error | undefined, channel: ClientChannel) => void
  ): void;
  sftp?(callback: (error: Error | undefined, sftp: SftpAdapter) => void): void;
  end(): void;
  destroy(): void;
}

interface SshClientDependencies {
  createClient(): SshClientAdapter;
  readPrivateKey(path: string): Promise<Buffer>;
  resolveSshConfigHost(alias: string): Promise<ResolvedSshConfigHost>;
  agentSocket: string | null;
  setTimeout: typeof globalThis.setTimeout;
  clearTimeout: typeof globalThis.clearTimeout;
}

interface PrepareSshDependencies {
  readPrivateKey(path: string): Promise<Buffer>;
  resolveSshConfigHost(alias: string): Promise<ResolvedSshConfigHost>;
  agentSocket: string | null;
}

export type PreparedSshConnectionConfig = ConnectConfig & {
  host: string;
  port: number;
  username: string;
};

const DEFAULT_CONNECTION_TIMEOUT_MS = 15_000;

export function resolveDefaultSshAgentSocket(
  platform: NodeJS.Platform = process.platform,
  environment: Readonly<Record<string, string | undefined>> = process.env
): string | null {
  const configuredSocket = environment.SSH_AUTH_SOCK?.trim();
  if (configuredSocket) return configuredSocket;
  return platform === 'win32' ? '\\\\.\\pipe\\openssh-ssh-agent' : null;
}

export function fingerprintSshHostKey(key: Buffer): string {
  return `SHA256:${createHash('sha256')
    .update(key)
    .digest('base64')
    .replace(/=+$/u, '')}`;
}

async function resolveEndpoint(
  profile: RemoteConnectionProfile,
  resolveSshConfigHost: PrepareSshDependencies['resolveSshConfigHost']
): Promise<ResolvedSshConfigHost> {
  if (profile.route === 'direct') {
    if (profile.host === null || profile.port === null || profile.username === null) {
      throw new RemoteSshError(
        'SSH_CONNECTION_FAILED',
        'The remote connection profile is incomplete.'
      );
    }
    return {
      host: profile.host,
      port: profile.port,
      username: profile.username
    };
  }
  if (profile.sshConfigHost === null) {
    throw new RemoteSshError(
      'SSH_CONNECTION_FAILED',
      'The remote connection profile is incomplete.'
    );
  }
  return resolveSshConfigHost(profile.sshConfigHost);
}

export async function prepareSshConnectionConfig(
  profileInput: RemoteConnectionProfile,
  credentialsInput: RemoteTargetCredentials,
  dependencies: PrepareSshDependencies
): Promise<PreparedSshConnectionConfig> {
  const profile = RemoteConnectionProfileSchema.parse(profileInput);
  const credentials = RemoteTargetCredentialsSchema.parse(credentialsInput);
  if (profile.authentication.method !== credentials.method) {
    throw new RemoteSshError(
      'AUTHENTICATION_MISMATCH',
      'The selected authentication method does not match this profile.'
    );
  }
  const endpoint = await resolveEndpoint(profile, dependencies.resolveSshConfigHost);
  const base: PreparedSshConnectionConfig = {
    ...endpoint,
    readyTimeout: DEFAULT_CONNECTION_TIMEOUT_MS,
    keepaliveInterval: 10_000,
    keepaliveCountMax: 3
  };

  if (credentials.method === 'password') {
    return { ...base, password: credentials.password };
  }
  if (credentials.method === 'private-key') {
    if (profile.authentication.method !== 'private-key') {
      throw new RemoteSshError(
        'AUTHENTICATION_MISMATCH',
        'The selected authentication method does not match this profile.'
      );
    }
    const privateKey = await dependencies.readPrivateKey(
      profile.authentication.privateKeyPath
    );
    return {
      ...base,
      privateKey,
      ...(credentials.passphrase === null
        ? {}
        : { passphrase: credentials.passphrase })
    };
  }
  if (dependencies.agentSocket === null) {
    throw new RemoteSshError(
      'SSH_AGENT_UNAVAILABLE',
      'No SSH authentication agent is available.'
    );
  }
  return { ...base, agent: dependencies.agentSocket };
}

function commandExecutor(
  client: SshClientAdapter,
  timers: Pick<SshClientDependencies, 'setTimeout' | 'clearTimeout'>
): RemoteCommandExecutor {
  return (command, limits) => new Promise<RemoteCommandResult>((resolve, reject) => {
    let settled = false;
    const fail = (error: RemoteSshError) => {
      if (settled) return;
      settled = true;
      timers.clearTimeout(timeout);
      reject(error);
    };
    const timeout = timers.setTimeout(() => fail(new RemoteSshError(
      'SSH_TIMEOUT',
      'The remote command timed out.'
    )), limits.timeoutMs);

    client.exec(command, (error, channel) => {
      if (error !== undefined) {
        fail(new RemoteSshError(
          'SSH_CONNECTION_FAILED',
          'Lumora could not run the remote probe.'
        ));
        return;
      }
      const stdout: Buffer[] = [];
      const stderr: Buffer[] = [];
      let bytes = 0;
      const collect = (destination: Buffer[], chunk: Buffer | string) => {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        bytes += buffer.length;
        if (bytes > limits.maxOutputBytes) {
          channel.destroy();
          fail(new RemoteSshError(
            'SSH_OUTPUT_LIMIT',
            'The remote command exceeded its output limit.'
          ));
          return;
        }
        destination.push(buffer);
      };
      channel.on('data', (chunk: Buffer | string) => collect(stdout, chunk));
      channel.stderr.on('data', (chunk: Buffer | string) =>
        collect(stderr, chunk)
      );
      channel.on('close', (code: number | null) => {
        if (settled) return;
        settled = true;
        timers.clearTimeout(timeout);
        resolve({
          exitCode: code ?? 1,
          stdout: Buffer.concat(stdout).toString('utf8'),
          stderr: Buffer.concat(stderr).toString('utf8')
        });
      });
      channel.on('error', () => fail(new RemoteSshError(
        'SSH_CONNECTION_FAILED',
        'Lumora could not run the remote probe.'
      )));
    });
  });
}

export interface ConnectedRemoteSshClient {
  execute: RemoteCommandExecutor;
  openExec(command: string): Promise<RemoteExecChannel>;
  openPtyExec(
    command: string,
    size: { cols: number; rows: number }
  ): Promise<RemotePtyChannel>;
  openFileTransfer(): Promise<RemoteFileTransfer>;
  onClose(listener: () => void): () => void;
  close(): void;
}

export interface RemoteExecChannel {
  stdin: NodeJS.WritableStream;
  stdout: NodeJS.ReadableStream;
  stderr: NodeJS.ReadableStream;
  close(): void;
}

export interface RemotePtyChannel {
  readonly pid: null;
  write(data: string): void;
  resize(cols: number, rows: number): void;
  kill(): void;
  onData(listener: (data: string) => void): { dispose(): void };
  onExit(listener: (event: { exitCode: number | null }) => void): {
    dispose(): void;
  };
}

export interface RemoteFileTransfer {
  stat(path: string): Promise<{ exists: boolean; size: number | null }>;
  mkdir(path: string): Promise<void>;
  upload(localPath: string, remotePath: string): Promise<void>;
  chmod(path: string, mode: number): Promise<void>;
  rename(from: string, to: string): Promise<void>;
  remove(path: string): Promise<void>;
  close(): void;
}

function remoteOperationFailed(): RemoteSshError {
  return new RemoteSshError(
    'SSH_CONNECTION_FAILED',
    'Lumora could not complete the remote operation.'
  );
}

function isMissingFile(error: Error): boolean {
  if (!('code' in error)) return false;
  const code = (error as Error & { code?: unknown }).code;
  return code === 'ENOENT' || code === 2;
}

function createRemoteFileTransfer(sftp: SftpAdapter): RemoteFileTransfer {
  let closed = false;
  const ensureOpen = () => {
    if (closed) throw remoteOperationFailed();
  };
  const operation = (
    run: (callback: (error?: Error) => void) => void
  ): Promise<void> => new Promise((resolve, reject) => {
    try {
      ensureOpen();
      run((error) => error === undefined ? resolve() : reject(remoteOperationFailed()));
    } catch {
      reject(remoteOperationFailed());
    }
  });

  return {
    stat(path) {
      return new Promise((resolve, reject) => {
        try {
          ensureOpen();
          sftp.stat(path, (error, attributes) => {
            if (error !== undefined) {
              if (isMissingFile(error)) {
                resolve({ exists: false, size: null });
              } else {
                reject(remoteOperationFailed());
              }
              return;
            }
            if (attributes === undefined || !Number.isSafeInteger(attributes.size)) {
              reject(remoteOperationFailed());
              return;
            }
            resolve({ exists: true, size: attributes.size });
          });
        } catch {
          reject(remoteOperationFailed());
        }
      });
    },
    mkdir: (path) => operation((callback) => sftp.mkdir(path, callback)),
    upload: (localPath, remotePath) => operation((callback) =>
      sftp.fastPut(localPath, remotePath, callback)
    ),
    chmod: (path, mode) => operation((callback) => sftp.chmod(path, mode, callback)),
    rename: (from, to) => operation((callback) => sftp.rename(from, to, callback)),
    remove: (path) => operation((callback) => sftp.unlink(path, callback)),
    close() {
      if (closed) return;
      closed = true;
      sftp.end();
    }
  };
}

function createRemotePtyChannel(channel: ClientChannel): RemotePtyChannel {
  let closed = false;
  let exitCode: number | null = null;
  let exitReported = false;
  const dataListeners = new Set<(data: string) => void>();
  const exitListeners = new Set<(event: { exitCode: number | null }) => void>();
  const reportExit = () => {
    if (exitReported) return;
    exitReported = true;
    closed = true;
    const event = { exitCode };
    for (const listener of [...exitListeners]) {
      try {
        listener(event);
      } catch {
        // Native transport events must never surface consumer failures.
      }
    }
    dataListeners.clear();
    exitListeners.clear();
  };
  channel.on('data', (chunk: Buffer | string) => {
    if (closed) return;
    const data = Buffer.isBuffer(chunk) ? chunk.toString('utf8') : chunk;
    for (const listener of [...dataListeners]) listener(data);
  });
  channel.on('exit', (code: number | null) => {
    exitCode = Number.isSafeInteger(code) ? code : null;
  });
  channel.on('close', reportExit);
  channel.on('error', reportExit);

  return {
    pid: null,
    write(data) {
      if (!closed) channel.write(data);
    },
    resize(cols, rows) {
      if (!closed) channel.setWindow(rows, cols, 0, 0);
    },
    kill() {
      if (closed) return;
      closed = true;
      channel.close();
    },
    onData(listener) {
      if (!closed) dataListeners.add(listener);
      return { dispose: () => dataListeners.delete(listener) };
    },
    onExit(listener) {
      if (exitReported) {
        listener({ exitCode });
        return { dispose: () => undefined };
      }
      exitListeners.add(listener);
      return { dispose: () => exitListeners.delete(listener) };
    }
  };
}

export function createRemoteSshClient(
  input: Partial<SshClientDependencies> = {}
) {
  const dependencies: SshClientDependencies = {
    createClient: input.createClient ?? (() => {
      const client = new Client();
      const adapter = client as unknown as SshClientAdapter;
      adapter.execPty = (command, options, callback) => {
        client.exec(command, options, callback);
      };
      return adapter;
    }),
    readPrivateKey: input.readPrivateKey ?? ((path) => readFile(path)),
    resolveSshConfigHost: input.resolveSshConfigHost ??
      createOpenSshConfigResolver(),
    agentSocket: input.agentSocket === undefined
      ? resolveDefaultSshAgentSocket()
      : input.agentSocket,
    setTimeout: input.setTimeout ?? globalThis.setTimeout,
    clearTimeout: input.clearTimeout ?? globalThis.clearTimeout
  };

  return {
    async observeHostKey(profileInput: RemoteConnectionProfile) {
      const profile = RemoteConnectionProfileSchema.parse(profileInput);
      const endpoint = await resolveEndpoint(
        profile,
        dependencies.resolveSshConfigHost
      );
      const client = dependencies.createClient();
      return new Promise<{
        executionTargetId: RemoteConnectionProfile['executionTargetId'];
        fingerprint: string;
      }>((resolve, reject) => {
        let settled = false;
        const timeout = dependencies.setTimeout(() => {
          if (settled) return;
          settled = true;
          client.destroy();
          reject(new RemoteSshError(
            'SSH_TIMEOUT',
            'The remote computer did not answer in time.'
          ));
        }, DEFAULT_CONNECTION_TIMEOUT_MS);
        const fail = () => {
          if (settled) return;
          settled = true;
          dependencies.clearTimeout(timeout);
          client.destroy();
          reject(new RemoteSshError(
            'HOST_KEY_UNAVAILABLE',
            'Lumora could not read the remote computer identity.'
          ));
        };
        client.on('error', fail);
        client.connect({
          ...endpoint,
          readyTimeout: DEFAULT_CONNECTION_TIMEOUT_MS,
          authHandler: () => false,
          hostVerifier: (key: Buffer) => {
            if (!settled) {
              settled = true;
              dependencies.clearTimeout(timeout);
              const fingerprint = fingerprintSshHostKey(key);
              client.end();
              resolve({
                executionTargetId: profile.executionTargetId,
                fingerprint
              });
            }
            return false;
          }
        });
      });
    },

    async connect(
      profileInput: RemoteConnectionProfile,
      credentials: RemoteTargetCredentials
    ): Promise<ConnectedRemoteSshClient> {
      const profile = RemoteConnectionProfileSchema.parse(profileInput);
      if (profile.verifiedHostFingerprint === null) {
        throw new RemoteSshError(
          'HOST_KEY_UNAVAILABLE',
          'Trust the remote computer identity before connecting.'
        );
      }
      const prepared = await prepareSshConnectionConfig(
        profile,
        credentials,
        dependencies
      );
      const client = dependencies.createClient();
      return new Promise<ConnectedRemoteSshClient>((resolve, reject) => {
        let settled = false;
        let hostChanged = false;
        const timeout = dependencies.setTimeout(() => {
          if (settled) return;
          settled = true;
          client.destroy();
          reject(new RemoteSshError(
            'SSH_TIMEOUT',
            'The SSH connection timed out.'
          ));
        }, DEFAULT_CONNECTION_TIMEOUT_MS);
        const fail = () => {
          if (settled) return;
          settled = true;
          dependencies.clearTimeout(timeout);
          client.destroy();
          reject(new RemoteSshError(
            hostChanged ? 'HOST_KEY_CHANGED' : 'AUTHENTICATION_FAILED',
            hostChanged
              ? 'The remote computer identity has changed.'
              : 'SSH authentication failed.'
          ));
        };
        client.once('error', fail);
        client.once('close', fail);
        client.once('ready', () => {
          if (settled) return;
          settled = true;
          dependencies.clearTimeout(timeout);
          let connectionClosed = false;
          const closeListeners = new Set<() => void>();
          const notifyCloseListener = (listener: () => void) => {
            try {
              listener();
            } catch {
              // Native transport events must never surface consumer failures.
            }
          };
          const handleTransportClose = () => {
            if (connectionClosed) return;
            connectionClosed = true;
            const listeners = [...closeListeners];
            closeListeners.clear();
            for (const listener of listeners) notifyCloseListener(listener);
          };
          client.on('close', handleTransportClose);
          client.on('error', handleTransportClose);
          resolve({
            execute: commandExecutor(client, dependencies),
            openExec(command) {
              if (connectionClosed) return Promise.reject(remoteOperationFailed());
              return new Promise<RemoteExecChannel>((resolveChannel, rejectChannel) => {
                let opened = false;
                const openTimeout = dependencies.setTimeout(() => {
                  if (opened) return;
                  opened = true;
                  rejectChannel(new RemoteSshError(
                    'SSH_TIMEOUT',
                    'The remote helper channel timed out.'
                  ));
                }, DEFAULT_CONNECTION_TIMEOUT_MS);
                client.exec(command, (error, channel) => {
                  if (opened) {
                    channel?.destroy();
                    return;
                  }
                  opened = true;
                  dependencies.clearTimeout(openTimeout);
                  if (connectionClosed || error !== undefined) {
                    channel?.destroy();
                    rejectChannel(remoteOperationFailed());
                    return;
                  }
                  let channelClosed = false;
                  resolveChannel({
                    stdin: channel,
                    stdout: channel,
                    stderr: channel.stderr,
                    close() {
                      if (channelClosed) return;
                      channelClosed = true;
                      channel.destroy();
                    }
                  });
                });
              });
            },
            openPtyExec(command, size) {
              if (connectionClosed || client.execPty === undefined) {
                return Promise.reject(remoteOperationFailed());
              }
              return new Promise<RemotePtyChannel>((resolveChannel, rejectChannel) => {
                let opened = false;
                const openTimeout = dependencies.setTimeout(() => {
                  if (opened) return;
                  opened = true;
                  rejectChannel(new RemoteSshError(
                    'SSH_TIMEOUT',
                    'The remote terminal channel timed out.'
                  ));
                }, DEFAULT_CONNECTION_TIMEOUT_MS);
                client.execPty!(command, {
                  pty: {
                    term: 'xterm-256color',
                    cols: size.cols,
                    rows: size.rows,
                    width: 0,
                    height: 0
                  }
                }, (error, channel) => {
                  if (opened) {
                    channel?.destroy();
                    return;
                  }
                  opened = true;
                  dependencies.clearTimeout(openTimeout);
                  if (connectionClosed || error !== undefined) {
                    channel?.destroy();
                    rejectChannel(remoteOperationFailed());
                    return;
                  }
                  resolveChannel(createRemotePtyChannel(channel));
                });
              });
            },
            openFileTransfer() {
              if (connectionClosed || client.sftp === undefined) {
                return Promise.reject(remoteOperationFailed());
              }
              return new Promise<RemoteFileTransfer>((resolveTransfer, rejectTransfer) => {
                let opened = false;
                const openTimeout = dependencies.setTimeout(() => {
                  if (opened) return;
                  opened = true;
                  rejectTransfer(new RemoteSshError(
                    'SSH_TIMEOUT',
                    'The remote file transfer timed out.'
                  ));
                }, DEFAULT_CONNECTION_TIMEOUT_MS);
                client.sftp!((error, sftp) => {
                  if (opened) {
                    sftp?.end();
                    return;
                  }
                  opened = true;
                  dependencies.clearTimeout(openTimeout);
                  if (connectionClosed || error !== undefined) {
                    sftp?.end();
                    rejectTransfer(remoteOperationFailed());
                    return;
                  }
                  resolveTransfer(createRemoteFileTransfer(sftp));
                });
              });
            },
            onClose(listener) {
              if (connectionClosed) {
                notifyCloseListener(listener);
                return () => undefined;
              }
              closeListeners.add(listener);
              return () => closeListeners.delete(listener);
            },
            close() {
              if (connectionClosed) return;
              connectionClosed = true;
              closeListeners.clear();
              client.removeListener('close', handleTransportClose);
              client.removeListener('error', handleTransportClose);
              client.end();
            }
          });
        });
        client.connect({
          ...prepared,
          hostVerifier: (key: Buffer) => {
            const matches =
              fingerprintSshHostKey(key) === profile.verifiedHostFingerprint;
            hostChanged = !matches;
            return matches;
          }
        });
      });
    }
  };
}
