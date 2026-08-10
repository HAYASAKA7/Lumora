import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import type {
  LaunchPrepareRequest,
  LaunchPreview,
  GeneralSettings,
  LumoraApi,
  ProviderId,
  ProviderScanResult,
  RuntimeSummary,
  SessionSummary,
  TerminalProfile,
  WorkspaceSummary
} from '../../../shared/contracts';
import {
  SESSION_PROVIDER_IDS,
  hasNativeForkSupport,
  hasVerifiedStartPromptSupport,
  supportsNativeForkVersion
} from '../../../shared/provider-definitions';
import { LaunchReadiness } from './LaunchReadiness';
import { useLaunchPreflight } from './useLaunchPreflight';

interface ResumeSessionDialogProps {
  api?: LumoraApi;
  session: SessionSummary;
  workspace: WorkspaceSummary;
  generalSettings: GeneralSettings;
  profiles: readonly TerminalProfile[];
  providerScan: ProviderScanResult | null;
  sourceSessionActive?: boolean;
  onClose(): void;
  onStarted(runtime: RuntimeSummary, preview: LaunchPreview): void;
}

export function ResumeSessionDialog({
  api = window.lumora,
  session,
  workspace,
  generalSettings,
  profiles,
  providerScan,
  sourceSessionActive = false,
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
  const [continuation, setContinuation] = useState<'resume' | 'new'>('resume');
  const [startPrompt, setStartPrompt] = useState('');
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
  }, [continuation, destinationProvider, profileId, startPrompt]);
  useEffect(() => {
    setDestinationProvider(session.provider);
    setContinuation('resume');
    setStartPrompt('');
  }, [session.id, session.provider]);
  useEffect(() => {
    if (!hasVerifiedStartPromptSupport(
      continuation === 'resume' ? session.provider : destinationProvider
    )) {
      setStartPrompt('');
    }
  }, [continuation, destinationProvider, session.provider]);
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

  const newSessionDestinations = availableDestinations.filter(
    (installation) =>
      installation.provider === session.provider
        ? hasNativeForkSupport(session.provider) &&
          supportsNativeForkVersion(session.provider, installation.version)
        : generalSettings.crossAgentWorkflowEnabled
  );
  const newSessionDestinationKey = newSessionDestinations
    .map((installation) => installation.provider)
    .join(',');
  useEffect(() => {
    if (
      continuation === 'new' &&
      !newSessionDestinations.some(
        (installation) => installation.provider === destinationProvider
      )
    ) {
      const fallback = newSessionDestinations[0]?.provider;
      if (fallback !== undefined) setDestinationProvider(fallback);
    }
  }, [continuation, destinationProvider, newSessionDestinationKey]);
  const destination = newSessionDestinations.find(
    (installation) => installation.provider === destinationProvider
  );
  const canStartNewSession = newSessionDestinations.length > 0;
  const isNativeFork =
    continuation === 'new' && destinationProvider === session.provider;
  const isCrossAgent =
    continuation === 'new' && destinationProvider !== session.provider;
  const promptProvider =
    continuation === 'resume' ? session.provider : destinationProvider;
  const supportsStartPrompt = hasVerifiedStartPromptSupport(promptProvider);
  const validStartPrompt =
    startPrompt.length <= 4_096 &&
    !/[\0\r\n]/.test(startPrompt);
  const canPrepare =
    availableProfiles.length > 0 &&
    (profileId === '' ||
      availableProfiles.some((profile) => profile.id === profileId)) &&
    workspace.available &&
    session.sourceFreshness === 'current' &&
    (continuation === 'resume'
      ? provider?.state === 'ready'
      : destination?.state === 'ready') &&
    (!supportsStartPrompt || validStartPrompt);
  const request = useMemo<LaunchPrepareRequest | null>(
    () => canPrepare
      ? continuation === 'resume'
        ? {
            strategy: 'resume',
            sessionId: session.id,
            startPrompt: supportsStartPrompt ? startPrompt : '',
            terminalProfileId: profileId || null,
            cols: 100,
            rows: 30
          }
        : isNativeFork
          ? {
              strategy: 'fork',
              sessionId: session.id,
              startPrompt: supportsStartPrompt ? startPrompt : '',
              terminalProfileId: profileId || null,
              cols: 100,
              rows: 30
            }
          : {
              strategy: 'resume',
              sessionId: session.id,
              provider: destinationProvider,
              startPrompt: supportsStartPrompt ? startPrompt : '',
              terminalProfileId: profileId || null,
              cols: 100,
              rows: 30
            }
      : null,
    [
      canPrepare,
      continuation,
      destinationProvider,
      isNativeFork,
      profileId,
      session.id,
      startPrompt,
      supportsStartPrompt
    ]
  );
  const preflight = useLaunchPreflight(request, api);
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
          await api.trustWorkspaceForLaunch(preview.launchToken);
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
        const runtime = await api.startRuntime(preview.launchToken);
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
            : isNativeFork
              ? 'The native session fork could not be started.'
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
        className="new-session-dialog resume-session-dialog"
        role="dialog"
      >
        <header>
          <div>
            <p className="card-label">
              {isCrossAgent
                ? 'Cross-agent handoff'
                : isNativeFork
                  ? 'Native provider fork'
                  : 'Native provider resume'}
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

        <div className="dialog-body">
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

        <section
          aria-label={
            continuation === 'new'
              ? 'New session configuration'
              : 'Session continuation'
          }
          className="resume-workflow-stage"
        >
        {canStartNewSession && continuation === 'resume' ? (
          <fieldset className="continuation-options">
            <legend>Continuation</legend>
            <label>
              <input
                checked={continuation === 'resume'}
                disabled={starting}
                name="session-continuation"
                onChange={() => setContinuation('resume')}
                type="radio"
              />
              <span>Resume original session</span>
            </label>
            <label>
              <input
                checked={false}
                disabled={starting}
                name="session-continuation"
                onChange={() => setContinuation('new')}
                type="radio"
              />
              <span>Start a new session from this context</span>
            </label>
          </fieldset>
        ) : null}

        <div className="launch-fields resume-launch-fields">
          {continuation === 'new' && newSessionDestinations.length > 1 ? (
            <label>
              <span>Start with provider</span>
              <select
                disabled={starting}
                onChange={(event) => setDestinationProvider(
                  event.currentTarget.value as ProviderId
                )}
                value={destinationProvider}
              >
                {newSessionDestinations.map((installation) => (
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
          {supportsStartPrompt ? (
            <label>
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

        {isNativeFork ? (
          <p className="handoff-explanation">
            This creates a new native {provider?.displayName ?? session.provider}{' '}
            session. The original session remains unchanged.
          </p>
        ) : null}

        {isNativeFork && sourceSessionActive ? (
          <p className="handoff-explanation active-source-warning">
            The source session is active. Both sessions use the same workspace,
            so concurrent file edits may conflict.
          </p>
        ) : null}

        {isCrossAgent && destination !== undefined ? (
          <p className="handoff-explanation">
            This creates a new {destination.displayName} session. The original{' '}
            {provider?.displayName ?? session.provider} session remains unchanged.
          </p>
        ) : null}

        <LaunchReadiness
          actionError={actionError}
          emptyMessage={
            supportsStartPrompt && !validStartPrompt
              ? 'The start prompt must be a single line.'
              : isCrossAgent
                ? 'The selected session is not currently available to hand off.'
                : isNativeFork
                  ? 'The selected session is not currently available to fork.'
                  : 'The selected session is not currently available to resume.'
          }
          failureMessage={
            isCrossAgent
              ? 'The handoff preview could not be prepared.'
              : isNativeFork
                ? 'The fork preview could not be prepared.'
                : 'The resume preview could not be prepared.'
          }
          onRetry={retry}
          onTrustConfirmedChange={setTrustConfirmed}
          preparingMessage={
            isCrossAgent
              ? 'Preparing handoff'
              : isNativeFork
                ? 'Preparing fork'
                : 'Preparing resume'
          }
          preview={preview}
          status={preflight.status}
          trustConfirmed={trustConfirmed}
          workspace={workspace}
        />
        </section>
        </div>

        <footer>
          {continuation === 'new' ? (
            <button
              className="text-button"
              disabled={starting}
              onClick={() => setContinuation('resume')}
              type="button"
            >
              Back to resume
            </button>
          ) : null}
          <button
            className={`refresh-button launch-action-button${
              preflight.status === 'preparing' || starting
                ? ' is-pending'
                : ''
            }`}
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
              ? isCrossAgent
                ? 'Starting handoff'
                : isNativeFork
                  ? 'Starting fork'
                  : 'Resuming session'
              : isCrossAgent
                ? 'Start handoff'
                : isNativeFork
                  ? 'Fork session'
                  : 'Resume session'}
          </button>
        </footer>
      </section>
    </div>
  );
}
