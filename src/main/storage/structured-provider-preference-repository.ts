import type { DatabaseSync } from 'node:sqlite';

import {
  ExecutionTargetIdSchema,
  STRUCTURED_AGENT_PROVIDER_IDS,
  StructuredAgentProviderIdSchema,
  StructuredProviderPreferenceInputSchema,
  StructuredProviderPreferenceListSchema,
  StructuredProviderPreferenceSchema,
  type ExecutionTargetId,
  type StructuredAgentProviderId,
  type StructuredProviderPreference
} from '../../shared/contracts';

interface PreferenceRow {
  provider_id: string;
  use_unified_when_available: number;
  executable_path_override: string | null;
}

export class StructuredProviderPreferenceRepository {
  private readonly executionTargetId: ExecutionTargetId;

  constructor(
    private readonly database: DatabaseSync,
    executionTargetId: ExecutionTargetId
  ) {
    this.executionTargetId = ExecutionTargetIdSchema.parse(executionTargetId);
    if (this.database.prepare(
      'SELECT 1 FROM execution_target WHERE id = ?'
    ).get(this.executionTargetId) === undefined) {
      throw new Error('The execution target does not exist.');
    }
  }

  list(): StructuredProviderPreference[] {
    const rows = this.database.prepare(
      `SELECT provider_id, use_unified_when_available, executable_path_override
       FROM structured_provider_preference
       WHERE execution_target_id = ?`
    ).all(this.executionTargetId) as unknown as PreferenceRow[];
    const saved = new Map(rows.map((row) => [
      StructuredAgentProviderIdSchema.parse(row.provider_id),
      StructuredProviderPreferenceSchema.parse({
        providerId: row.provider_id,
        useUnifiedWhenAvailable: row.use_unified_when_available === 1,
        executablePathOverride: row.executable_path_override
      })
    ]));
    return StructuredProviderPreferenceListSchema.parse(
      STRUCTURED_AGENT_PROVIDER_IDS.map((providerId) => saved.get(providerId) ?? {
        providerId,
        useUnifiedWhenAvailable: true,
        executablePathOverride: null
      })
    );
  }

  get(providerId: StructuredAgentProviderId): StructuredProviderPreference {
    const selected = StructuredAgentProviderIdSchema.parse(providerId);
    const preference = this.list().find((item) => item.providerId === selected);
    if (preference === undefined) {
      throw new Error('The structured provider preference was not found.');
    }
    return preference;
  }

  save(
    value: StructuredProviderPreference,
    timestamp: string
  ): StructuredProviderPreference[] {
    const input = StructuredProviderPreferenceInputSchema.parse(value);
    this.database.prepare(
      `INSERT INTO structured_provider_preference (
        execution_target_id, provider_id, use_unified_when_available,
        executable_path_override, updated_at
      ) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(execution_target_id, provider_id) DO UPDATE SET
        use_unified_when_available = excluded.use_unified_when_available,
        executable_path_override = excluded.executable_path_override,
        updated_at = excluded.updated_at`
    ).run(
      this.executionTargetId,
      input.providerId,
      input.useUnifiedWhenAvailable ? 1 : 0,
      input.executablePathOverride,
      new Date(timestamp).toISOString()
    );
    return this.list();
  }
}
