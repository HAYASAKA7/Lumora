import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';

import type { RemoteConnectionProfile } from '../../shared/contracts';
import {
  createRemoteSshClient,
  fingerprintSshHostKey,
  type SftpAdapter,
  type SshClientAdapter
} from './ssh-client';

const TARGET_ID = '4f632901-1f8d-44c0-8418-aa823f791ca0';

function profile(): RemoteConnectionProfile {
  return {
    executionTargetId: TARGET_ID,
    displayName: 'Build server',
    route: 'direct',
    host: 'build.internal',
    port: 22,
    username: 'builder',
    sshConfigHost: null,
    authentication: { method: 'password' },
    verifiedHostFingerprint: fingerprintSshHostKey(Buffer.from('lumora-host-key')),
    createdAt: '2026-08-04T06:00:00.000Z',
    updatedAt: '2026-08-04T06:00:00.000Z'
  };
}

class FakeChannel extends EventEmitter {
  readonly stderr = new EventEmitter();
  readonly write = vi.fn();
  readonly destroy = vi.fn();
}

class FakeSftp implements SftpAdapter {
  readonly end = vi.fn();
  readonly stat = vi.fn((_path: string, callback: (error: Error | undefined, attributes?: { size: number }) => void) => callback(undefined, { size: 42 }));
  readonly mkdir = vi.fn((_path: string, callback: (error?: Error) => void) => callback());
  readonly fastPut = vi.fn((_local: string, _remote: string, callback: (error?: Error) => void) => callback());
  readonly chmod = vi.fn((_path: string, _mode: number, callback: (error?: Error) => void) => callback());
  readonly rename = vi.fn((_from: string, _to: string, callback: (error?: Error) => void) => callback());
  readonly unlink = vi.fn((_path: string, callback: (error?: Error) => void) => callback());
}

class TransportClient extends EventEmitter implements SshClientAdapter {
  readonly channel = new FakeChannel();
  readonly sftpClient = new FakeSftp();
  readonly end = vi.fn();
  readonly destroy = vi.fn();
  connectConfig: Record<string, unknown> | null = null;

  connect(config: Record<string, unknown>): void {
    this.connectConfig = config;
  }

  exec(_command: string, callback: (error: Error | undefined, channel: any) => void): void {
    callback(undefined, this.channel);
  }

  sftp(callback: (error: Error | undefined, sftp: SftpAdapter) => void): void {
    callback(undefined, this.sftpClient);
  }
}

async function connected(client: TransportClient) {
  const result = createRemoteSshClient({
    createClient: () => client,
    readPrivateKey: vi.fn(),
    resolveSshConfigHost: vi.fn(),
    agentSocket: null
  }).connect(profile(), { method: 'password', password: 'memory-only' });
  await vi.waitFor(() => expect(client.connectConfig).not.toBeNull());
  const verifier = client.connectConfig?.hostVerifier as (key: Buffer) => boolean;
  expect(verifier(Buffer.from('lumora-host-key'))).toBe(true);
  client.emit('ready');
  return result;
}

describe('remote SSH helper transport', () => {
  it('opens a raw exec channel without exposing ssh2 to callers', async () => {
    const client = new TransportClient();
    const ssh = await connected(client);

    const channel = await ssh.openExec('/home/builder/.lumora/helper/0.1.0/lumora-helper');

    expect(channel.stdin).toBe(client.channel);
    expect(channel.stdout).toBe(client.channel);
    expect(channel.stderr).toBe(client.channel.stderr);
    channel.close();
    expect(client.channel.destroy).toHaveBeenCalledOnce();
  });

  it('normalizes bounded SFTP operations and treats missing stat as data', async () => {
    const client = new TransportClient();
    const ssh = await connected(client);
    const files = await ssh.openFileTransfer();

    await expect(files.stat('/remote/helper')).resolves.toEqual({
      exists: true,
      size: 42
    });
    await files.mkdir('/remote');
    await files.upload('local-helper', '/remote/helper.tmp');
    await files.chmod('/remote/helper.tmp', 0o700);
    await files.rename('/remote/helper.tmp', '/remote/helper');
    await files.remove('/remote/helper');
    files.close();

    expect(client.sftpClient.fastPut).toHaveBeenCalledWith(
      'local-helper',
      '/remote/helper.tmp',
      expect.any(Function)
    );
    expect(client.sftpClient.end).toHaveBeenCalledOnce();

    const missing = Object.assign(new Error('missing private detail'), { code: 'ENOENT' });
    client.sftpClient.stat.mockImplementationOnce((_path, callback) => callback(missing));
    const second = await ssh.openFileTransfer();
    await expect(second.stat('/missing')).resolves.toEqual({ exists: false, size: null });
  });

  it('rejects operations after transport closure with sanitized errors', async () => {
    const client = new TransportClient();
    const ssh = await connected(client);
    ssh.close();
    ssh.close();

    await expect(ssh.openExec('fixed-command')).rejects.toMatchObject({
      code: 'SSH_CONNECTION_FAILED'
    });
    await expect(ssh.openFileTransfer()).rejects.toMatchObject({
      code: 'SSH_CONNECTION_FAILED'
    });
    expect(client.end).toHaveBeenCalledOnce();
  });
});
