import { useEffect, useMemo, useState, type ReactNode } from 'react';

import type {
  LaunchPreview,
  ProviderScanResult,
  RuntimeSummary,
  SessionSummary,
  TerminalProfile,
  WorkspaceSummary
} from '../../../shared/contracts';

interface ResumeSessionDialogProps {
  session: SessionSummary;
  workspace: WorkspaceSummary;
  profiles: readonly TerminalProfile[];
  providerScan: ProviderScanResult | null;
  onClose(): void;
  onStarted(runtime: RuntimeSummary, preview: LaunchPreview): void;
}

export function ResumeSessionDialog({
  session,
  workspace,
  profiles,
  providerScan,
  onClose,
  onStarted
}: ResumeSessionDialogProps): ReactNode {
  const availableProfiles = useMemo(
    () => profiles.filter((profile) => profile.available),
    [profiles]
  );
  const provider = providerScan?.providers.find(
    (installation) => installation.provider === session.provider
  );
  const [profileId, setProfileId] = useState(
    availableProfiles.find((profile) => profile.recommended)?.id ??
      availableProfiles[0]?.id ??
      ''
  );
  const [preview, setPreview] = useState<LaunchPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => setPreview(null), [profileId]);
  useEffect(() => {
    if (!availableProfiles.some((profile) => profile.id === profileId)) {
      setProfileId(
        availableProfiles.find((profile) => profile.recommended)?.id ??
          availableProfiles[0]?.id ??
          ''
      );
    }
  }, [availableProfiles, profileId]);

  const prepare = () => {
    setBusy(true);
    setError(null);
    void window.lumora
      .prepareLaunch({
        strategy: 'resume',
        sessionId: session.id,
        terminalProfileId: profileId,
        cols: 100,
        rows: 30
      })
      .then(
        (value) => {
          setPreview(value);
          setBusy(false);
        },
        () => {
          setError('The resume preview could not be prepared.');
          setBusy(false);
        }
      );
  };

  const start = () => {
    if (preview === null) return;
    setBusy(true);
    setError(null);
    void window.lumora.startRuntime(preview.launchToken).then(
      (runtime) => onStarted(runtime, preview),
      () => {
        setError('The provider session could not be resumed.');
        setBusy(false);
      }
    );
  };

  const canPrepare =
    profileId !== '' &&
    workspace.available &&
    session.sourceFreshness === 'current' &&
    provider?.state === 'ready';

  return (
    <div className="dialog-backdrop" role="presentation">
      <section
        aria-labelledby="resume-session-title"
        aria-modal="true"
        className="new-session-dialog"
        role="dialog"
      >
        <header>
          <div>
            <p className="card-label">Native provider resume</p>
            <h2 id="resume-session-title">Resume session</h2>
          </div>
          <button
            aria-label="Close resume session"
            className="text-button"
            onClick={onClose}
            type="button"
          >
            Close
          </button>
        </header>

        <dl className="resume-session-details">
          <div>
            <dt>Session</dt>
            <dd>{session.title}</dd>
          </div>
          <div>
            <dt>Provider</dt>
            <dd>{provider?.displayName ?? session.provider}</dd>
          </div>
          <div>
            <dt>Workspace</dt>
            <dd>
              <strong>{workspace.displayName}</strong>
              <span>{workspace.canonicalPath}</span>
            </dd>
          </div>
        </dl>

        <div className="launch-fields resume-launch-fields">
          <label>
            <span>Terminal profile</span>
            <select
              onChange={(event) => setProfileId(event.currentTarget.value)}
              value={profileId}
            >
              {availableProfiles.map((profile) => (
                <option key={profile.id} value={profile.id}>
                  {profile.name}
                </option>
              ))}
            </select>
          </label>
        </div>

        {error === null ? null : (
          <div className="catalog-operation-error" role="alert">
            {error}
          </div>
        )}

        {preview === null ? (
          <div className="launch-empty">
            <p>
              Prepare to verify the native session arguments, executable,
              working directory, and terminal profile.
            </p>
          </div>
        ) : (
          <dl className="launch-preview">
            {preview.command === null ? null : (
              <div>
                <dt>Start command</dt>
                <dd>{preview.command}</dd>
              </div>
            )}
            <div>
              <dt>Executable</dt>
              <dd>{preview.executablePath}</dd>
            </div>
            <div>
              <dt>Arguments</dt>
              <dd>{preview.args.join(' ')}</dd>
            </div>
            <div>
              <dt>Working directory</dt>
              <dd>{preview.workingDirectory}</dd>
            </div>
            <div>
              <dt>Environment names</dt>
              <dd>{preview.environmentNames.join(', ')}</dd>
            </div>
            <div>
              <dt>Profile</dt>
              <dd>{preview.terminalProfile.name}</dd>
            </div>
          </dl>
        )}

        <footer>
          <button
            className="secondary-button"
            disabled={!canPrepare || busy}
            onClick={prepare}
            type="button"
          >
            {busy && preview === null ? 'Preparing' : 'Prepare launch'}
          </button>
          <button
            className="refresh-button"
            disabled={preview === null || busy}
            onClick={start}
            type="button"
          >
            {busy && preview !== null ? 'Resuming session' : 'Resume session'}
          </button>
        </footer>
      </section>
    </div>
  );
}
