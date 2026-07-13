import { useEffect, useState, type ReactNode } from 'react';

import type {
  WorkspaceSummary,
  WorkspaceTrustDecision
} from '../../../shared/contracts';

export function WorkspaceTrustPanel({
  workspaces
}: {
  workspaces: readonly WorkspaceSummary[];
}): ReactNode {
  const [decisions, setDecisions] = useState<WorkspaceTrustDecision[]>([]);
  const [loading, setLoading] = useState(true);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void window.lumora.getWorkspaceTrustDecisions().then(
      (values) => {
        if (!active) return;
        setDecisions(values);
        setLoading(false);
      },
      () => {
        if (!active) return;
        setError('Workspace trust decisions could not be loaded.');
        setLoading(false);
      }
    );
    return () => {
      active = false;
    };
  }, []);

  const revoke = (workspaceId: string) => {
    setRevokingId(workspaceId);
    setError(null);
    void window.lumora.revokeWorkspaceTrust(workspaceId).then(
      (values) => {
        setDecisions(values);
        setRevokingId(null);
      },
      () => {
        setError('Workspace trust could not be revoked.');
        setRevokingId(null);
      }
    );
  };

  return (
    <section
      aria-labelledby="workspace-trust-title"
      className="catalog-panel workspace-trust-panel"
    >
      <header className="provider-panel-header">
        <div>
          <p className="card-label">Execution boundary</p>
          <h2 id="workspace-trust-title">Workspace trust</h2>
          <p>
            Persistent approvals let providers run in exact workspace paths.
            Trust is revocable and is not an OS sandbox.
          </p>
        </div>
      </header>

      {loading ? (
        <div className="catalog-state" role="status">
          Loading workspace trust
        </div>
      ) : decisions.length === 0 ? (
        <div className="workspace-trust-empty">No workspaces are trusted.</div>
      ) : (
        <ul className="workspace-trust-list">
          {decisions.map((decision) => {
            const workspace = workspaces.find(
              (candidate) => candidate.id === decision.workspaceId
            );
            const label = workspace?.displayName ?? 'Workspace not in catalog';
            const revoking = revokingId === decision.workspaceId;
            return (
              <li key={decision.workspaceId}>
                <div>
                  <strong>{label}</strong>
                  <code>{decision.canonicalPath}</code>
                </div>
                <button
                  aria-label={`Revoke trust for ${label}`}
                  className="text-button danger-text"
                  disabled={revokingId !== null}
                  onClick={() => revoke(decision.workspaceId)}
                  type="button"
                >
                  {revoking ? 'Revoking' : 'Revoke'}
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {error === null ? null : (
        <p className="catalog-operation-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
