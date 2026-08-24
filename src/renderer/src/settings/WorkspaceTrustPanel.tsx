import { useEffect, useState, type ReactNode } from 'react';

import type {
  WorkspaceSummary,
  WorkspaceTrustDecision
} from '../../../shared/contracts';
import { useLocalization } from '../localization/useLocalization';

export function WorkspaceTrustPanel({
  workspaces
}: {
  workspaces: readonly WorkspaceSummary[];
}): ReactNode {
  const { t } = useLocalization();
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
        setError(t('settings.security.load-error'));
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
        setError(t('settings.security.revoke-error'));
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
          <p className="card-label">{t('settings.security.eyebrow')}</p>
          <h2 id="workspace-trust-title">{t('settings.security.title')}</h2>
          <p>{t('settings.security.description')}</p>
        </div>
      </header>

      {loading ? (
        <div className="catalog-state" role="status">
          {t('settings.security.loading')}
        </div>
      ) : decisions.length === 0 ? (
        <div className="workspace-trust-empty">{t('settings.security.empty')}</div>
      ) : (
        <ul className="workspace-trust-list">
          {decisions.map((decision) => {
            const workspace = workspaces.find(
              (candidate) => candidate.id === decision.workspaceId
            );
            const label = workspace?.displayName ?? t('settings.security.not-in-catalog');
            const revoking = revokingId === decision.workspaceId;
            return (
              <li key={decision.workspaceId}>
                <div>
                  <strong>{label}</strong>
                  <code>{decision.canonicalPath}</code>
                </div>
                <button
                  aria-label={t('settings.security.revoke-label', { workspace: label })}
                  className="text-button danger-text"
                  disabled={revokingId !== null}
                  onClick={() => revoke(decision.workspaceId)}
                  type="button"
                >
                  {t(revoking ? 'settings.security.revoking' : 'settings.security.revoke')}
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
