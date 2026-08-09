import type { DatabaseSync, StatementSync } from 'node:sqlite';

import {
  CatalogSnapshotSchema,
  ExecutionTargetIdSchema,
  LOCAL_EXECUTION_TARGET_ID,
  ProviderIdSchema,
  type CatalogDiagnostic,
  type CatalogProviderStatus,
  type CatalogQuery,
  type CatalogSnapshot,
  type ExecutionTargetId,
  type ProviderId,
  type WorkspaceOrigin
} from '../../shared/contracts';
import { SESSION_PROVIDER_IDS } from '../../shared/provider-definitions';
import {
  CatalogCandidateSchema,
  createSessionId,
  type CatalogCandidate,
  type CatalogSourceFingerprint
} from '../catalog/catalog-candidate';
import type { CanonicalWorkspacePath } from '../platform/workspace-path';

interface ProviderScanWrite {
  provider: ProviderId;
  scanId: string;
  scannedAt: string;
  candidates: readonly CatalogCandidate[];
  preserveMissingSources?: boolean;
}

interface SnapshotOptions {
  query: CatalogQuery;
  refreshedAt: string;
  providerStatus: readonly CatalogProviderStatus[];
  availableProviders: readonly ProviderId[];
  diagnostics: readonly CatalogDiagnostic[];
}

export interface StoredCatalogSource {
  fingerprint: CatalogSourceFingerprint | null;
  candidate: CatalogCandidate;
}

export interface CatalogTransferSession {
  readonly id: string;
  readonly provider: ProviderId;
  readonly nativeId: string;
  readonly title: string;
  readonly workspaceId: string;
  readonly workspacePath: string;
  readonly sourceKeys: readonly string[];
}

interface TransferSessionRow {
  id: string;
  provider: ProviderId;
  native_id: string;
  title: string;
  workspace_id: string;
  canonical_path: string;
}

interface TransferSourceRow {
  source_key: string;
}

interface WorkspaceRow {
  id: string;
  identity_key: string;
  canonical_path: string;
  display_name: string;
  available: number;
  origin: WorkspaceOrigin;
  last_activity_at: string | null;
}

interface ProviderCountRow {
  workspace_id: string;
  provider: ProviderId;
  session_count: number;
}

interface ProviderFacetRow {
  provider: ProviderId;
  session_count: number;
}

interface SessionRow {
  id: string;
  provider: ProviderId;
  native_id: string;
  workspace_id: string;
  title: string;
  created_at: string;
  updated_at: string;
  lifetime_tokens: number | null;
  lifecycle: CatalogSnapshot['sessions'][number]['lifecycle'];
  source_freshness: CatalogSnapshot['sessions'][number]['sourceFreshness'];
}

interface SourceRow extends SessionRow {
  source_key: string;
  size: number | null;
  modified_at_ms: number | null;
  identity_key: string;
  canonical_path: string;
  display_name: string;
  available: number;
}

function normalizedSearchValue(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase();
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, '\\$&');
}

function normalizeTimestamp(value: string): string {
  return new Date(value).toISOString();
}

export class CatalogRepository {
  private readonly statements = new Map<string, StatementSync>();

  private readonly executionTargetId: ExecutionTargetId;

  constructor(
    private readonly database: DatabaseSync,
    executionTargetId: ExecutionTargetId = LOCAL_EXECUTION_TARGET_ID
  ) {
    this.executionTargetId = ExecutionTargetIdSchema.parse(executionTargetId);
  }

  private prepare(sql: string): StatementSync {
    const current = this.statements.get(sql);
    if (current !== undefined) {
      return current;
    }
    const statement = this.database.prepare(sql);
    this.statements.set(sql, statement);
    return statement;
  }

  registerWorkspace(
    workspace: CanonicalWorkspacePath,
    origin: WorkspaceOrigin,
    timestamp: string
  ): void {
    this.prepare(
      `INSERT INTO workspace (
        execution_target_id, id, identity_key, canonical_path, display_name,
        available, origin, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(execution_target_id, id) DO UPDATE SET
        identity_key = excluded.identity_key,
        canonical_path = excluded.canonical_path,
        display_name = excluded.display_name,
        available = excluded.available,
        origin = CASE
          WHEN workspace.origin = 'manual' THEN 'manual'
          ELSE excluded.origin
        END,
        updated_at = excluded.updated_at`
    )
      .run(
        this.executionTargetId,
        workspace.id,
        workspace.identityKey,
        workspace.canonicalPath,
        workspace.displayName,
        workspace.available ? 1 : 0,
        origin,
        normalizeTimestamp(timestamp),
        normalizeTimestamp(timestamp)
      );
  }

  applyProviderScan({
    provider,
    scanId,
    scannedAt,
    candidates,
    preserveMissingSources = false
  }: ProviderScanWrite): void {
    ProviderIdSchema.parse(provider);
    const validatedCandidates = candidates
      .map((value) => CatalogCandidateSchema.parse(value))
      .map((value) => {
        if (value.provider !== provider) {
          throw new Error('Catalog candidates must match their provider scan.');
        }
        return {
          ...value,
          createdAt: normalizeTimestamp(value.createdAt),
          updatedAt: normalizeTimestamp(value.updatedAt)
        };
      })
      .sort(
        (left, right) =>
          left.updatedAt.localeCompare(right.updatedAt) ||
          left.title.localeCompare(right.title) ||
          left.workspace.id.localeCompare(right.workspace.id) ||
          left.source.key.localeCompare(right.source.key)
      );

    const upsertSession = this.prepare(
      `INSERT INTO session (
        execution_target_id, id, provider, native_id, workspace_id, title,
        normalized_title, created_at, updated_at, lifetime_tokens, lifecycle,
        source_freshness
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'saved', 'current')
      ON CONFLICT(execution_target_id, provider, native_id) DO UPDATE SET
        workspace_id = CASE WHEN
          excluded.updated_at >= session.updated_at
          THEN excluded.workspace_id ELSE session.workspace_id END,
        title = CASE WHEN
          excluded.updated_at >= session.updated_at
          THEN excluded.title ELSE session.title END,
        normalized_title = CASE WHEN
          excluded.updated_at >= session.updated_at
          THEN excluded.normalized_title ELSE session.normalized_title END,
        created_at = MIN(session.created_at, excluded.created_at),
        updated_at = MAX(session.updated_at, excluded.updated_at),
        lifetime_tokens = COALESCE(
          excluded.lifetime_tokens,
          session.lifetime_tokens
        ),
        lifecycle = 'saved',
        source_freshness = 'current'`
    );
    const upsertSource = this.prepare(
      `INSERT INTO session_source (
        execution_target_id, provider, source_key, session_id, size,
        modified_at_ms, last_seen_scan_id, stale
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 0)
      ON CONFLICT(execution_target_id, provider, source_key) DO UPDATE SET
        session_id = excluded.session_id,
        size = excluded.size,
        modified_at_ms = excluded.modified_at_ms,
        last_seen_scan_id = excluded.last_seen_scan_id,
        stale = 0`
    );

    this.database.exec('BEGIN IMMEDIATE');
    const writtenWorkspaces = new Set<string>();
    try {
      for (const current of validatedCandidates) {
        if (!writtenWorkspaces.has(current.workspace.id)) {
          this.registerWorkspace(current.workspace, 'discovered', scannedAt);
          writtenWorkspaces.add(current.workspace.id);
        }
        const sessionId = createSessionId(
          current.provider,
          current.nativeId,
          this.executionTargetId
        );
        upsertSession.run(
          this.executionTargetId,
          sessionId,
          current.provider,
          current.nativeId,
          current.workspace.id,
          current.title,
          normalizedSearchValue(current.title),
          current.createdAt,
          current.updatedAt,
          current.lifetimeTokens
        );
        upsertSource.run(
          this.executionTargetId,
          current.provider,
          current.source.key,
          sessionId,
          current.source.fingerprint?.size ?? null,
          current.source.fingerprint?.modifiedAtMs ?? null,
          scanId
        );
      }

      if (!preserveMissingSources) {
        this.prepare(
          `UPDATE session_source
           SET stale = 1
           WHERE execution_target_id = ? AND provider = ?
             AND last_seen_scan_id <> ?`
        )
          .run(this.executionTargetId, provider, scanId);
      }
      this.prepare(
        `UPDATE session
         SET source_freshness = CASE WHEN EXISTS (
           SELECT 1 FROM session_source source
           WHERE source.execution_target_id = session.execution_target_id
             AND source.session_id = session.id AND source.stale = 0
         ) THEN 'current' ELSE 'stale' END
         WHERE execution_target_id = ? AND provider = ?`
      )
        .run(this.executionTargetId, provider);
      this.database.exec('COMMIT');
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }

  findSource(provider: ProviderId, sourceKey: string): StoredCatalogSource | null {
    ProviderIdSchema.parse(provider);
    const row = this.prepare(
      `SELECT
        source.source_key, source.size, source.modified_at_ms,
        session.id, session.provider, session.native_id, session.workspace_id,
        session.title, session.created_at, session.updated_at,
        session.lifetime_tokens,
        session.lifecycle, session.source_freshness,
        workspace.identity_key, workspace.canonical_path,
        workspace.display_name, workspace.available
      FROM session_source source
      JOIN session ON session.execution_target_id = source.execution_target_id
        AND session.id = source.session_id
      JOIN workspace ON workspace.execution_target_id = session.execution_target_id
        AND workspace.id = session.workspace_id
      WHERE source.execution_target_id = ?
        AND source.provider = ? AND source.source_key = ?`
    )
      .get(this.executionTargetId, provider, sourceKey) as SourceRow | undefined;

    if (row === undefined) {
      return null;
    }

    const fingerprint =
      row.size === null || row.modified_at_ms === null
        ? null
        : { size: row.size, modifiedAtMs: row.modified_at_ms };
    const storedCandidate = CatalogCandidateSchema.parse({
      provider: row.provider,
      nativeId: row.native_id,
      workspace: {
        id: row.workspace_id,
        identityKey: row.identity_key,
        canonicalPath: row.canonical_path,
        displayName: row.display_name,
        available: row.available === 1
      },
      title: row.title,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      lifetimeTokens: row.lifetime_tokens,
      source: { key: row.source_key, fingerprint }
    });

    return { fingerprint, candidate: storedCandidate };
  }

  getTransferSession(sessionId: string): CatalogTransferSession | null {
    if (!/^[a-f0-9]{64}$/.test(sessionId)) {
      throw new Error('Catalog session IDs must be stable identifiers.');
    }
    const row = this.prepare(
      `SELECT
        session.id, session.provider, session.native_id, session.title,
        session.workspace_id, workspace.canonical_path
      FROM session
      JOIN workspace ON workspace.execution_target_id = session.execution_target_id
        AND workspace.id = session.workspace_id
      WHERE session.execution_target_id = ? AND session.id = ?
        AND session.source_freshness = 'current'`
    )
      .get(this.executionTargetId, sessionId) as TransferSessionRow | undefined;
    if (row === undefined) {
      return null;
    }

    const sourceKeys = (
      this.prepare(
        `SELECT source_key
         FROM session_source
         WHERE execution_target_id = ? AND session_id = ? AND stale = 0
         ORDER BY source_key`
      )
        .all(this.executionTargetId, sessionId) as unknown as TransferSourceRow[]
    ).map(({ source_key }) => source_key);
    if (sourceKeys.length === 0) {
      return null;
    }

    return Object.freeze({
      id: row.id,
      provider: ProviderIdSchema.parse(row.provider),
      nativeId: row.native_id,
      title: row.title,
      workspaceId: row.workspace_id,
      workspacePath: row.canonical_path,
      sourceKeys: Object.freeze(sourceKeys)
    });
  }

  getTransferSessionProvider(sessionId: string): ProviderId | null {
    if (!/^[a-f0-9]{64}$/.test(sessionId)) {
      throw new Error('Catalog session IDs must be stable identifiers.');
    }
    const row = this.prepare(
      `SELECT provider
       FROM session
       WHERE execution_target_id = ? AND id = ?`
    ).get(this.executionTargetId, sessionId) as { provider: ProviderId } | undefined;
    return row === undefined ? null : ProviderIdSchema.parse(row.provider);
  }

  hasNativeSession(provider: ProviderId, nativeId: string): boolean {
    ProviderIdSchema.parse(provider);
    const normalizedNativeId = nativeId.trim();
    if (normalizedNativeId.length === 0 || normalizedNativeId.length > 256) {
      throw new Error('Provider session identities must be non-empty.');
    }
    return this.prepare(
      `SELECT 1
       FROM session
       WHERE execution_target_id = ? AND provider = ? AND native_id = ?
       LIMIT 1`
    )
      .get(this.executionTargetId, provider, normalizedNativeId) !== undefined;
  }

  getSnapshot({
    query,
    refreshedAt,
    providerStatus,
    availableProviders,
    diagnostics
  }: SnapshotOptions): CatalogSnapshot {
    const visibleProviders = [
      ...new Set(availableProviders.map((provider) => ProviderIdSchema.parse(provider)))
    ];
    const providerPlaceholders = visibleProviders.map(() => '?').join(', ');
    const currentProviderCondition =
      visibleProviders.length === 0
        ? '0'
        : `session.provider IN (${providerPlaceholders})`;

    const providerCountsByWorkspace = new Map<
      string,
      Partial<Record<ProviderId, number>>
    >();
    for (const row of this.prepare(
      `SELECT session.workspace_id, session.provider,
        COUNT(*) AS session_count
      FROM session
      WHERE session.execution_target_id = ?
        AND session.source_freshness = 'current'
        AND ${currentProviderCondition}
      GROUP BY session.workspace_id, session.provider`
    )
      .all(this.executionTargetId, ...visibleProviders) as unknown as ProviderCountRow[]) {
      const counts = providerCountsByWorkspace.get(row.workspace_id) ?? {};
      counts[row.provider] = row.session_count;
      providerCountsByWorkspace.set(row.workspace_id, counts);
    }

    const workspaces = (
      this.prepare(
        `SELECT
          workspace.id, workspace.identity_key, workspace.canonical_path,
          workspace.display_name, workspace.available, workspace.origin,
          MAX(session.updated_at) AS last_activity_at
        FROM workspace
        LEFT JOIN session ON session.execution_target_id = workspace.execution_target_id
          AND session.workspace_id = workspace.id
          AND session.source_freshness = 'current'
          AND ${currentProviderCondition}
        WHERE workspace.execution_target_id = ?
        GROUP BY workspace.id
        ORDER BY last_activity_at IS NULL, last_activity_at DESC,
          workspace.display_name COLLATE NOCASE, workspace.id`
      )
        .all(...visibleProviders, this.executionTargetId) as unknown as WorkspaceRow[]
    ).map((row) => {
      const providerCounts = providerCountsByWorkspace.get(row.id) ?? {};
      return {
        id: row.id,
        displayName: row.display_name,
        canonicalPath: row.canonical_path,
        available: row.available === 1,
        origin: row.origin,
        sessionCount: Object.values(providerCounts).reduce(
          (total, count) => total + (count ?? 0),
          0
        ),
        providerCounts,
        lastActivityAt: row.last_activity_at
      };
    });

    const facetCounts = new Map<ProviderId, number>(
      (
        this.prepare(
          `SELECT session.provider, COUNT(*) AS session_count
           FROM session
           WHERE session.execution_target_id = ?
             AND session.source_freshness = 'current'
             AND ${currentProviderCondition}
           GROUP BY session.provider`
        )
          .all(this.executionTargetId, ...visibleProviders) as unknown as ProviderFacetRow[]
      ).map((row) => [row.provider, row.session_count])
    );
    const providerFacets = SESSION_PROVIDER_IDS.flatMap((provider) => {
      const sessionCount = facetCounts.get(provider);
      return sessionCount === undefined ? [] : [{ provider, sessionCount }];
    });

    const normalizedText = normalizedSearchValue(query.text);
    const pattern = `%${escapeLike(normalizedText)}%`;
    const sessions = (
      this.prepare(
        `SELECT
          session.id, session.provider, session.native_id,
          session.workspace_id, session.title, session.created_at,
          session.updated_at, session.lifetime_tokens, session.lifecycle,
          session.source_freshness
        FROM session
        JOIN workspace ON workspace.execution_target_id = session.execution_target_id
          AND workspace.id = session.workspace_id
        WHERE session.execution_target_id = ?
        AND (
          ? = '' OR
          session.normalized_title LIKE ? ESCAPE '\\' OR
          LOWER(workspace.display_name) LIKE ? ESCAPE '\\' OR
          LOWER(workspace.canonical_path) LIKE ? ESCAPE '\\'
        )
        AND (? IS NULL OR session.provider = ?)
        AND ${currentProviderCondition}
        ORDER BY session.updated_at DESC, session.provider, session.native_id
        LIMIT 25000`
      )
        .all(
          this.executionTargetId,
          normalizedText,
          pattern,
          pattern,
          pattern,
          query.provider,
          query.provider,
          ...visibleProviders
        ) as unknown as SessionRow[]
    ).map((row) => ({
      id: row.id,
      nativeId: row.native_id,
      provider: row.provider,
      workspaceId: row.workspace_id,
      title: row.title,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      lifetimeTokens: row.lifetime_tokens,
      lifecycle: row.lifecycle,
      sourceFreshness: row.source_freshness
    }));

    return CatalogSnapshotSchema.parse({
      refreshedAt: normalizeTimestamp(refreshedAt),
      workspaces,
      sessions,
      providerStatus: [...providerStatus],
      providerFacets,
      diagnostics: [...diagnostics]
    });
  }
}
