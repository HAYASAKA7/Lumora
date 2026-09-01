import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import type {
  AgentRuntimeStartResult,
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
  hasSessionHandoffDestinationSupport,
  hasVerifiedStartPromptSupport,
  supportsNativeForkVersion
} from '../../../shared/provider-definitions';
import { SelectMenu } from '../ui/SelectMenu';
import { LaunchReadiness } from './LaunchReadiness';
import { useLaunchPreflight } from './useLaunchPreflight';
import { useLocalization } from '../localization/useLocalization';

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
  onAgentStarted?(
    result: AgentRuntimeStartResult,
    preview: LaunchPreview
  ): void;
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
  onStarted,
  onAgentStarted
}: ResumeSessionDialogProps): ReactNode {
  const { t } = useLocalization();
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
        : generalSettings.crossAgentWorkflowEnabled &&
          hasSessionHandoffDestinationSupport(installation.provider)
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
  const trustApproved =
    generalSettings.autoTrustWorkspaces || trustConfirmed;

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
      (!preview.workspaceTrusted && !trustApproved)
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
          setActionError(t('terminal.resume.trust-save-failed'));
          finishLaunchOperation(operation);
          return;
        }
        if (!preflight.isCurrentLaunchToken(preview.launchToken)) {
          finishLaunchOperation(operation);
          return;
        }
      }
      try {
        if (onAgentStarted !== undefined) {
          const result = await api.startAgentRuntime(
            preview.launchToken,
            globalThis.crypto.randomUUID()
          );
          finishLaunchOperation(operation);
          onAgentStarted(result, confirmedPreview);
          return;
        }
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
            ? t('terminal.resume.handoff-start-failed')
            : isNativeFork
              ? t('terminal.resume.fork-start-failed')
              : t('terminal.resume.start-failed')
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
                ? t('terminal.resume.handoff-label')
                : isNativeFork
                  ? t('terminal.resume.fork-label')
                  : t('terminal.resume.native-label')}
            </p>
            <h2 id="resume-session-title">{t('terminal.actions.resume-session')}</h2>
          </div>
          <button
            aria-label={t('terminal.resume.close-label')}
            className="text-button"
            onClick={onClose}
            type="button"
          >
            {t('common.actions.close')}
          </button>
        </header>

        <div className="dialog-body">
        <dl className="resume-session-details">
          <div>
            <dt>{t('terminal.resume.session')}</dt>
            <dd>{session.title}</dd>
          </div>
          <div>
            <dt>{t('terminal.new.provider')}</dt>
            <dd>{provider?.displayName ?? session.provider}</dd>
          </div>
          <div>
            <dt>{t('terminal.resume.workspace')}</dt>
            <dd>
              <strong>{workspace.displayName}</strong>
              <span>{workspace.canonicalPath}</span>
            </dd>
          </div>
        </dl>

        <section
          aria-label={
            continuation === 'new'
              ? t('terminal.resume.new-configuration-label')
              : t('terminal.resume.continuation-label')
          }
          className="resume-workflow-stage"
        >
        {canStartNewSession && continuation === 'resume' ? (
          <fieldset className="continuation-options">
            <legend>{t('terminal.resume.continuation')}</legend>
            <label>
              <input
                checked={continuation === 'resume'}
                disabled={starting}
                name="session-continuation"
                onChange={() => setContinuation('resume')}
                type="radio"
              />
              <span>{t('terminal.resume.original')}</span>
            </label>
            <label>
              <input
                checked={false}
                disabled={starting}
                name="session-continuation"
                onChange={() => setContinuation('new')}
                type="radio"
              />
              <span>{t('terminal.resume.new-from-context')}</span>
            </label>
          </fieldset>
        ) : null}

        <div className="launch-fields resume-launch-fields">
          {continuation === 'new' && newSessionDestinations.length > 1 ? (
            <div className="select-field">
              <span>{t('terminal.resume.start-provider')}</span>
              <SelectMenu
                disabled={starting}
                label={t('terminal.resume.start-provider')}
                onChange={(value) => setDestinationProvider(value as ProviderId)}
                options={newSessionDestinations.map((installation) => ({
                  value: installation.provider,
                  label: installation.displayName
                }))}
                value={destinationProvider}
              />
            </div>
          ) : null}
          {supportsStartPrompt ? (
            <label>
              <span>{t('terminal.new.task-prompt')}</span>
              <input
                disabled={starting}
                maxLength={4_096}
                onChange={(event) => setStartPrompt(event.currentTarget.value)}
                placeholder={t('terminal.new.task-prompt-placeholder')}
                type="text"
                value={startPrompt}
              />
            </label>
          ) : null}
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

        {isNativeFork ? (
          <p className="handoff-explanation">
            {t('terminal.resume.fork-description', {
              provider: provider?.displayName ?? session.provider
            })}
          </p>
        ) : null}

        {isNativeFork && sourceSessionActive ? (
          <p className="handoff-explanation active-source-warning">
            {t('terminal.resume.active-source-warning')}
          </p>
        ) : null}

        {isCrossAgent && destination !== undefined ? (
          <p className="handoff-explanation">
            {t('terminal.resume.handoff-provider-description', {
              destination: destination.displayName,
              source: provider?.displayName ?? session.provider
            })}
          </p>
        ) : null}

        <LaunchReadiness
          actionError={actionError}
          emptyMessage={
            supportsStartPrompt && !validStartPrompt
              ? t('terminal.resume.single-line-prompt')
              : isCrossAgent
                ? t('terminal.resume.handoff-unavailable')
                : isNativeFork
                  ? t('terminal.resume.fork-unavailable')
                  : t('terminal.resume.unavailable')
          }
          failureMessage={
            isCrossAgent
              ? t('terminal.resume.handoff-preview-failed')
              : isNativeFork
                ? t('terminal.resume.fork-preview-failed')
                : t('terminal.resume.preview-failed')
          }
          onRetry={retry}
          onTrustConfirmedChange={setTrustConfirmed}
          preparingMessage={
            isCrossAgent
              ? t('terminal.resume.preparing-handoff')
              : isNativeFork
                ? t('terminal.resume.preparing-fork')
                : t('terminal.resume.preparing')
          }
          preview={preview}
          status={preflight.status}
          trustConfirmed={trustConfirmed}
          trustImplicit={generalSettings.autoTrustWorkspaces}
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
              {t('terminal.actions.back-to-resume')}
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
              (!preview.workspaceTrusted && !trustApproved)
            }
            onClick={start}
            type="button"
          >
            {starting
              ? isCrossAgent
                ? t('terminal.actions.starting-handoff')
                : isNativeFork
                  ? t('terminal.actions.starting-fork')
                  : t('terminal.actions.resuming-session')
              : isCrossAgent
                ? t('terminal.actions.start-handoff')
                : isNativeFork
                  ? t('terminal.actions.fork-session')
                  : t('terminal.actions.resume-session')}
          </button>
        </footer>
      </section>
    </div>
  );
}
