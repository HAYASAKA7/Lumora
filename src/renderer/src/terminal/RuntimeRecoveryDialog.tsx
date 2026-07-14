import { useEffect, useMemo, useState, type ReactNode } from 'react';

import type {
  LaunchPrepareRequest,
  LaunchPreview,
  ProviderScanResult,
  RuntimeSummary,
  SessionSummary,
  TerminalProfile,
  WorkspaceSummary
} from '../../../shared/contracts';
import { LaunchDetails } from './LaunchDetails';
import { resolveRuntimeRecovery } from './runtime-recovery';
import { useLaunchPreflight } from './useLaunchPreflight';
import { WorkspaceTrustNotice } from './WorkspaceTrustNotice';

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
      ? 'Resume saved session'
      : 'Restart as new session';
  const blockingReason =
    plan === null
      ? 'This runtime is not eligible for recovery.'
      : workspace?.available !== true
        ? 'The workspace is unavailable.'
        : provider?.state !== 'ready'
          ? `${runtime.provider === 'codex' ? 'Codex' : 'Claude Code'} is unavailable.`
          : availableProfiles.length === 0
            ? 'No terminal profile is available.'
            : null;
  const request = useMemo<LaunchPrepareRequest | null>(() => {
    if (plan === null || blockingReason !== null) return null;
    return plan.strategy === 'resume'
      ? {
          strategy: 'resume',
          sessionId: plan.session.id,
          terminalProfileId: profileId || null,
          cols: 100,
          rows: 30
        }
      : {
          strategy: 'new',
          provider: plan.provider,
          workspaceId: plan.workspaceId,
          terminalProfileId: profileId || null,
          cols: 100,
          rows: 30
        };
  }, [blockingReason, plan, profileId]);
  const preflight = useLaunchPreflight(request);
  const preview = preflight.preview;

  useEffect(() => {
    setTrustConfirmed(false);
  }, [preview?.launchToken]);

  const retry = () => {
    setActionError(null);
    preflight.retry();
  };

  const start = () => {
    if (
      preview === null ||
      preflight.status !== 'ready' ||
      (!preview.workspaceTrusted && !trustConfirmed)
    ) return;
    setStarting(true);
    setActionError(null);
    void (async () => {
      let confirmedPreview = preview;
      if (!preview.workspaceTrusted) {
        try {
          await window.lumora.trustWorkspaceForLaunch(preview.launchToken);
          confirmedPreview = { ...preview, workspaceTrusted: true };
        } catch {
          setActionError('Workspace trust could not be saved.');
          setStarting(false);
          return;
        }
      }
      try {
        const recoveredRuntime = await window.lumora.startRuntime(
          preview.launchToken
        );
        onStarted(recoveredRuntime, confirmedPreview);
      } catch {
        setActionError('The recovered terminal could not be started.');
        setStarting(false);
        preflight.retry();
      }
    })();
  };

  return (
    <div className="dialog-backdrop" role="presentation">
      <section
        aria-labelledby="runtime-recovery-title"
        aria-modal="true"
        className="new-session-dialog"
        role="dialog"
      >
        <header>
          <div>
            <p className="card-label">Runtime recovery</p>
            <h2 id="runtime-recovery-title">Recover lost runtime</h2>
          </div>
          <button
            aria-label="Close runtime recovery"
            className="text-button"
            onClick={onClose}
            type="button"
          >
            Close
          </button>
        </header>

        <p className="card-description">
          Lumora cannot reattach the previous terminal. Recovery creates a new
          managed runtime and keeps the lost record as history.
        </p>

        <dl className="resume-session-details">
          <div><dt>Provider</dt><dd>{provider?.displayName ?? runtime.provider}</dd></div>
          <div><dt>Workspace</dt><dd>{workspace?.displayName ?? 'Unavailable'}</dd></div>
          <div><dt>Recovery action</dt><dd>{actionLabel}</dd></div>
        </dl>

        <div className="launch-fields resume-launch-fields">
          <label>
            <span>Terminal profile</span>
            <select
              onChange={(event) => setProfileId(event.currentTarget.value)}
              value={profileId}
            >
              <option value="">Configured default</option>
              {availableProfiles.map((profile) => (
                <option key={profile.id} value={profile.id}>{profile.name}</option>
              ))}
            </select>
          </label>
        </div>

        {blockingReason === null ? null : (
          <div className="catalog-operation-error" role="alert">{blockingReason}</div>
        )}
        {actionError === null ? null : (
          <div className="catalog-operation-error" role="alert">{actionError}</div>
        )}

        {preflight.status === 'preparing' ? (
          <div className="launch-empty" role="status"><p>Preparing recovery</p></div>
        ) : preflight.status === 'failed' ? (
          <div className="catalog-operation-error" role="alert">
            <span>The recovery preview could not be prepared.</span>{' '}
            <button className="text-button" onClick={retry} type="button">Retry</button>
          </div>
        ) : preview === null ? (
          <div className="launch-empty">
            <p>Recovery is not currently available.</p>
          </div>
        ) : (
          <>
            <LaunchDetails preview={preview} />
            {preview.workspaceTrusted || workspace === undefined ? null : (
              <WorkspaceTrustNotice
                confirmed={trustConfirmed}
                onConfirmedChange={setTrustConfirmed}
                workspace={workspace}
              />
            )}
          </>
        )}

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
            {starting ? 'Starting recovery' : actionLabel}
          </button>
        </footer>
      </section>
    </div>
  );
}
