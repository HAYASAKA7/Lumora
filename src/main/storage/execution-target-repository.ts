import type { DatabaseSync } from 'node:sqlite';

import {
  ExecutionTargetIdSchema,
  ExecutionTargetSchema,
  type ExecutionTarget,
  type ExecutionTargetId,
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
}

