import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import type {
  LaunchPrepareRequest,
  LaunchPreview,
  ProviderScanResult,
  RuntimeSummary,
  SessionSummary,
  TerminalProfile,
  WorkspaceSummary
} from '../../../shared/contracts';
import { SelectMenu } from '../ui/SelectMenu';
import { LaunchReadiness } from './LaunchReadiness';
import { resolveRuntimeRecovery } from './runtime-recovery';
import { useLaunchPreflight } from './useLaunchPreflight';
import { useLocalization } from '../localization/useLocalization';
import { providerDefinition } from '../../../shared/provider-definitions';

interface RuntimeRecoveryDialogProps {
  runtime: RuntimeSummary;
  sessions: readonly SessionSummary[];
  workspaces: readonly WorkspaceSummary[];
  profiles: readonly TerminalProfile[];
  providerScan: ProviderScanResult | null;
  onClose(): void;
  onStarted(runtime: RuntimeSummary, preview: LaunchPreview): void;
}

export function RuntimeRecoveryDialog({
  runtime,
  sessions,
  workspaces,
  profiles,
  providerScan,
  onClose,
  onStarted
}: RuntimeRecoveryDialogProps): ReactNode {
  const { t } = useLocalization();
  const plan = useMemo(
    () => resolveRuntimeRecovery(runtime, sessions),
    [runtime, sessions]
  );
  const availableProfiles = useMemo(
    () => profiles.filter((profile) => profile.available),
    [profiles]
  );
  const [profileId, setProfileId] = useState('');
  const [trustConfirmed, setTrustConfirmed] = useState(false);
  const [starting, setStarting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const launchOperation = useRef(0);

  useEffect(() => () => {
    launchOperation.current += 1;
  }, []);

  useEffect(() => {
    setTrustConfirmed(false);
    setActionError(null);
  }, [profileId]);
  useEffect(() => {
    if (
      profileId !== '' &&
      !availableProfiles.some((profile) => profile.id === profileId)
    ) {
      setProfileId('');
    }
  }, [availableProfiles, profileId]);

  const workspace = workspaces.find(
    (candidate) => candidate.id === runtime.workspaceId
  );
  const provider = providerScan?.providers.find(
    (candidate) => candidate.provider === runtime.provider
  );
  const actionLabel =
    plan?.strategy === 'resume'
      ? t('catalog.home.resume-saved-session')
      : t('catalog.home.restart-new-session');
  const blockingReason =
    plan === null
      ? t('terminal.runtime.recovery-ineligible')
      : workspace?.available !== true
        ? t('terminal.runtime.workspace-unavailable')
        : provider?.state !== 'ready'
          ? t('terminal.runtime.provider-unavailable', {
              provider: providerDefinition(runtime.provider).displayName
            })
          : availableProfiles.length === 0
            ? t('terminal.runtime.profile-unavailable')
            : null;
  const request = useMemo<LaunchPrepareRequest | null>(() => {
    if (
      plan === null ||
      blockingReason !== null ||
      (profileId !== '' &&
        !availableProfiles.some((profile) => profile.id === profileId))
    ) return null;
    return plan.strategy === 'resume'
      ? {
          strategy: 'resume',
          startPrompt: '',
          sessionId: plan.session.id,
          terminalProfileId: profileId || null,
          cols: 100,
          rows: 30
        }
      : {
          strategy: 'new',
          startPrompt: '',
          provider: plan.provider,
          workspaceId: plan.workspaceId,
          terminalProfileId: profileId || null,
          cols: 100,
          rows: 30
        };
  }, [availableProfiles, blockingReason, plan, profileId]);
  const preflight = useLaunchPreflight(request);
  const preview = preflight.preview;

  useEffect(() => {
    if (preflight.status !== 'ready') setTrustConfirmed(false);
  }, [preflight.status]);

  const finishLaunchOperation = (operation: number) => {
    if (launchOperation.current === operation) setStarting(false);
  };

  const retry = () => {
    setActionError(null);
    preflight.retry();
  };

  const start = () => {
    if (
      preview === null ||
      preflight.status !== 'ready' ||
      !preflight.isCurrentLaunchToken(preview.launchToken) ||
      (!preview.workspaceTrusted && !trustConfirmed)
    ) return;
    const operation = launchOperation.current + 1;
    launchOperation.current = operation;
    setStarting(true);
    setActionError(null);
    void (async () => {
      let confirmedPreview = preview;
      if (!preview.workspaceTrusted) {
        try {
          await window.lumora.trustWorkspaceForLaunch(preview.launchToken);
          confirmedPreview = { ...preview, workspaceTrusted: true };
        } catch {
          if (!preflight.isCurrentLaunchToken(preview.launchToken)) {
            finishLaunchOperation(operation);
            return;
          }
          setActionError(t('terminal.runtime.trust-save-failed'));
          finishLaunchOperation(operation);
          return;
        }
        if (!preflight.isCurrentLaunchToken(preview.launchToken)) {
          finishLaunchOperation(operation);
          return;
        }
      }
      try {
        const recoveredRuntime = await window.lumora.startRuntime(
          preview.launchToken
        );
        finishLaunchOperation(operation);
        onStarted(recoveredRuntime, confirmedPreview);
      } catch {
        if (!preflight.isCurrentLaunchToken(preview.launchToken)) {
          finishLaunchOperation(operation);
          return;
        }
        setActionError(t('terminal.runtime.recovery-start-failed'));
        finishLaunchOperation(operation);
        preflight.retry();
      }
    })();
  };

  return (
    <div className="dialog-backdrop" role="presentation">
      <section
        aria-labelledby="runtime-recovery-title"
        aria-modal="true"
        className="new-session-dialog runtime-recovery-dialog"
        role="dialog"
      >
        <header>
          <div>
            <p className="card-label">{t('terminal.runtime.recovery-label')}</p>
            <h2 id="runtime-recovery-title">{t('terminal.runtime.recover-lost')}</h2>
          </div>
          <button
            aria-label={t('terminal.runtime.close-recovery-label')}
            className="text-button"
            onClick={onClose}
            type="button"
          >
            {t('common.actions.close')}
          </button>
        </header>

        <div className="dialog-body">
        <p className="card-description">
          {t('terminal.runtime.recovery-description')}
        </p>

        <dl className="resume-session-details">
          <div><dt>{t('terminal.details.provider')}</dt><dd>{provider?.displayName ?? runtime.provider}</dd></div>
          <div><dt>{t('terminal.resume.workspace')}</dt><dd>{workspace?.displayName ?? t('terminal.details.unavailable')}</dd></div>
          <div><dt>{t('terminal.runtime.recovery-action')}</dt><dd>{actionLabel}</dd></div>
        </dl>

        <div className="launch-fields resume-launch-fields">
          <div className="select-field">
            <span>{t('terminal.new.profile')}</span>
            <SelectMenu
              disabled={starting}
              label={t('terminal.new.profile')}
              onChange={setProfileId}
              options={[
                { value: '', label: t('terminal.new.configured-default') },
                ...availableProfiles.map((profile) => ({
                  value: profile.id,
                  label: profile.name
                }))
              ]}
              value={profileId}
            />
          </div>
        </div>

        <LaunchReadiness
          actionError={actionError}
          blockingReason={blockingReason}
          emptyMessage={t('terminal.runtime.recovery-empty')}
          failureMessage={t('terminal.runtime.recovery-preview-failed')}
          onRetry={retry}
          onTrustConfirmedChange={setTrustConfirmed}
          preparingMessage={t('terminal.runtime.preparing-recovery')}
          preview={preview}
          status={preflight.status}
          trustConfirmed={trustConfirmed}
          workspace={workspace}
        />
        </div>

        <footer>
          <button
            className="refresh-button"
            disabled={
              preview === null ||
              preflight.status !== 'ready' ||
              starting ||
              (!preview.workspaceTrusted && !trustConfirmed)
            }
            onClick={start}
            type="button"
          >
            {starting ? t('terminal.runtime.starting-recovery') : actionLabel}
          </button>
        </footer>
      </section>
    </div>
  );
}
