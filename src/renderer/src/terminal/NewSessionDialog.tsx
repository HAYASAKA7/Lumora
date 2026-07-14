import { useEffect, useMemo, useState, type ReactNode } from 'react';

import type {
  LaunchPrepareRequest,
  LaunchPreview,
  ProviderId,
  ProviderScanResult,
  RuntimeSummary,
  TerminalProfile,
  WorkspaceSummary
} from '../../../shared/contracts';
import { LaunchDetails } from './LaunchDetails';
import { useLaunchPreflight } from './useLaunchPreflight';
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
  const [trustConfirmed, setTrustConfirmed] = useState(false);
  const [starting, setStarting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    setTrustConfirmed(false);
    setActionError(null);
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

  const canPrepare =
    workspaceId !== '' && availableProfiles.length > 0 && readyProviders.length > 0;
  const request = useMemo<LaunchPrepareRequest | null>(
    () => canPrepare
      ? {
          strategy: 'new',
          workspaceId,
          provider,
          terminalProfileId: profileId || null,
          cols: 100,
          rows: 30
        }
      : null,
    [canPrepare, profileId, provider, workspaceId]
  );
  const preflight = useLaunchPreflight(request);
  const preview = preflight.preview;
  const selectedWorkspace = availableWorkspaces.find(
    (workspace) => workspace.id === workspaceId
  );

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
        const runtime = await window.lumora.startRuntime(preview.launchToken);
        onStarted(runtime, confirmedPreview);
      } catch {
        setActionError('The provider terminal could not be started.');
        setStarting(false);
        preflight.retry();
      }
    })();
  };

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

        {actionError === null ? null : (
          <div className="catalog-operation-error" role="alert">{actionError}</div>
        )}

        {preflight.status === 'preparing' ? (
          <div className="launch-empty" role="status"><p>Preparing launch</p></div>
        ) : preflight.status === 'failed' ? (
          <div className="catalog-operation-error" role="alert">
            <span>The launch preview could not be prepared.</span>{' '}
            <button className="text-button" onClick={retry} type="button">Retry</button>
          </div>
        ) : preview === null ? (
          <div className="launch-empty">
            <p>Select an available workspace, provider, and terminal profile.</p>
          </div>
        ) : (
          <>
            <LaunchDetails preview={preview} />
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
            {starting ? 'Starting terminal' : 'Start session'}
          </button>
        </footer>
      </section>
    </div>
  );
}
