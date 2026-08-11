import type { DatabaseSync } from 'node:sqlite';

import {
  RemoteExecutionTargetIdSchema,
  type RemoteExecutionTargetId
} from '../../shared/contracts';

export type RemoteCredentialKind = 'password' | 'private-key-passphrase';

export interface StoredRemoteCredential {
  executionTargetId: RemoteExecutionTargetId;
  kind: RemoteCredentialKind;
  encryptedSecret: Buffer;
  encryptionVersion: number;
  createdAt: string;
  updatedAt: string;
}

interface CredentialRow {
  execution_target_id: string;
  secret_kind: string;
  encrypted_secret: Uint8Array;
  encryption_version: number;
  created_at: string;
  updated_at: string;
}

function parseKind(value: string): RemoteCredentialKind {
  if (value === 'password' || value === 'private-key-passphrase') return value;
  throw new Error('The stored remote credential kind is invalid.');
}

export class RemoteCredentialRepository {
  constructor(private readonly database: DatabaseSync) {}

  getAutoConnect(input: RemoteExecutionTargetId): boolean {
    const id = RemoteExecutionTargetIdSchema.parse(input);
    const row = this.database.prepare(
      `SELECT auto_connect FROM remote_connection_profile
       WHERE execution_target_id = ?`
    ).get(id) as { auto_connect: number } | undefined;
    if (row === undefined) {
      throw new Error('The remote connection profile does not exist.');
    }
    return row.auto_connect === 1;
  }

  setAutoConnect(input: RemoteExecutionTargetId, enabled: boolean): void {
    const id = RemoteExecutionTargetIdSchema.parse(input);
    const result = this.database.prepare(
      `UPDATE remote_connection_profile SET auto_connect = ?, updated_at = ?
       WHERE execution_target_id = ?`
    ).run(enabled ? 1 : 0, new Date().toISOString(), id);
    if (result.changes !== 1) {
      throw new Error('The remote connection profile does not exist.');
    }
  }

  getCredential(input: RemoteExecutionTargetId): StoredRemoteCredential | null {
    const id = RemoteExecutionTargetIdSchema.parse(input);
    const row = this.database.prepare(
      `SELECT execution_target_id, secret_kind, encrypted_secret,
        encryption_version, created_at, updated_at
       FROM remote_connection_credential WHERE execution_target_id = ?`
    ).get(id) as CredentialRow | undefined;
    if (row === undefined) return null;
    return {
      executionTargetId: RemoteExecutionTargetIdSchema.parse(
        row.execution_target_id
      ),
      kind: parseKind(row.secret_kind),
      encryptedSecret: Buffer.from(row.encrypted_secret),
      encryptionVersion: row.encryption_version,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  saveCredential(
    input: RemoteExecutionTargetId,
    kind: RemoteCredentialKind,
    encryptedSecret: Uint8Array,
    encryptionVersion: number,
    now = new Date()
  ): void {
    const id = RemoteExecutionTargetIdSchema.parse(input);
    const secretKind = parseKind(kind);
    if (encryptedSecret.byteLength === 0) {
      throw new Error('The encrypted remote credential cannot be empty.');
    }
    if (!Number.isInteger(encryptionVersion) || encryptionVersion < 1) {
      throw new Error('The remote credential encryption version is invalid.');
    }
    const profile = this.database.prepare(
      `SELECT authentication_method FROM remote_connection_profile
       WHERE execution_target_id = ?`
    ).get(id) as { authentication_method: string } | undefined;
    if (profile === undefined) {
      throw new Error('The remote connection profile does not exist.');
    }
    const expectedMethod = secretKind === 'password' ? 'password' : 'private-key';
    if (profile.authentication_method !== expectedMethod) {
      throw new Error(
        'The remote credential kind does not match the profile authentication method.'
      );
    }
    const timestamp = now.toISOString();
    this.database.prepare(
      `INSERT INTO remote_connection_credential (
        execution_target_id, secret_kind, encrypted_secret,
        encryption_version, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT (execution_target_id) DO UPDATE SET
        secret_kind = excluded.secret_kind,
        encrypted_secret = excluded.encrypted_secret,
        encryption_version = excluded.encryption_version,
        updated_at = excluded.updated_at`
    ).run(
      id,
      secretKind,
      Buffer.from(encryptedSecret),
      encryptionVersion,
      timestamp,
      timestamp
    );
  }

  deleteCredential(input: RemoteExecutionTargetId): void {
    const id = RemoteExecutionTargetIdSchema.parse(input);
    this.database.prepare(
      'DELETE FROM remote_connection_credential WHERE execution_target_id = ?'
    ).run(id);
  }
}
