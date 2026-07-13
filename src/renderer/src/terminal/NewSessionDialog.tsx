import { useEffect, useMemo, useState, type ReactNode } from 'react';

import type {
  LaunchPreview,
  ProviderId,
  ProviderScanResult,
  RuntimeSummary,
  TerminalProfile,
  WorkspaceSummary
} from '../../../shared/contracts';
import { LaunchConfiguration } from './LaunchConfiguration';
import { WorkspaceTrustNotice } from './WorkspaceTrustNotice';

interface NewSessionDialogProps {
  workspaces: readonly WorkspaceSummary[];
  profiles: readonly TerminalProfile[];
  providerScan: ProviderScanResult | null;
  onClose(): void;
  onStarted(runtime: RuntimeSummary, preview: LaunchPreview): void;
}

export function NewSessionDialog({
  workspaces,
  profiles,
  providerScan,
  onClose,
  onStarted
}: NewSessionDialogProps): ReactNode {
  const availableWorkspaces = useMemo(
    () => workspaces.filter((workspace) => workspace.available),
    [workspaces]
  );
  const availableProfiles = useMemo(
    () => profiles.filter((profile) => profile.available),
    [profiles]
  );
  const readyProviders = useMemo(
    () => providerScan?.providers.filter((provider) => provider.state === 'ready') ?? [],
    [providerScan]
  );
  const [workspaceId, setWorkspaceId] = useState(availableWorkspaces[0]?.id ?? '');
  const [provider, setProvider] = useState<ProviderId>(
    readyProviders[0]?.provider ?? 'codex'
  );
  const [profileId, setProfileId] = useState('');
  const [preview, setPreview] = useState<LaunchPreview | null>(null);
  const [trustConfirmed, setTrustConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setPreview(null);
    setTrustConfirmed(false);
  }, [workspaceId, provider, profileId]);
  useEffect(() => {
    if (!availableWorkspaces.some((workspace) => workspace.id === workspaceId)) {
      setWorkspaceId(availableWorkspaces[0]?.id ?? '');
    }
  }, [availableWorkspaces, workspaceId]);
  useEffect(() => {
    if (
      profileId !== '' &&
      !availableProfiles.some((profile) => profile.id === profileId)
    ) {
      setProfileId('');
    }
  }, [availableProfiles, profileId]);
  useEffect(() => {
    if (!readyProviders.some((installation) => installation.provider === provider)) {
      setProvider(readyProviders[0]?.provider ?? 'codex');
    }
  }, [provider, readyProviders]);

  const prepare = () => {
    setBusy(true);
    setError(null);
    setTrustConfirmed(false);
    void window.lumora.prepareLaunch({
      strategy: 'new',
      workspaceId,
      provider,
      terminalProfileId: profileId || null,
      cols: 100,
      rows: 30
    }).then(
      (value) => { setPreview(value); setTrustConfirmed(false); setBusy(false); },
      () => { setError('The launch preview could not be prepared.'); setBusy(false); }
    );
  };

  const start = () => {
    if (
      preview === null ||
      (!preview.workspaceTrusted && !trustConfirmed)
    ) return;
    setBusy(true);
    setError(null);
    void (async () => {
      let confirmedPreview = preview;
      if (!preview.workspaceTrusted) {
        try {
          await window.lumora.trustWorkspaceForLaunch(preview.launchToken);
          confirmedPreview = { ...preview, workspaceTrusted: true };
          setPreview(confirmedPreview);
        } catch {
          setError('Workspace trust could not be saved.');
          setBusy(false);
          return;
        }
      }
      try {
        const runtime = await window.lumora.startRuntime(preview.launchToken);
        onStarted(runtime, confirmedPreview);
      } catch {
        setError('The provider terminal could not be started.');
        setBusy(false);
      }
    })();
  };

  const canPrepare =
    workspaceId !== '' && availableProfiles.length > 0 && readyProviders.length > 0;
  const selectedWorkspace = availableWorkspaces.find(
    (workspace) => workspace.id === workspaceId
  );

  return (
    <div className="dialog-backdrop" role="presentation">
      <section
        aria-labelledby="new-session-title"
        aria-modal="true"
        className="new-session-dialog"
        role="dialog"
      >
        <header>
          <div>
            <p className="card-label">Native provider launch</p>
            <h2 id="new-session-title">New session</h2>
          </div>
          <button aria-label="Close new session" className="text-button" onClick={onClose} type="button">Close</button>
        </header>

        <div className="launch-fields">
          <label>
            <span>Workspace</span>
            <select onChange={(event) => setWorkspaceId(event.currentTarget.value)} value={workspaceId}>
              {availableWorkspaces.map((workspace) => (
                <option key={workspace.id} value={workspace.id}>{workspace.displayName}</option>
              ))}
            </select>
          </label>
          <label>
            <span>Provider</span>
            <select onChange={(event) => setProvider(event.currentTarget.value as ProviderId)} value={provider}>
              {readyProviders.map((installation) => (
                <option key={installation.provider} value={installation.provider}>{installation.displayName}</option>
              ))}
            </select>
          </label>
          <label>
            <span>Terminal profile</span>
            <select onChange={(event) => setProfileId(event.currentTarget.value)} value={profileId}>
              <option value="">Configured default</option>
              {availableProfiles.map((profile) => (
                <option key={profile.id} value={profile.id}>{profile.name}</option>
              ))}
            </select>
          </label>
        </div>

        {error === null ? null : <div className="catalog-operation-error" role="alert">{error}</div>}

        {preview === null ? (
          <div className="launch-empty">
            <p>Prepare to resolve the exact executable, arguments, working directory, and environment names.</p>
          </div>
        ) : (
          <>
            <LaunchConfiguration preview={preview} />
            <dl className="launch-preview">
              <div><dt>Executable</dt><dd>{preview.executablePath}</dd></div>
              <div><dt>Arguments</dt><dd>{preview.args.length === 0 ? 'None' : preview.args.join(' ')}</dd></div>
              <div><dt>Working directory</dt><dd>{preview.workingDirectory}</dd></div>
              <div><dt>Environment names</dt><dd>{preview.environmentNames.join(', ')}</dd></div>
            </dl>
            {preview.workspaceTrusted || selectedWorkspace === undefined ? null : (
              <WorkspaceTrustNotice
                confirmed={trustConfirmed}
                onConfirmedChange={setTrustConfirmed}
                workspace={selectedWorkspace}
              />
            )}
          </>
        )}

        <footer>
          <button className="secondary-button" disabled={!canPrepare || busy} onClick={prepare} type="button">
            {busy && preview === null ? 'Preparing' : 'Prepare launch'}
          </button>
          <button className="refresh-button" disabled={preview === null || busy || (!preview.workspaceTrusted && !trustConfirmed)} onClick={start} type="button">
            {busy && preview !== null ? 'Starting terminal' : 'Start session'}
          </button>
        </footer>
      </section>
    </div>
  );
}
