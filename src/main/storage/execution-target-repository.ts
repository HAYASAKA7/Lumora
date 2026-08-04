import type { DatabaseSync } from 'node:sqlite';

import {
  ExecutionTargetIdSchema,
  ExecutionTargetSchema,
  RemoteExecutionTargetIdSchema,
  type ExecutionTarget,
  type ExecutionTargetId,
  type RemoteExecutionTargetId,
  type SystemInfo
} from '../../shared/contracts';

interface ExecutionTargetRow {
  id: string;
  kind: string;
  display_name: string;
  platform: string;
  architecture: string;
  connection_state: string;
  helper_version: string | null;
  protocol_version: number | null;
  capabilities_json: string;
  last_connected_at: string | null;
  last_scanned_at: string | null;
}

function rowToTarget(row: ExecutionTargetRow): ExecutionTarget {
  return ExecutionTargetSchema.parse({
    id: row.id,
    kind: row.kind,
    displayName: row.display_name,
    platform: row.platform,
    architecture: row.architecture,
    connectionState: row.connection_state,
    helperVersion: row.helper_version,
    protocolVersion: row.protocol_version,
    capabilities: JSON.parse(row.capabilities_json) as unknown,
    lastConnectedAt: row.last_connected_at,
    lastScannedAt: row.last_scanned_at
  });
}

const TARGET_COLUMNS = `id, kind, display_name, platform, architecture,
  connection_state, helper_version, protocol_version, capabilities_json,
  last_connected_at, last_scanned_at`;

export class ExecutionTargetRepository {
  constructor(private readonly database: DatabaseSync) {}

  ensureLocalTarget(input: {
    platform: SystemInfo['platform'];
    architecture: string;
  }): ExecutionTarget {
    const platform = input.platform;
    const architecture = input.architecture.trim();
    if (architecture.length === 0 || architecture.length > 32) {
      throw new Error('The local architecture is invalid.');
    }
    this.database.prepare(
      `UPDATE execution_target
       SET display_name = 'This computer', platform = ?, architecture = ?,
         capabilities_json = ?
       WHERE id = 'local' AND kind = 'local'`
    ).run(
      platform,
      architecture,
      JSON.stringify(['provider-scan', 'session-scan', 'pty'])
    );
    const target = this.get('local');
    if (target === null || target.kind !== 'local') {
      throw new Error('The permanent local execution target is unavailable.');
    }
    return target;
  }

  get(id: ExecutionTargetId): ExecutionTarget | null {
    const executionTargetId = ExecutionTargetIdSchema.parse(id);
    const row = this.database.prepare(
      `SELECT ${TARGET_COLUMNS} FROM execution_target WHERE id = ?`
    ).get(executionTargetId) as ExecutionTargetRow | undefined;
    return row === undefined ? null : rowToTarget(row);
  }

  list(): ExecutionTarget[] {
    return (
      this.database.prepare(
        `SELECT ${TARGET_COLUMNS} FROM execution_target
         ORDER BY CASE kind WHEN 'local' THEN 0 ELSE 1 END,
           display_name COLLATE NOCASE, id`
      ).all() as unknown as ExecutionTargetRow[]
    ).map(rowToTarget);
  }

  createRemote(input: {
    id: RemoteExecutionTargetId;
    displayName: string;
  }): ExecutionTarget {
    const id = RemoteExecutionTargetIdSchema.parse(input.id);
    const displayName = input.displayName.trim();
    const target = ExecutionTargetSchema.parse({
      id,
      kind: 'remote',
      displayName,
      platform: 'unknown',
      architecture: 'unknown',
      connectionState: 'offline',
      helperVersion: null,
      protocolVersion: null,
      capabilities: [],
      lastConnectedAt: null,
      lastScannedAt: null
    });
    this.database.prepare(
      `INSERT INTO execution_target (
        id, kind, display_name, platform, architecture, connection_state,
        helper_version, protocol_version, capabilities_json,
        last_connected_at, last_scanned_at
      ) VALUES (?, 'remote', ?, 'unknown', 'unknown', 'offline',
        NULL, NULL, '[]', NULL, NULL)`
    ).run(id, target.displayName);
    return this.get(id)!;
  }

  updateRemoteConnection(
    id: RemoteExecutionTargetId,
    input: Partial<Pick<Extract<ExecutionTarget, { kind: 'remote' }>,
      'connectionState' | 'platform' | 'architecture' | 'helperVersion' |
      'protocolVersion' | 'capabilities' | 'lastConnectedAt' | 'lastScannedAt'>>
  ): ExecutionTarget {
    const executionTargetId = RemoteExecutionTargetIdSchema.parse(id);
    const current = this.get(executionTargetId);
    if (current === null || current.kind !== 'remote') {
      throw new Error('The remote execution target does not exist.');
    }
    const next = ExecutionTargetSchema.parse({ ...current, ...input });
    this.database.prepare(
      `UPDATE execution_target SET
        platform = ?, architecture = ?, connection_state = ?,
        helper_version = ?, protocol_version = ?, capabilities_json = ?,
        last_connected_at = ?, last_scanned_at = ?
       WHERE id = ? AND kind = 'remote'`
    ).run(
      next.platform,
      next.architecture,
      next.connectionState,
      next.helperVersion,
      next.protocolVersion,
      JSON.stringify(next.capabilities),
      next.lastConnectedAt,
      next.lastScannedAt,
      executionTargetId
    );
    return this.get(executionTargetId)!;
  }

  resetRemoteConnectionStates(): void {
    this.database.prepare(
      `UPDATE execution_target SET connection_state = 'offline'
       WHERE kind = 'remote' AND connection_state <> 'offline'`
    ).run();
  }

  deleteRemote(id: ExecutionTargetId): void {
    const executionTargetId = ExecutionTargetIdSchema.parse(id);
    if (executionTargetId === 'local') {
      throw new Error('The permanent local execution target cannot be deleted.');
    }
    this.database.prepare(
      `DELETE FROM execution_target WHERE id = ? AND kind = 'remote'`
    ).run(executionTargetId);
  }
}

