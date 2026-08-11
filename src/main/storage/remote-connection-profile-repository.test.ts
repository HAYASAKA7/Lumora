import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';

import {
  RemoteConnectionProfileInputSchema,
  RemoteTargetConnectRequestSchema
} from '../../shared/contracts';
import { ExecutionTargetRepository } from './execution-target-repository';
import { migrateCatalogDatabase } from './migrations';
import { RemoteConnectionProfileRepository } from './remote-connection-profile-repository';

const TARGET_ID = '4f632901-1f8d-44c0-8418-aa823f791ca0';

describe('remote connection profile persistence', () => {
  let database: DatabaseSync | null = null;

  afterEach(() => {
    database?.close();
    database = null;
  });

  it('separates durable profile data from ephemeral authentication secrets', () => {
    const profile = RemoteConnectionProfileInputSchema.parse({
      displayName: 'Linux build server',
      route: 'direct',
      host: 'build.internal',
      port: 2222,
      username: 'builder',
      authentication: {
        method: 'private-key',
        privateKeyPath: 'C:\\Users\\cyanl\\.ssh\\id_ed25519'
      }
    });

    expect(profile).not.toHaveProperty('password');
    expect(profile).not.toHaveProperty('passphrase');
    expect(() => RemoteConnectionProfileInputSchema.parse({
      ...profile,
      password: 'must-not-be-stored'
    })).toThrow();
    expect(RemoteTargetConnectRequestSchema.parse({
      executionTargetId: TARGET_ID,
      credentials: {
        method: 'private-key',
        passphrase: 'memory-only'
      }
    }).credentials).toEqual({
      method: 'private-key',
      passphrase: 'memory-only'
    });
  });

  it('migrates a constrained profile table with non-secret connection preferences', () => {
    database = new DatabaseSync(':memory:');
    migrateCatalogDatabase(database);

    const columns = database.prepare(
      'PRAGMA table_info(remote_connection_profile)'
    ).all() as unknown as Array<{ name: string }>;

    expect(columns.map(({ name }) => name)).toEqual([
      'execution_target_id',
      'route',
      'host',
      'port',
      'username',
      'ssh_config_host',
      'authentication_method',
      'private_key_path',
      'verified_host_fingerprint',
      'created_at',
      'updated_at',
      'auto_connect'
    ]);
    expect(columns.some(({ name }) => /password|passphrase|secret/i.test(name)))
      .toBe(false);

    const credentialColumns = database.prepare(
      'PRAGMA table_info(remote_connection_credential)'
    ).all() as unknown as Array<{ name: string }>;
    expect(credentialColumns.map(({ name }) => name)).toEqual([
      'execution_target_id',
      'secret_kind',
      'encrypted_secret',
      'encryption_version',
      'created_at',
      'updated_at'
    ]);
  });

  it('round-trips direct and SSH-config profiles without credentials', () => {
    database = new DatabaseSync(':memory:');
    migrateCatalogDatabase(database);
    const targets = new ExecutionTargetRepository(database);
    const profiles = new RemoteConnectionProfileRepository(database);
    targets.createRemote({
      id: TARGET_ID,
      displayName: 'Linux build server'
    });

    const created = profiles.save(TARGET_ID, {
      displayName: 'Linux build server',
      route: 'direct',
      host: 'build.internal',
      port: 2222,
      username: 'builder',
      authentication: { method: 'password' }
    }, new Date('2026-08-04T06:00:00.000Z'));

    expect(created).toEqual({
      executionTargetId: TARGET_ID,
      displayName: 'Linux build server',
      route: 'direct',
      host: 'build.internal',
      port: 2222,
      username: 'builder',
      sshConfigHost: null,
      authentication: { method: 'password' },
      verifiedHostFingerprint: null,
      createdAt: '2026-08-04T06:00:00.000Z',
      updatedAt: '2026-08-04T06:00:00.000Z'
    });

    expect(profiles.save(TARGET_ID, {
      displayName: 'Linux via config',
      route: 'ssh-config',
      sshConfigHost: 'lumora-build',
      authentication: { method: 'agent' }
    }, new Date('2026-08-04T06:05:00.000Z'))).toMatchObject({
      route: 'ssh-config',
      host: null,
      port: null,
      username: null,
      sshConfigHost: 'lumora-build',
      authentication: { method: 'agent' },
      createdAt: '2026-08-04T06:00:00.000Z',
      updatedAt: '2026-08-04T06:05:00.000Z'
    });
    expect(profiles.list()).toEqual([profiles.get(TARGET_ID)]);
  });

  it('creates, updates, resets, and deletes remote targets safely', () => {
    database = new DatabaseSync(':memory:');
    migrateCatalogDatabase(database);
    const repository = new ExecutionTargetRepository(database);

    expect(repository.createRemote({
      id: TARGET_ID,
      displayName: 'Build server'
    })).toMatchObject({
      id: TARGET_ID,
      kind: 'remote',
      displayName: 'Build server',
      platform: 'unknown',
      architecture: 'unknown',
      connectionState: 'offline'
    });
    expect(repository.updateRemoteConnection(TARGET_ID, {
      connectionState: 'ready',
      platform: 'linux',
      architecture: 'arm64',
      lastConnectedAt: '2026-08-04T06:10:00.000Z'
    })).toMatchObject({
      connectionState: 'ready',
      platform: 'linux',
      architecture: 'arm64'
    });

    repository.resetRemoteConnectionStates();
    expect(repository.get(TARGET_ID)).toMatchObject({ connectionState: 'offline' });
    repository.deleteRemote(TARGET_ID);
    expect(repository.get(TARGET_ID)).toBeNull();
    expect(() => repository.deleteRemote('local')).toThrow('permanent');
  });
});
