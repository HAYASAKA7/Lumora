import { useEffect, useState, type ReactNode } from 'react';

import type {
  GeneralSettings,
  LumoraApi,
  WorkspaceSummary,
  WorkspaceTrustDecision
} from '../../../shared/contracts';
import { useLocalization } from '../localization/useLocalization';
import { ConfirmDialog } from '../ui/ConfirmDialog';

type WorkspaceTrustApi = Pick<
  LumoraApi,
  | 'getWorkspaceTrustDecisions'
  | 'revokeWorkspaceTrust'
>;

export function WorkspaceTrustPanel({
  api = window.lumora,
  onSettingsChange,
  saving,
  settings,
  workspaces
}: {
  api?: WorkspaceTrustApi;
  onSettingsChange(settings: GeneralSettings): void;
  saving: boolean;
  settings: GeneralSettings;
  workspaces: readonly WorkspaceSummary[];
}): ReactNode {
  const { t } = useLocalization();
  const [decisions, setDecisions] = useState<WorkspaceTrustDecision[]>([]);
  const [loading, setLoading] = useState(true);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmingAutoTrust, setConfirmingAutoTrust] = useState(false);
  const [riskAcknowledged, setRiskAcknowledged] = useState(false);

  useEffect(() => {
    let active = true;
    if (typeof api.getWorkspaceTrustDecisions !== 'function') {
      setDecisions([]);
      setLoading(false);
      return () => {
        active = false;
      };
    }
    void api.getWorkspaceTrustDecisions().then(
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
  }, [api, t]);

  const revoke = (workspaceId: string) => {
    if (typeof api.revokeWorkspaceTrust !== 'function') return;
    setRevokingId(workspaceId);
    setError(null);
    void api.revokeWorkspaceTrust(workspaceId).then(
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

      <section
        aria-labelledby="workspace-auto-trust-title"
        className="general-setting-group workspace-auto-trust"
        role="group"
      >
        <h3 className="general-setting-group-title" id="workspace-auto-trust-title">
          {t('settings.security.auto-trust-group')}
        </h3>
        <div className="general-setting-group-rows">
          <label className="general-setting-row">
            <span className="general-setting-copy">
              <strong>{t('settings.security.auto-trust-label')}</strong>
              <span id="workspace-auto-trust-description">
                {t('settings.security.auto-trust-description')}
              </span>
            </span>
            <span className="settings-switch">
              <input
                aria-describedby="workspace-auto-trust-description"
                aria-label={t('settings.security.auto-trust-label')}
                checked={settings.autoTrustWorkspaces}
                disabled={saving}
                onChange={(event) => {
                  if (!event.currentTarget.checked) {
                    onSettingsChange({
                      ...settings,
                      autoTrustWorkspaces: false
                    });
                    return;
                  }
                  setRiskAcknowledged(false);
                  setConfirmingAutoTrust(true);
                }}
                role="switch"
                type="checkbox"
              />
              <span aria-hidden="true" className="settings-switch-track">
                <span className="settings-switch-thumb" />
              </span>
            </span>
          </label>
        </div>
      </section>

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

      {!confirmingAutoTrust ? null : (
        <ConfirmDialog
          acknowledgement={{
            checked: riskAcknowledged,
            label: t('settings.security.auto-trust-acknowledgement'),
            onChange: setRiskAcknowledged
          }}
          confirmDisabled={!riskAcknowledged || saving}
          confirmLabel={t('settings.security.auto-trust-confirm')}
          description={t('settings.security.auto-trust-warning')}
          heading={t('settings.security.auto-trust-heading')}
          onCancel={() => {
            setRiskAcknowledged(false);
            setConfirmingAutoTrust(false);
          }}
          onConfirm={() => {
            if (!riskAcknowledged || saving) return;
            onSettingsChange({
              ...settings,
              autoTrustWorkspaces: true
            });
            setRiskAcknowledged(false);
            setConfirmingAutoTrust(false);
          }}
        />
      )}
    </section>
  );
}
