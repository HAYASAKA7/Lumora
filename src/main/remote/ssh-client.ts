import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { Client, type ClientChannel, type ConnectConfig } from 'ssh2';

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

export interface SshClientAdapter {
  on(event: string, listener: (...args: any[]) => void): this;
  once(event: string, listener: (...args: any[]) => void): this;
  removeListener(event: string, listener: (...args: any[]) => void): this;
  connect(config: Record<string, unknown>): void;
  exec(
    command: string,
    callback: (error: Error | undefined, channel: ClientChannel) => void
  ): void;
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
  close(): void;
}

export function createRemoteSshClient(
  input: Partial<SshClientDependencies> = {}
) {
  const dependencies: SshClientDependencies = {
    createClient: input.createClient ?? (() => new Client() as unknown as SshClientAdapter),
    readPrivateKey: input.readPrivateKey ?? ((path) => readFile(path)),
    resolveSshConfigHost: input.resolveSshConfigHost ??
      createOpenSshConfigResolver(),
    agentSocket: input.agentSocket ?? process.env.SSH_AUTH_SOCK ?? null,
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
          resolve({
            execute: commandExecutor(client, dependencies),
            close: () => client.end()
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
