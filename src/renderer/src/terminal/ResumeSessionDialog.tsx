import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import type {
  LaunchPrepareRequest,
  LaunchPreview,
  GeneralSettings,
  ProviderId,
  ProviderScanResult,
  RuntimeSummary,
  SessionSummary,
  TerminalProfile,
  WorkspaceSummary
} from '../../../shared/contracts';
import { SESSION_PROVIDER_IDS } from '../../../shared/provider-definitions';
import { LaunchDetails } from './LaunchDetails';
import { useLaunchPreflight } from './useLaunchPreflight';
import { WorkspaceTrustNotice } from './WorkspaceTrustNotice';

interface ResumeSessionDialogProps {
  session: SessionSummary;
  workspace: WorkspaceSummary;
  generalSettings: GeneralSettings;
  profiles: readonly TerminalProfile[];
  providerScan: ProviderScanResult | null;
  onClose(): void;
  onStarted(runtime: RuntimeSummary, preview: LaunchPreview): void;
}

export function ResumeSessionDialog({
  session,
  workspace,
  generalSettings,
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
  const availableDestinations = useMemo(() => {
    const supported = new Set<ProviderId>(SESSION_PROVIDER_IDS);
    const enabled = new Set(generalSettings.enabledProviders);
    return providerScan?.providers.filter(
      (installation) =>
        installation.state === 'ready' &&
        supported.has(installation.provider) &&
        enabled.has(installation.provider)
    ) ?? [];
  }, [generalSettings.enabledProviders, providerScan]);
  const [profileId, setProfileId] = useState('');
  const [destinationProvider, setDestinationProvider] = useState<ProviderId>(
    session.provider
  );
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
  }, [destinationProvider, profileId]);
  useEffect(() => {
    setDestinationProvider(session.provider);
  }, [session.id, session.provider]);
  useEffect(() => {
    if (!generalSettings.crossAgentWorkflowEnabled) {
      setDestinationProvider(session.provider);
    }
  }, [generalSettings.crossAgentWorkflowEnabled, session.provider]);
  useEffect(() => {
    if (
      profileId !== '' &&
      !availableProfiles.some((profile) => profile.id === profileId)
    ) {
      setProfileId('');
    }
  }, [availableProfiles, profileId]);

  const destination = availableDestinations.find(
    (installation) => installation.provider === destinationProvider
  );
  const isCrossAgent = destinationProvider !== session.provider;
  const canPrepare =
    availableProfiles.length > 0 &&
    (profileId === '' ||
      availableProfiles.some((profile) => profile.id === profileId)) &&
    workspace.available &&
    session.sourceFreshness === 'current' &&
    destination?.state === 'ready';
  const request = useMemo<LaunchPrepareRequest | null>(
    () => canPrepare
      ? {
          strategy: 'resume',
          sessionId: session.id,
          ...(isCrossAgent ? { provider: destinationProvider } : {}),
          terminalProfileId: profileId || null,
          cols: 100,
          rows: 30
        }
      : null,
    [canPrepare, destinationProvider, isCrossAgent, profileId, session.id]
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
        setActionError(
          isCrossAgent
            ? 'The cross-agent handoff could not be started.'
            : 'The provider session could not be resumed.'
        );
        finishLaunchOperation(operation);
        preflight.retry();
      }
    })();
  };

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
            <p className="card-label">
              {isCrossAgent ? 'Cross-agent handoff' : 'Native provider resume'}
            </p>
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
          {generalSettings.crossAgentWorkflowEnabled ? (
            <label>
              <span>Resume with provider</span>
              <select
                disabled={starting}
                onChange={(event) => setDestinationProvider(
                  event.currentTarget.value as ProviderId
                )}
                value={destinationProvider}
              >
                {availableDestinations.map((installation) => (
                  <option
                    key={installation.provider}
                    value={installation.provider}
                  >
                    {installation.displayName}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <label>
            <span>Terminal profile</span>
            <select
              disabled={starting}
              onChange={(event) => setProfileId(event.currentTarget.value)}
              value={profileId}
            >
              <option value="">Configured default</option>
              {availableProfiles.map((profile) => (
                <option key={profile.id} value={profile.id}>
                  {profile.name}
                </option>
              ))}
            </select>
          </label>
        </div>

        {isCrossAgent && destination !== undefined ? (
          <p className="handoff-explanation">
            This creates a new {destination.displayName} session. The original{' '}
            {provider?.displayName ?? session.provider} session remains unchanged.
          </p>
        ) : null}

        {actionError === null ? null : (
          <div className="catalog-operation-error" role="alert">{actionError}</div>
        )}

        {preflight.status === 'preparing' ? (
          <div className="launch-empty" role="status">
            <p>{isCrossAgent ? 'Preparing handoff' : 'Preparing resume'}</p>
          </div>
        ) : preflight.status === 'failed' ? (
          <div className="catalog-operation-error" role="alert">
            <span>The resume preview could not be prepared.</span>{' '}
            <button className="text-button" onClick={retry} type="button">Retry</button>
          </div>
        ) : preview === null ? (
          <div className="launch-empty">
            <p>The selected session is not currently available to resume.</p>
          </div>
        ) : (
          <>
            <LaunchDetails preview={preview} />
            {preview.workspaceTrusted ? null : (
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
            {starting
              ? isCrossAgent ? 'Starting handoff' : 'Resuming session'
              : isCrossAgent ? 'Start handoff' : 'Resume session'}
          </button>
        </footer>
      </section>
    </div>
  );
}
