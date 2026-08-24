import type { ReactNode } from 'react';

import type {
  LaunchPreview,
  WorkspaceSummary
} from '../../../shared/contracts';
import { LaunchDetails } from './LaunchDetails';
import type { LaunchPreflightStatus } from './useLaunchPreflight';
import { WorkspaceTrustNotice } from './WorkspaceTrustNotice';
import { useLocalization } from '../localization/useLocalization';

interface LaunchReadinessProps {
  actionError?: string | null;
  blockingReason?: string | null;
  emptyMessage: string;
  failureMessage: string;
  preparingMessage: string;
  preview: LaunchPreview | null;
  status: LaunchPreflightStatus;
  trustConfirmed: boolean;
  workspace?: WorkspaceSummary | undefined;
  onRetry(): void;
  onTrustConfirmedChange(confirmed: boolean): void;
}

export function LaunchReadiness({
  actionError = null,
  blockingReason = null,
  emptyMessage,
  failureMessage,
  preparingMessage,
  preview,
  status,
  trustConfirmed,
  workspace,
  onRetry,
  onTrustConfirmedChange
}: LaunchReadinessProps): ReactNode {
  const { t } = useLocalization();
  return (
    <section
      aria-label={t('terminal.launch.readiness-label')}
      className="launch-readiness"
    >
      {blockingReason === null ? null : (
        <div className="catalog-operation-error" role="alert">
          {blockingReason}
        </div>
      )}
      {actionError === null ? null : (
        <div className="catalog-operation-error" role="alert">
          {actionError}
        </div>
      )}

      {status === 'preparing' ? (
        <div className="launch-empty" role="status">
          <p>{preparingMessage}</p>
        </div>
      ) : status === 'failed' ? (
        <div className="catalog-operation-error" role="alert">
          <span>{failureMessage}</span>{' '}
          <button className="text-button" onClick={onRetry} type="button">
            {t('common.actions.retry')}
          </button>
        </div>
      ) : preview === null ? (
        <div className="launch-empty">
          <p>{emptyMessage}</p>
        </div>
      ) : (
        <>
          {!preview.workspaceTrusted && workspace !== undefined ? (
            <WorkspaceTrustNotice
              confirmed={trustConfirmed}
              onConfirmedChange={onTrustConfirmedChange}
              workspace={workspace}
            />
          ) : null}
          <LaunchDetails preview={preview} />
          {preview.workspaceTrusted && workspace !== undefined ? (
            <div className="workspace-trust-ready" role="status">
              <span>{t('terminal.launch.workspace-security')}</span>
              <strong>{t('terminal.launch.trusted')}</strong>
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}
