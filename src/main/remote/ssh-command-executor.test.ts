import { EventEmitter } from 'node:events';
import type { ClientChannel } from 'ssh2';
import { describe, expect, it, vi } from 'vitest';

import type { RemoteConnectionProfile } from '../../shared/contracts';
import {
  createRemoteSshClient,
  fingerprintSshHostKey,
  type SshClientAdapter
} from './ssh-client';

const HOST_KEY = Buffer.from('verified-build-server');

class FakeChannel extends EventEmitter {
  readonly stderr = new EventEmitter();
  readonly destroy = vi.fn();
}

class ExecutingFakeClient extends EventEmitter implements SshClientAdapter {
  readonly end = vi.fn();
  readonly destroy = vi.fn();
  readonly channel = new FakeChannel();
  connectConfig: Record<string, unknown> | null = null;

  connect(config: Record<string, unknown>): void {
    this.connectConfig = config;
  }

  exec(
    _command: string,
    callback: (error: Error | undefined, channel: ClientChannel) => void
  ): void {
    callback(undefined, this.channel as unknown as ClientChannel);
  }
}

function profile(): RemoteConnectionProfile {
  return {
    executionTargetId: '8e117c5e-3016-4850-a2d8-c1a628e07e7f',
    displayName: 'Build server',
    route: 'direct',
    host: 'build.internal',
    port: 22,
    username: 'builder',
    sshConfigHost: null,
    authentication: { method: 'password' },
    verifiedHostFingerprint: fingerprintSshHostKey(HOST_KEY),
    createdAt: '2026-08-04T06:00:00.000Z',
    updatedAt: '2026-08-04T06:00:00.000Z'
  };
}

async function connect(client: ExecutingFakeClient) {
  const connecting = createRemoteSshClient({
    createClient: () => client,
    readPrivateKey: vi.fn(),
    resolveSshConfigHost: vi.fn(),
    agentSocket: null
  }).connect(profile(), { method: 'password', password: 'memory-only' });
  await vi.waitFor(() => expect(client.connectConfig).not.toBeNull());
  const verifier = client.connectConfig?.hostVerifier as (key: Buffer) => boolean;
  expect(verifier(HOST_KEY)).toBe(true);
  client.emit('ready');
  return connecting;
}

describe('remote SSH command execution', () => {
  it('collects bounded stdout, stderr, and the remote exit code', async () => {
    const client = new ExecutingFakeClient();
    const connected = await connect(client);
    const result = connected.execute('probe', {
      timeoutMs: 1_000,
      maxOutputBytes: 1_024
    });

    client.channel.emit('data', Buffer.from('Linux'));
    client.channel.stderr.emit('data', 'notice');
    client.channel.emit('close', 0);

    await expect(result).resolves.toEqual({
      exitCode: 0,
      stdout: 'Linux',
      stderr: 'notice'
    });
  });

  it('destroys a command channel that exceeds the output limit', async () => {
    const client = new ExecutingFakeClient();
    const connected = await connect(client);
    const result = connected.execute('probe', {
      timeoutMs: 1_000,
      maxOutputBytes: 3
    });

    client.channel.emit('data', 'four');

    await expect(result).rejects.toMatchObject({ code: 'SSH_OUTPUT_LIMIT' });
    expect(client.channel.destroy).toHaveBeenCalledOnce();
  });
});
