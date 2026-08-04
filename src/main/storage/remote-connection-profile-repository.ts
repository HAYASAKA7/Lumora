import type { DatabaseSync } from 'node:sqlite';

import {
  RemoteConnectionProfileInputSchema,
  RemoteConnectionProfileSchema,
  RemoteExecutionTargetIdSchema,
  type RemoteConnectionProfile,
  type RemoteConnectionProfileInput,
  type RemoteExecutionTargetId
} from '../../shared/contracts';

interface RemoteConnectionProfileRow {
  execution_target_id: string;
  display_name: string;
  route: string;
  host: string | null;
  port: number | null;
  username: string | null;
  ssh_config_host: string | null;
  authentication_method: string;
  private_key_path: string | null;
  verified_host_fingerprint: string | null;
  created_at: string;
  updated_at: string;
}

const PROFILE_SELECT = `SELECT
  profile.execution_target_id, target.display_name, profile.route,
  profile.host, profile.port, profile.username, profile.ssh_config_host,
  profile.authentication_method, profile.private_key_path,
  profile.verified_host_fingerprint, profile.created_at, profile.updated_at
FROM remote_connection_profile profile
JOIN execution_target target ON target.id = profile.execution_target_id`;

function rowToProfile(row: RemoteConnectionProfileRow): RemoteConnectionProfile {
  return RemoteConnectionProfileSchema.parse({
    executionTargetId: row.execution_target_id,
    displayName: row.display_name,
    route: row.route,
    host: row.host,
    port: row.port,
    username: row.username,
    sshConfigHost: row.ssh_config_host,
    authentication:
      row.authentication_method === 'private-key'
        ? { method: 'private-key', privateKeyPath: row.private_key_path }
        : { method: row.authentication_method },
    verifiedHostFingerprint: row.verified_host_fingerprint,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  });
}

export class RemoteConnectionProfileRepository {
  constructor(private readonly database: DatabaseSync) {}

  get(id: RemoteExecutionTargetId): RemoteConnectionProfile | null {
    const executionTargetId = RemoteExecutionTargetIdSchema.parse(id);
    const row = this.database.prepare(
      `${PROFILE_SELECT} WHERE profile.execution_target_id = ?`
    ).get(executionTargetId) as RemoteConnectionProfileRow | undefined;
    return row === undefined ? null : rowToProfile(row);
  }

  list(): RemoteConnectionProfile[] {
    return (
      this.database.prepare(
        `${PROFILE_SELECT} ORDER BY target.display_name COLLATE NOCASE,
          profile.execution_target_id`
      ).all() as unknown as RemoteConnectionProfileRow[]
    ).map(rowToProfile);
  }

  save(
    id: RemoteExecutionTargetId,
    input: RemoteConnectionProfileInput,
    now = new Date()
  ): RemoteConnectionProfile {
    const executionTargetId = RemoteExecutionTargetIdSchema.parse(id);
    const profile = RemoteConnectionProfileInputSchema.parse(input);
    const timestamp = now.toISOString();
    const direct = profile.route === 'direct';
    const privateKeyPath =
      profile.authentication.method === 'private-key'
        ? profile.authentication.privateKeyPath
        : null;

    this.database.exec('BEGIN IMMEDIATE');
    try {
      const renamed = this.database.prepare(
        `UPDATE execution_target SET display_name = ?
         WHERE id = ? AND kind = 'remote'`
      ).run(profile.displayName, executionTargetId);
      if (renamed.changes !== 1) {
        throw new Error('The remote execution target does not exist.');
      }
      this.database.prepare(
        `INSERT INTO remote_connection_profile (
          execution_target_id, route, host, port, username, ssh_config_host,
          authentication_method, private_key_path,
          verified_host_fingerprint, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)
        ON CONFLICT (execution_target_id) DO UPDATE SET
          route = excluded.route,
          host = excluded.host,
          port = excluded.port,
          username = excluded.username,
          ssh_config_host = excluded.ssh_config_host,
          authentication_method = excluded.authentication_method,
          private_key_path = excluded.private_key_path,
          verified_host_fingerprint = CASE
            WHEN remote_connection_profile.route = excluded.route
              AND remote_connection_profile.host IS excluded.host
              AND remote_connection_profile.port IS excluded.port
              AND remote_connection_profile.ssh_config_host IS excluded.ssh_config_host
            THEN remote_connection_profile.verified_host_fingerprint
            ELSE NULL
          END,
          updated_at = excluded.updated_at`
      ).run(
        executionTargetId,
        profile.route,
        direct ? profile.host : null,
        direct ? profile.port : null,
        direct ? profile.username : null,
        direct ? null : profile.sshConfigHost,
        profile.authentication.method,
        privateKeyPath,
        timestamp,
        timestamp
      );
      this.database.exec('COMMIT');
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }

    const saved = this.get(executionTargetId);
    if (saved === null) {
      throw new Error('The remote connection profile was not saved.');
    }
    return saved;
  }

}
