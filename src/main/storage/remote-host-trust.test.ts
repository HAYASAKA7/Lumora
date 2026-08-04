import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';

import { ExecutionTargetRepository } from './execution-target-repository';
import { migrateCatalogDatabase } from './migrations';
import { RemoteConnectionProfileRepository } from './remote-connection-profile-repository';

const TARGET_ID = '4f632901-1f8d-44c0-8418-aa823f791ca0';
const FINGERPRINT = 'SHA256:57qsnZ7C9rC8S3dftMDSqdHcpZ+PZfNclRBfXZXp0mM';

describe('remote host trust persistence', () => {
  let database: DatabaseSync | null = null;

  afterEach(() => {
    database?.close();
    database = null;
  });

  it('retains trust for profile-only edits and clears it when the endpoint changes', () => {
    database = new DatabaseSync(':memory:');
    migrateCatalogDatabase(database);
    const targets = new ExecutionTargetRepository(database);
    const profiles = new RemoteConnectionProfileRepository(database);
    targets.createRemote({ id: TARGET_ID, displayName: 'Build server' });
    profiles.save(TARGET_ID, {
      displayName: 'Build server',
      route: 'direct',
      host: 'build.internal',
      port: 22,
      username: 'builder',
      authentication: { method: 'password' }
    });

    expect(profiles.trustHostKey(TARGET_ID, FINGERPRINT)).toMatchObject({
      verifiedHostFingerprint: FINGERPRINT
    });
    expect(profiles.save(TARGET_ID, {
      displayName: 'Renamed build server',
      route: 'direct',
      host: 'build.internal',
      port: 22,
      username: 'builder',
      authentication: { method: 'password' }
    })).toMatchObject({ verifiedHostFingerprint: FINGERPRINT });
    expect(profiles.save(TARGET_ID, {
      displayName: 'Replacement server',
      route: 'direct',
      host: 'replacement.internal',
      port: 22,
      username: 'builder',
      authentication: { method: 'password' }
    })).toMatchObject({ verifiedHostFingerprint: null });
  });

  it('rejects malformed fingerprints before writing', () => {
    database = new DatabaseSync(':memory:');
    migrateCatalogDatabase(database);
    const targets = new ExecutionTargetRepository(database);
    const profiles = new RemoteConnectionProfileRepository(database);
    targets.createRemote({ id: TARGET_ID, displayName: 'Build server' });
    profiles.save(TARGET_ID, {
      displayName: 'Build server',
      route: 'ssh-config',
      sshConfigHost: 'lumora-build',
      authentication: { method: 'agent' }
    });

    expect(() => profiles.trustHostKey(TARGET_ID, 'SHA256:not-valid'))
      .toThrow();
    expect(profiles.get(TARGET_ID)?.verifiedHostFingerprint).toBeNull();
  });
});
