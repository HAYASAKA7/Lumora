import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import type {
  LaunchPrepareRequest,
  LaunchPreview,
  ProviderId,
  ProviderScanResult,
  RuntimeSummary,
  TerminalProfile,
  WorkspaceSummary
} from '../../../shared/contracts';
import { hasVerifiedStartPromptSupport } from '../../../shared/provider-definitions';
import { LaunchReadiness } from './LaunchReadiness';
import { useLaunchPreflight } from './useLaunchPreflight';

interface NewSessionDialogProps {
  initialWorkspaceId?: string | null;
  workspaces: readonly WorkspaceSummary[];
  profiles: readonly TerminalProfile[];
  providerScan: ProviderScanResult | null;
  onClose(): void;
  onStarted(runtime: RuntimeSummary, preview: LaunchPreview): void;
}

export function NewSessionDialog({
  initialWorkspaceId = null,
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
  const initialWorkspace = availableWorkspaces.find(
    (workspace) => workspace.id === initialWorkspaceId
  );
  const [workspaceId, setWorkspaceId] = useState(
    initialWorkspace?.id ?? availableWorkspaces[0]?.id ?? ''
  );
  const [provider, setProvider] = useState<ProviderId>(
    readyProviders[0]?.provider ?? 'codex'
  );
  const [profileId, setProfileId] = useState('');
  const [startPrompt, setStartPrompt] = useState('');
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
  }, [workspaceId, provider, profileId, startPrompt]);
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
    if (!hasVerifiedStartPromptSupport(provider)) setStartPrompt('');
  }, [provider]);
  useEffect(() => {
    if (!readyProviders.some((installation) => installation.provider === provider)) {
      setProvider(readyProviders[0]?.provider ?? 'codex');
    }
  }, [provider, readyProviders]);

  const selectedWorkspace = availableWorkspaces.find(
    (workspace) => workspace.id === workspaceId
  );
  const supportsStartPrompt = hasVerifiedStartPromptSupport(provider);
  const selectedProviderReady = readyProviders.some(
    (installation) => installation.provider === provider
  );
  const selectedProfileAvailable =
    profileId === '' ||
    availableProfiles.some((profile) => profile.id === profileId);
  const canPrepare =
    selectedWorkspace !== undefined &&
    selectedProviderReady &&
    availableProfiles.length > 0 &&
    selectedProfileAvailable;
  const request = useMemo<LaunchPrepareRequest | null>(
    () => canPrepare
      ? {
          strategy: 'new',
          workspaceId,
          provider,
          startPrompt: supportsStartPrompt ? startPrompt : '',
          terminalProfileId: profileId || null,
          cols: 100,
          rows: 30
        }
      : null,
    [canPrepare, profileId, provider, startPrompt, supportsStartPrompt, workspaceId]
  );
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
          setActionError('Workspace trust could not be saved.');
          finishLaunchOperation(operation);
          return;
        }
        if (!preflight.isCurrentLaunchToken(preview.launchToken)) {
          finishLaunchOperation(operation);
          return;
        }
      }
      try {
        const runtime = await window.lumora.startRuntime(preview.launchToken);
        finishLaunchOperation(operation);
        onStarted(runtime, confirmedPreview);
      } catch {
        if (!preflight.isCurrentLaunchToken(preview.launchToken)) {
          finishLaunchOperation(operation);
          return;
        }
        setActionError('The provider terminal could not be started.');
        finishLaunchOperation(operation);
        preflight.retry();
      }
    })();
  };

  return (
    <div className="dialog-backdrop" role="presentation">
      <section
        aria-labelledby="new-session-title"
        aria-modal="true"
        className="new-session-dialog new-session-launch-dialog"
        role="dialog"
      >
        <header>
          <div>
            <p className="card-label">Native provider launch</p>
            <h2 id="new-session-title">New session</h2>
          </div>
          <button aria-label="Close new session" className="text-button" onClick={onClose} type="button">Close</button>
        </header>

        <div className="dialog-body">
        <div className="launch-fields">
          <label>
            <span>Workspace</span>
            <select disabled={starting} onChange={(event) => setWorkspaceId(event.currentTarget.value)} value={workspaceId}>
              {availableWorkspaces.map((workspace) => (
                <option key={workspace.id} value={workspace.id}>{workspace.displayName}</option>
              ))}
            </select>
          </label>
          <label>
            <span>Provider</span>
            <select disabled={starting} onChange={(event) => setProvider(event.currentTarget.value as ProviderId)} value={provider}>
              {readyProviders.map((installation) => (
                <option key={installation.provider} value={installation.provider}>{installation.displayName}</option>
              ))}
            </select>
          </label>
          <label>
            <span>Terminal profile</span>
            <select disabled={starting} onChange={(event) => setProfileId(event.currentTarget.value)} value={profileId}>
              <option value="">Configured default</option>
              {availableProfiles.map((profile) => (
                <option key={profile.id} value={profile.id}>{profile.name}</option>
              ))}
            </select>
          </label>
          {supportsStartPrompt ? (
            <label className="new-session-start-prompt">
              <span>Start prompt (optional)</span>
              <input
                disabled={starting}
                maxLength={4_096}
                onChange={(event) => setStartPrompt(event.currentTarget.value)}
                placeholder="Describe the first task, or leave empty"
                type="text"
                value={startPrompt}
              />
            </label>
          ) : null}
        </div>

        <LaunchReadiness
          actionError={actionError}
          emptyMessage="Select an available workspace, provider, and terminal profile."
          failureMessage="The launch preview could not be prepared."
          onRetry={retry}
          onTrustConfirmedChange={setTrustConfirmed}
          preparingMessage="Preparing launch"
          preview={preview}
          status={preflight.status}
          trustConfirmed={trustConfirmed}
          workspace={selectedWorkspace}
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
            {starting ? 'Starting terminal' : 'Start session'}
          </button>
        </footer>
      </section>
    </div>
  );
}
