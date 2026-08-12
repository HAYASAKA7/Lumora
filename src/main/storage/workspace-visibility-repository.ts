import type { DatabaseSync, StatementSync } from 'node:sqlite';

import {
  ExecutionTargetIdSchema,
  LOCAL_EXECUTION_TARGET_ID,
  WorkspaceVisibilityPolicyListSchema,
  WorkspaceVisibilityRestoreRequestSchema,
  WorkspaceVisibilitySetRequestSchema,
  type ExecutionTargetId,
  type WorkspaceVisibilityPolicy,
  type WorkspaceVisibilitySetRequest
} from '../../shared/contracts';

interface WorkspaceVisibilityPolicyRow {
  workspace_id: string;
  mode: WorkspaceVisibilityPolicy['mode'];
  updated_at: string;
}

export class WorkspaceVisibilityRepository {
  private readonly executionTargetId: ExecutionTargetId;
  private readonly statements = new Map<string, StatementSync>();

  constructor(
    private readonly database: DatabaseSync,
    executionTargetId: ExecutionTargetId = LOCAL_EXECUTION_TARGET_ID
  ) {
    this.executionTargetId = ExecutionTargetIdSchema.parse(executionTargetId);
  }

  private prepare(sql: string): StatementSync {
    const cached = this.statements.get(sql);
    if (cached !== undefined) return cached;
    const statement = this.database.prepare(sql);
    this.statements.set(sql, statement);
    return statement;
  }

  list(): WorkspaceVisibilityPolicy[] {
    const rows = this.prepare(
      `SELECT workspace_id, mode, updated_at
       FROM workspace_visibility_policy
       WHERE execution_target_id = ?
       ORDER BY updated_at DESC, workspace_id ASC`
    ).all(this.executionTargetId) as unknown as WorkspaceVisibilityPolicyRow[];

    return WorkspaceVisibilityPolicyListSchema.parse(rows.map((row) => ({
      workspaceId: row.workspace_id,
      mode: row.mode,
      updatedAt: row.updated_at
    })));
  }

  set(
    input: WorkspaceVisibilitySetRequest,
    timestamp: string
  ): WorkspaceVisibilityPolicy[] {
    const request = WorkspaceVisibilitySetRequestSchema.parse(input);
    const updatedAt = new Date(timestamp).toISOString();
    const workspace = this.prepare(
      `SELECT 1 FROM workspace
       WHERE execution_target_id = ? AND id = ?`
    ).get(this.executionTargetId, request.workspaceId);
    if (workspace === undefined) {
      throw new Error('Workspace does not belong to this execution target.');
    }

    this.prepare(
      `INSERT INTO workspace_visibility_policy (
        execution_target_id, workspace_id, mode, updated_at
      ) VALUES (?, ?, ?, ?)
      ON CONFLICT(execution_target_id, workspace_id) DO UPDATE SET
        mode = excluded.mode,
        updated_at = excluded.updated_at`
    ).run(
      this.executionTargetId,
      request.workspaceId,
      request.mode,
      updatedAt
    );
    return this.list();
  }

  restore(workspaceIds: readonly string[]): WorkspaceVisibilityPolicy[] {
    const request = WorkspaceVisibilityRestoreRequestSchema.parse({ workspaceIds });
    const remove = this.prepare(
      `DELETE FROM workspace_visibility_policy
       WHERE execution_target_id = ? AND workspace_id = ?`
    );

    this.database.exec('BEGIN IMMEDIATE');
    try {
      for (const workspaceId of new Set(request.workspaceIds)) {
        remove.run(this.executionTargetId, workspaceId);
      }
      this.database.exec('COMMIT');
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
    return this.list();
  }

  restoreAll(): WorkspaceVisibilityPolicy[] {
    this.prepare(
      `DELETE FROM workspace_visibility_policy
       WHERE execution_target_id = ?`
    ).run(this.executionTargetId);
    return this.list();
  }
}
