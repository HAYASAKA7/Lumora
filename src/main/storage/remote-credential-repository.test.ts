import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';

import { ExecutionTargetRepository } from './execution-target-repository';
import { migrateCatalogDatabase } from './migrations';
import { RemoteConnectionProfileRepository } from './remote-connection-profile-repository';
import { RemoteCredentialRepository } from './remote-credential-repository';

const TARGET_ID = '4f632901-1f8d-44c0-8418-aa823f791ca0';

describe('RemoteCredentialRepository', () => {
  let database: DatabaseSync | null = null;

  afterEach(() => {
    database?.close();
    database = null;
  });

  function setup(method: 'password' | 'private-key' | 'agent' = 'password') {
    database = new DatabaseSync(':memory:');
    migrateCatalogDatabase(database);
    new ExecutionTargetRepository(database).createRemote({
      id: TARGET_ID,
      displayName: 'Build server'
    });
    new RemoteConnectionProfileRepository(database).save(TARGET_ID, {
      displayName: 'Build server',
      route: 'direct',
      host: 'build.internal',
      port: 22,
      username: 'builder',
      authentication: method === 'private-key'
        ? { method, privateKeyPath: '/home/builder/.ssh/id_ed25519' }
        : { method }
    });
    return new RemoteCredentialRepository(database);
  }

  it('defaults auto-connect off and saves it per profile', () => {
    const repository = setup();

    expect(repository.getAutoConnect(TARGET_ID)).toBe(false);
    repository.setAutoConnect(TARGET_ID, true);
    expect(repository.getAutoConnect(TARGET_ID)).toBe(true);
    repository.setAutoConnect(TARGET_ID, false);
    expect(repository.getAutoConnect(TARGET_ID)).toBe(false);
  });

  it('round-trips copied encrypted bytes and atomically replaces metadata', () => {
    const repository = setup();
    const first = Buffer.from([1, 2, 3]);
    repository.saveCredential(
      TARGET_ID,
      'password',
      first,
      1,
      new Date('2026-08-11T06:00:00.000Z')
    );
    first.fill(9);

    expect(repository.getCredential(TARGET_ID)).toEqual({
      executionTargetId: TARGET_ID,
      kind: 'password',
      encryptedSecret: Buffer.from([1, 2, 3]),
      encryptionVersion: 1,
      createdAt: '2026-08-11T06:00:00.000Z',
      updatedAt: '2026-08-11T06:00:00.000Z'
    });

    repository.saveCredential(
      TARGET_ID,
      'password',
      Buffer.from([4, 5]),
      2,
      new Date('2026-08-11T06:05:00.000Z')
    );
    expect(repository.getCredential(TARGET_ID)).toMatchObject({
      encryptedSecret: Buffer.from([4, 5]),
      encryptionVersion: 2,
      createdAt: '2026-08-11T06:00:00.000Z',
      updatedAt: '2026-08-11T06:05:00.000Z'
    });
  });

  it('rejects secret kinds inconsistent with the authentication profile', () => {
    const repository = setup('private-key');

    expect(() => repository.saveCredential(
      TARGET_ID,
      'password',
      Buffer.from([1]),
      1
    )).toThrow('authentication method');
    expect(() => repository.saveCredential(
      TARGET_ID,
      'private-key-passphrase',
      Buffer.alloc(0),
      1
    )).toThrow('empty');
  });

  it('deletes idempotently and cascades when the target is removed', () => {
    const repository = setup();
    repository.saveCredential(TARGET_ID, 'password', Buffer.from([1]), 1);
    repository.deleteCredential(TARGET_ID);
    repository.deleteCredential(TARGET_ID);
    expect(repository.getCredential(TARGET_ID)).toBeNull();

    repository.saveCredential(TARGET_ID, 'password', Buffer.from([2]), 1);
    new ExecutionTargetRepository(database!).deleteRemote(TARGET_ID);
    expect(repository.getCredential(TARGET_ID)).toBeNull();
  });
});
