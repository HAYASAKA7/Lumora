import type { ReactNode } from 'react';

import type {
  LaunchPreview,
  RuntimeSummary,
  WorkspaceSummary
} from '../../../shared/contracts';
import { LaunchConfiguration } from './LaunchConfiguration';
import { useLocalization } from '../localization/useLocalization';

const IDENTITY_MATCH_KEYS: Record<
  RuntimeSummary['reconciliationState'],
  string
> = {
  not_required: 'terminal.details.identity-native',
  pending: 'terminal.details.identity-pending',
  linked: 'terminal.details.identity-linked',
  ambiguous: 'terminal.details.identity-ambiguous',
  unresolved: 'terminal.details.identity-unresolved'
};

const LAUNCH_TYPE_KEYS: Record<RuntimeSummary['strategy'], string> = {
  new: 'terminal.details.strategy-new',
  resume: 'terminal.details.strategy-resume',
  fork: 'terminal.details.strategy-fork'
};

interface TerminalDetailsDialogProps {
  runtime: RuntimeSummary;
  preview: LaunchPreview | undefined;
  workspace: WorkspaceSummary | undefined;
  onClose(): void;
}

export function TerminalDetailsDialog({
  runtime,
  preview,
  workspace,
  onClose
}: TerminalDetailsDialogProps): ReactNode {
  const { t } = useLocalization();
  return (
    <div className="dialog-backdrop" role="presentation">
      <section
        aria-labelledby="terminal-details-title"
        aria-modal="true"
        className="new-session-dialog terminal-details-dialog"
        role="dialog"
      >
        <header>
          <div>
            <p className="card-label">{t('terminal.details.metadata-label')}</p>
            <h2 id="terminal-details-title">{t('terminal.details.title')}</h2>
          </div>
          <button
            aria-label={t('terminal.details.close-label')}
            className="text-button"
            onClick={onClose}
            type="button"
          >
            {t('common.actions.close')}
          </button>
        </header>

        <div className="dialog-body">
        <aside aria-label={t('terminal.details.inspector-label')} className="terminal-inspector">
          <dl>
            <div><dt>{t('terminal.details.provider')}</dt><dd>{runtime.provider}</dd></div>
            <div><dt>{t('terminal.details.process')}</dt><dd>{runtime.pid ?? t('terminal.details.not-live')}</dd></div>
            <div><dt>{t('terminal.launch.executable')}</dt><dd>{preview?.executablePath ?? t('terminal.details.saved-runtime')}</dd></div>
            <div><dt>{t('terminal.launch.working-directory')}</dt><dd>{preview?.workingDirectory ?? workspace?.canonicalPath ?? t('terminal.details.unavailable')}</dd></div>
            <div><dt>{t('terminal.details.launch-type')}</dt><dd>{t(LAUNCH_TYPE_KEYS[runtime.strategy])}</dd></div>
            <div><dt>{t('terminal.details.identity-match')}</dt><dd>{t(IDENTITY_MATCH_KEYS[runtime.reconciliationState])}</dd></div>
            <div><dt>{t('terminal.details.session')}</dt><dd>{runtime.sessionId?.slice(0, 12) ?? t('terminal.details.not-linked')}</dd></div>
            <div><dt>{t('terminal.details.launch-hash')}</dt><dd>{runtime.launchHash.slice(0, 16)}</dd></div>
          </dl>
          {preview === undefined ? null : (
            <LaunchConfiguration preview={preview} />
          )}
        </aside>
        </div>
      </section>
    </div>
  );
}
