import type { ReactNode } from 'react';

import type { WorkspaceSummary } from '../../../shared/contracts';
import { useLocalization } from '../localization/useLocalization';

interface WorkspaceTrustNoticeProps {
  workspace: WorkspaceSummary;
  confirmed: boolean;
  onConfirmedChange(confirmed: boolean): void;
}

export function WorkspaceTrustNotice({
  workspace,
  confirmed,
  onConfirmedChange
}: WorkspaceTrustNoticeProps): ReactNode {
  const { t } = useLocalization();
  return (
    <section
      aria-label={t('terminal.trust.required-label')}
      className="workspace-trust-notice"
    >
      <div className="workspace-trust-heading">
        <div>
          <p className="card-label">{t('terminal.trust.required-label')}</p>
          <h3>{workspace.displayName}</h3>
        </div>
        <code>{workspace.canonicalPath}</code>
      </div>
      <label className="workspace-trust-confirmation">
        <input
          checked={confirmed}
          onChange={(event) => onConfirmedChange(event.currentTarget.checked)}
          type="checkbox"
        />
        <span>{t('terminal.trust.confirmation')}</span>
      </label>
      <p>
        {t('terminal.trust.permissions')}
      </p>
      <p>
        {t('terminal.trust.sandbox-warning')}
      </p>
    </section>
  );
}
