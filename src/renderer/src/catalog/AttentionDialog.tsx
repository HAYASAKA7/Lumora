import { createPortal } from 'react-dom';
import type { ReactNode } from 'react';

import type {
  CatalogDiagnostic,
  RuntimeSummary,
  SessionSummary
} from '../../../shared/contracts';
import { providerDefinition } from '../../../shared/provider-definitions';
import { resolveRuntimeRecovery } from '../terminal/runtime-recovery';
import { CloseButton } from '../ui/CloseButton';
import { useEscapeLayer } from '../ui/escape-layers';
import { useLocalization } from '../localization/useLocalization';

/**
 * What the Home card counts, spelled out. The card reports one number and this
 * dialog holds the detail, so a growing list of problems cannot push the rest
 * of the dashboard down the page.
 */
export function AttentionDialog({
  diagnostics,
  lostRuntimes,
  onClose,
  onRecover,
  sessions
}: {
  diagnostics: readonly CatalogDiagnostic[];
  lostRuntimes: readonly RuntimeSummary[];
  onClose(): void;
  onRecover?: ((runtime: RuntimeSummary) => void) | undefined;
  sessions: readonly SessionSummary[];
}): ReactNode {
  const { t } = useLocalization();
  useEscapeLayer(onClose);

  return createPortal(
    <div className="dialog-backdrop" role="presentation">
      <section
        aria-labelledby="attention-title"
        aria-modal="true"
        className="new-session-dialog attention-dialog"
        role="dialog"
      >
        <header>
          <div>
            <p className="card-label">{t('catalog.home.diagnostics-label')}</p>
            <h2 id="attention-title">{t('catalog.home.needs-attention')}</h2>
          </div>
          <CloseButton
            onClose={onClose}
          />
        </header>

        <div className="dialog-body">
          {diagnostics.length === 0 ? null : (
            <div className="attention-group">
              <h3>{t('catalog.home.attention-catalog-heading')}</h3>
              <ul className="attention-list">
                {diagnostics.map((diagnostic) => (
                  <li
                    className="attention-issue"
                    key={`${diagnostic.code}:${diagnostic.provider ?? ''}`}
                  >
                    <p className="attention-issue-message">
                      {diagnostic.provider === null ? null : (
                        <strong>
                          {providerDefinition(diagnostic.provider).displayName}
                        </strong>
                      )}
                      {diagnostic.message}
                    </p>
                    <p className="attention-issue-recovery">
                      {diagnostic.recovery}
                    </p>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {lostRuntimes.length === 0 ? null : (
            <div className="attention-group">
              <h3>{t('catalog.home.attention-runtime-heading')}</h3>
              <ul className="runtime-recovery-list">
                {lostRuntimes.map((runtime) => {
                  const recovery = resolveRuntimeRecovery(runtime, sessions);
                  return (
                    <li className="runtime-recovery-item" key={runtime.id}>
                      <span className="runtime-recovery-message">
                        <strong>
                          {providerDefinition(runtime.provider).displayName}
                        </strong>
                        <small>
                          {t(recovery?.strategy === 'resume'
                            ? 'catalog.home.resume-saved-session'
                            : 'catalog.home.restart-new-session')}
                        </small>
                      </span>
                      {onRecover === undefined ? null : (
                        <button
                          className="text-button"
                          data-lumora-command
                          onClick={() => {
                            onClose();
                            onRecover(runtime);
                          }}
                          type="button"
                        >
                          {t('catalog.home.recover')}
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </div>
      </section>
    </div>,
    document.body
  );
}
