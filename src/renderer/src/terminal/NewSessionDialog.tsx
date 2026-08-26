import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import type {
  AgentRuntimeStartResult,
  LaunchPrepareRequest,
  LaunchPreview,
  LumoraApi,
  ProviderId,
  ProviderScanResult,
  RuntimeSummary,
  TerminalProfile,
  WorkspaceSummary
} from '../../../shared/contracts';
import { hasVerifiedStartPromptSupport } from '../../../shared/provider-definitions';
import { SelectMenu } from '../ui/SelectMenu';
import { LaunchReadiness } from './LaunchReadiness';
import { useLaunchPreflight } from './useLaunchPreflight';
import { useLocalization } from '../localization/useLocalization';

interface NewSessionDialogProps {
  api?: LumoraApi;
  initialWorkspaceId?: string | null;
  workspaces: readonly WorkspaceSummary[];
  profiles: readonly TerminalProfile[];
  providerScan: ProviderScanResult | null;
  onClose(): void;
  onStarted(runtime: RuntimeSummary, preview: LaunchPreview): void;
  onAgentStarted?(
    result: AgentRuntimeStartResult,
    preview: LaunchPreview
  ): void;
}

export function NewSessionDialog({
  api = window.lumora,
  initialWorkspaceId = null,
  workspaces,
  profiles,
  providerScan,
  onClose,
  onStarted,
  onAgentStarted
}: NewSessionDialogProps): ReactNode {
  const { t } = useLocalization();
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
          setActionError(t('terminal.new.trust-save-failed'));
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
          const result = await api.startAgentRuntime(preview.launchToken);
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
        setActionError(t('terminal.new.start-failed'));
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
            <p className="card-label">{t('terminal.new.launch-label')}</p>
            <h2 id="new-session-title">{t('terminal.actions.new-session')}</h2>
          </div>
          <button aria-label={t('terminal.new.close-label')} className="text-button" onClick={onClose} type="button">{t('common.actions.close')}</button>
        </header>

        <div className="dialog-body">
        <div className="launch-fields">
          <div className="select-field">
            <span>{t('terminal.new.workspace')}</span>
            <SelectMenu
              disabled={starting}
              label={t('terminal.new.workspace')}
              onChange={setWorkspaceId}
              options={availableWorkspaces.map((workspace) => ({
                value: workspace.id,
                label: workspace.displayName
              }))}
              value={workspaceId}
            />
          </div>
          <div className="select-field">
            <span>{t('terminal.new.provider')}</span>
            <SelectMenu
              disabled={starting}
              label={t('terminal.new.provider')}
              onChange={(value) => setProvider(value as ProviderId)}
              options={readyProviders.map((installation) => ({
                value: installation.provider,
                label: installation.displayName
              }))}
              value={provider}
            />
          </div>
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
          {supportsStartPrompt ? (
            <label className="new-session-start-prompt">
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
        </div>

        <LaunchReadiness
          actionError={actionError}
          emptyMessage={t('terminal.new.empty-selection')}
          failureMessage={t('terminal.new.preview-failed')}
          onRetry={retry}
          onTrustConfirmedChange={setTrustConfirmed}
          preparingMessage={t('terminal.launch.preparing')}
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
            {t(starting ? 'terminal.actions.starting-terminal' : 'terminal.actions.start-session')}
          </button>
        </footer>
      </section>
    </div>
  );
}
