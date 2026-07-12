import { useEffect, useMemo, useState, type ReactNode } from 'react';

import type {
  LaunchPreview,
  ProviderScanResult,
  RuntimeSummary,
  SessionSummary,
  TerminalProfile,
  WorkspaceSummary
} from '../../../shared/contracts';
import { resolveRuntimeRecovery } from './runtime-recovery';

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
  const initialProfileId =
    availableProfiles.find(
      (profile) => profile.id === runtime.terminalProfileId
    )?.id ??
    availableProfiles.find((profile) => profile.recommended)?.id ??
    availableProfiles[0]?.id ??
    '';
  const [profileId, setProfileId] = useState(initialProfileId);
  const [preview, setPreview] = useState<LaunchPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => setPreview(null), [profileId]);
  useEffect(() => {
    if (!availableProfiles.some((profile) => profile.id === profileId)) {
      setProfileId(
        availableProfiles.find(
          (profile) => profile.id === runtime.terminalProfileId
        )?.id ??
          availableProfiles.find((profile) => profile.recommended)?.id ??
          availableProfiles[0]?.id ??
          ''
      );
    }
  }, [availableProfiles, profileId, runtime.terminalProfileId]);

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
          : profileId === ''
            ? 'No terminal profile is available.'
            : null;

  const prepare = () => {
    if (plan === null || blockingReason !== null) return;
    setBusy(true);
    setError(null);
    const request =
      plan.strategy === 'resume'
        ? {
            strategy: 'resume' as const,
            sessionId: plan.session.id,
            terminalProfileId: profileId,
            cols: 100,
            rows: 30
          }
        : {
            strategy: 'new' as const,
            provider: plan.provider,
            workspaceId: plan.workspaceId,
            terminalProfileId: profileId,
            cols: 100,
            rows: 30
          };
    void window.lumora.prepareLaunch(request).then(
      (value) => {
        setPreview(value);
        setBusy(false);
      },
      () => {
        setError('The recovery preview could not be prepared.');
        setBusy(false);
      }
    );
  };

  const start = () => {
    if (preview === null) return;
    setBusy(true);
    setError(null);
    void window.lumora.startRuntime(preview.launchToken).then(
      (value) => onStarted(value, preview),
      () => {
        setError('The recovered terminal could not be started.');
        setBusy(false);
      }
    );
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
              {availableProfiles.map((profile) => (
                <option key={profile.id} value={profile.id}>{profile.name}</option>
              ))}
            </select>
          </label>
        </div>

        {blockingReason === null ? null : (
          <div className="catalog-operation-error" role="alert">{blockingReason}</div>
        )}
        {error === null ? null : (
          <div className="catalog-operation-error" role="alert">{error}</div>
        )}

        {preview === null ? (
          <div className="launch-empty">
            <p>Prepare recovery to verify the exact executable, start command, working directory, and terminal profile.</p>
          </div>
        ) : (
          <dl className="launch-preview">
            {preview.command === null ? null : (
              <div><dt>Start command</dt><dd>{preview.command}</dd></div>
            )}
            <div><dt>Executable</dt><dd>{preview.executablePath}</dd></div>
            <div><dt>Arguments</dt><dd>{preview.args.length === 0 ? 'None' : preview.args.join(' ')}</dd></div>
            <div><dt>Working directory</dt><dd>{preview.workingDirectory}</dd></div>
            <div><dt>Environment names</dt><dd>{preview.environmentNames.join(', ')}</dd></div>
            <div><dt>Profile</dt><dd>{preview.terminalProfile.name}</dd></div>
          </dl>
        )}

        <footer>
          <button
            className="secondary-button"
            disabled={blockingReason !== null || busy}
            onClick={prepare}
            type="button"
          >
            {busy && preview === null ? 'Preparing recovery' : 'Prepare recovery'}
          </button>
          <button
            className="refresh-button"
            disabled={preview === null || busy}
            onClick={start}
            type="button"
          >
            {busy && preview !== null ? 'Starting recovery' : actionLabel}
          </button>
        </footer>
      </section>
    </div>
  );
}
