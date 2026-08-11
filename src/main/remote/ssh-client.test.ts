import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';

import type {
  RemoteConnectionProfile,
  RemoteTargetCredentials
} from '../../shared/contracts';
import {
  createRemoteSshClient,
  fingerprintSshHostKey,
  prepareSshConnectionConfig,
  type RemotePtyChannel,
  type SshClientAdapter
} from './ssh-client';
import { RemoteSshError } from './ssh-errors';

const TARGET_ID = '4f632901-1f8d-44c0-8418-aa823f791ca0';

function profile(
  authentication: RemoteConnectionProfile['authentication'],
  fingerprint: string | null = 'SHA256:57qsnZ7C9rC8S3dftMDSqdHcpZ+PZfNclRBfXZXp0mM'
): RemoteConnectionProfile {
  return {
    executionTargetId: TARGET_ID,
    displayName: 'Build server',
    route: 'direct',
    host: 'build.internal',
    port: 2222,
    username: 'builder',
    sshConfigHost: null,
    authentication,
    verifiedHostFingerprint: fingerprint,
    createdAt: '2026-08-04T06:00:00.000Z',
    updatedAt: '2026-08-04T06:00:00.000Z'
  };
}

class FakeClient extends EventEmitter implements SshClientAdapter {
  readonly end = vi.fn();
  readonly destroy = vi.fn();
  connectConfig: Record<string, unknown> | null = null;

  connect(config: Record<string, unknown>): void {
    this.connectConfig = config;
  }

  exec(): never {
    throw new Error('exec was not expected');
  }
}

class FakePtyChannel extends EventEmitter {
  readonly stderr = new EventEmitter();
  readonly write = vi.fn();
  readonly setWindow = vi.fn();
  readonly signal = vi.fn();
  readonly close = vi.fn();
  readonly destroy = vi.fn();
}

class FakePtyClient extends FakeClient {
  readonly channel = new FakePtyChannel();
  command: string | null = null;
  options: Record<string, unknown> | null = null;

  execPty(
    command: string,
    options: Record<string, unknown>,
    callback: (error: Error | undefined, channel: any) => void
  ): void {
    this.command = command;
    this.options = options;
    callback(undefined, this.channel);
  }
}

async function connectReady(client: FakeClient) {
  const ssh = createRemoteSshClient({
    createClient: () => client,
    readPrivateKey: vi.fn(),
    resolveSshConfigHost: vi.fn(),
    agentSocket: null
  });
  const connecting = ssh.connect(
    profile({ method: 'password' }),
    { method: 'password', password: 'not-logged' }
  );
  await vi.waitFor(() => expect(client.connectConfig).not.toBeNull());
  client.emit('ready');
  return connecting;
}

describe('remote SSH client', () => {
  it('formats host keys as stable SHA-256 fingerprints', () => {
    expect(fingerprintSshHostKey(Buffer.from('lumora-host-key'))).toMatch(
      /^SHA256:[A-Za-z0-9+/]{43}$/
    );
    expect(fingerprintSshHostKey(Buffer.from('lumora-host-key'))).toBe(
      fingerprintSshHostKey(Buffer.from('lumora-host-key'))
    );
  });

  it('loads private-key contents only while preparing a matching connection', async () => {
    const readPrivateKey = vi.fn().mockResolvedValue(Buffer.from('private-key'));
    const configured = profile({
      method: 'private-key',
      privateKeyPath: 'C:\\Users\\cyanl\\.ssh\\id_ed25519'
    });
    const credentials: RemoteTargetCredentials = {
      method: 'private-key',
      passphrase: 'memory-only'
    };

    const prepared = await prepareSshConnectionConfig(configured, credentials, {
      readPrivateKey,
      resolveSshConfigHost: vi.fn(),
      agentSocket: null
    });

    expect(readPrivateKey).toHaveBeenCalledWith(
      'C:\\Users\\cyanl\\.ssh\\id_ed25519'
    );
    expect(prepared).toMatchObject({
      host: 'build.internal',
      port: 2222,
      username: 'builder',
      passphrase: 'memory-only'
    });
    expect(prepared.privateKey).toEqual(Buffer.from('private-key'));
    expect(JSON.stringify(configured)).not.toContain('memory-only');
  });

  it('rejects a credential method that does not match the stored profile', async () => {
    const readPrivateKey = vi.fn();

    await expect(prepareSshConnectionConfig(
      profile({ method: 'password' }),
      { method: 'agent' },
      {
        readPrivateKey,
        resolveSshConfigHost: vi.fn(),
        agentSocket: 'agent.sock'
      }
    )).rejects.toMatchObject({ code: 'AUTHENTICATION_MISMATCH' });
    expect(readPrivateKey).not.toHaveBeenCalled();
  });

  it('observes an untrusted host key without authenticating and closes the client', async () => {
    const client = new FakeClient();
    const ssh = createRemoteSshClient({
      createClient: () => client,
      readPrivateKey: vi.fn(),
      resolveSshConfigHost: vi.fn(),
      agentSocket: null
    });
    const observation = ssh.observeHostKey(profile({ method: 'password' }, null));
    await vi.waitFor(() => expect(client.connectConfig).not.toBeNull());
    const verifier = client.connectConfig?.hostVerifier as
      | ((key: Buffer) => boolean)
      | undefined;

    expect(verifier?.(Buffer.from('new-host-key'))).toBe(false);
    await expect(observation).resolves.toMatchObject({
      executionTargetId: TARGET_ID,
      fingerprint: fingerprintSshHostKey(Buffer.from('new-host-key'))
    });
    expect(client.end).toHaveBeenCalledOnce();
  });

  it('rejects changed host identity with a sanitized typed error', async () => {
    const client = new FakeClient();
    const ssh = createRemoteSshClient({
      createClient: () => client,
      readPrivateKey: vi.fn(),
      resolveSshConfigHost: vi.fn(),
      agentSocket: null
    });
    const connecting = ssh.connect(
      profile({ method: 'password' }),
      { method: 'password', password: 'not-logged' }
    );
    await vi.waitFor(() => expect(client.connectConfig).not.toBeNull());
    const verifier = client.connectConfig?.hostVerifier as (key: Buffer) => boolean;
    expect(verifier(Buffer.from('changed-host-key'))).toBe(false);
    client.emit('error', new Error('Handshake failed with private details'));

    await expect(connecting).rejects.toEqual(expect.objectContaining({
      name: RemoteSshError.name,
      code: 'HOST_KEY_CHANGED',
      message: 'The remote computer identity has changed.'
    }));
    expect(client.destroy).toHaveBeenCalledOnce();
  });

  it('notifies active consumers when an established SSH transport closes', async () => {
    const client = new FakeClient();
    const ssh = createRemoteSshClient({
      createClient: () => client,
      readPrivateKey: vi.fn(),
      resolveSshConfigHost: vi.fn(),
      agentSocket: null
    });
    const connecting = ssh.connect(
      profile({ method: 'password' }),
      { method: 'password', password: 'not-logged' }
    );
    await vi.waitFor(() => expect(client.connectConfig).not.toBeNull());
    client.emit('ready');
    const connected = await connecting;
    const onClose = vi.fn();
    connected.onClose(onClose);

    client.emit('close');

    expect(onClose).toHaveBeenCalledOnce();
  });

  it('contains close-listener failures and continues notifying consumers', async () => {
    const client = new FakeClient();
    const ssh = createRemoteSshClient({
      createClient: () => client,
      readPrivateKey: vi.fn(),
      resolveSshConfigHost: vi.fn(),
      agentSocket: null
    });
    const connecting = ssh.connect(
      profile({ method: 'password' }),
      { method: 'password', password: 'not-logged' }
    );
    await vi.waitFor(() => expect(client.connectConfig).not.toBeNull());
    client.emit('ready');
    const connected = await connecting;
    const laterListener = vi.fn();
    connected.onClose(() => { throw new Error('private listener failure'); });
    connected.onClose(laterListener);

    expect(() => client.emit('close')).not.toThrow();
    expect(laterListener).toHaveBeenCalledOnce();
  });

  it('opens an interactive PTY channel with the requested terminal size', async () => {
    const client = new FakePtyClient();
    const connected = await connectReady(client);

    const channel = await connected.openPtyExec('remote command', {
      cols: 132,
      rows: 41
    });

    expect(client.command).toBe('remote command');
    expect(client.options).toEqual({
      pty: {
        term: 'xterm-256color',
        cols: 132,
        rows: 41,
        width: 0,
        height: 0
      }
    });
    expect(channel.pid).toBeNull();
  });

  it('forwards PTY output and resizes using SSH row-column ordering', async () => {
    const client = new FakePtyClient();
    const connected = await connectReady(client);
    const channel = await connected.openPtyExec('remote command', {
      cols: 80,
      rows: 24
    });
    const onData = vi.fn();
    channel.onData(onData);

    client.channel.emit('data', Buffer.from('hello'));
    channel.resize(140, 50);

    expect(onData).toHaveBeenCalledWith('hello');
    expect(client.channel.setWindow).toHaveBeenCalledWith(50, 140, 0, 0);
  });

  it('forwards writes and reports the optional remote exit code once', async () => {
    const client = new FakePtyClient();
    const connected = await connectReady(client);
    const channel = await connected.openPtyExec('remote command', {
      cols: 80,
      rows: 24
    });
    const onExit = vi.fn();
    channel.onExit(onExit);

    channel.write('prompt');
    client.channel.emit('exit', 7);
    client.channel.emit('close');

    expect(client.channel.write).toHaveBeenCalledWith('prompt');
    expect(onExit).toHaveBeenCalledOnce();
    expect(onExit).toHaveBeenCalledWith({ exitCode: 7 });
  });

  it('maps a missing SSH exit status to null and suppresses late operations', async () => {
    const client = new FakePtyClient();
    const connected = await connectReady(client);
    const channel = await connected.openPtyExec('remote command', {
      cols: 80,
      rows: 24
    });
    const onExit = vi.fn();
    channel.onExit(onExit);

    client.channel.emit('close');
    expect(() => channel.write('late')).not.toThrow();
    expect(() => channel.resize(100, 30)).not.toThrow();

    expect(client.channel.write).not.toHaveBeenCalled();
    expect(client.channel.setWindow).not.toHaveBeenCalled();
    expect(onExit).toHaveBeenCalledWith({ exitCode: null });
  });

  it.each([
    {
      operation: 'write',
      fail(channel: FakePtyChannel) {
        channel.write.mockImplementationOnce(() => {
          throw new Error('Channel is not writable');
        });
      },
      invoke(channel: RemotePtyChannel) {
        channel.write('late input');
      }
    },
    {
      operation: 'resize',
      fail(channel: FakePtyChannel) {
        channel.setWindow.mockImplementationOnce(() => {
          throw new Error('Channel is closed');
        });
      },
      invoke(channel: RemotePtyChannel) {
        channel.resize(120, 40);
      }
    },
    {
      operation: 'kill',
      fail(channel: FakePtyChannel) {
        channel.close.mockImplementationOnce(() => {
          throw new Error('Channel is closed');
        });
      },
      invoke(channel: RemotePtyChannel) {
        channel.kill();
      }
    }
  ])('treats a synchronous SSH $operation failure as an exited remote PTY', async ({
    fail,
    invoke
  }) => {
    const client = new FakePtyClient();
    const connected = await connectReady(client);
    const channel = await connected.openPtyExec('remote command', {
      cols: 80,
      rows: 24
    });
    const onExit = vi.fn();
    channel.onExit(onExit);
    fail(client.channel);

    expect(() => invoke(channel)).not.toThrow();
    expect(onExit).toHaveBeenCalledOnce();
    expect(onExit).toHaveBeenCalledWith({ exitCode: null });
  });

  it('terminates an active remote PTY idempotently', async () => {
    const client = new FakePtyClient();
    const connected = await connectReady(client);
    const channel = await connected.openPtyExec('remote command', {
      cols: 80,
      rows: 24
    });

    channel.kill();
    channel.kill();

    expect(client.channel.close).toHaveBeenCalledOnce();
  });
});
