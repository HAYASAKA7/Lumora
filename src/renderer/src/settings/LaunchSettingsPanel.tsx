import { useEffect, useMemo, useState, type ReactNode } from 'react';

import type {
  LaunchSettingsLayer,
  LaunchSettingsLayerInput,
  LaunchSettingsScope,
  LaunchSettingsValue,
  LumoraApi,
  ProviderId,
  SessionSummary,
  TerminalProfile,
  WorkspaceSummary
} from '../../../shared/contracts';
import { PROVIDER_DEFINITIONS } from '../../../shared/provider-definitions';
import { SelectMenu } from '../ui/SelectMenu';

type CommandMode = 'inherit' | 'detected' | 'custom';
type ProfileChoice = 'inherit' | 'automatic' | string;

interface CommandDraft {
  mode: CommandMode;
  command: string;
}

const ALL_PROVIDERS: readonly ProviderId[] = PROVIDER_DEFINITIONS.map(
  (definition) => definition.provider
);
const PROVIDER_LABELS = Object.fromEntries(
  PROVIDER_DEFINITIONS.map((definition) => [
    definition.provider,
    definition.displayName
  ])
) as Readonly<Record<ProviderId, string>>;

function emptyCommands(): Record<ProviderId, CommandDraft> {
  return Object.fromEntries(
    ALL_PROVIDERS.map((provider) => [
      provider,
      { mode: 'inherit' as const, command: '' }
    ])
  ) as Record<ProviderId, CommandDraft>;
}

function commandDraft(
  settings: LaunchSettingsValue,
  provider: ProviderId
): CommandDraft {
  const commands = settings.providerCommands;
  if (
    commands === undefined ||
    !Object.prototype.hasOwnProperty.call(commands, provider)
  ) {
    return { mode: 'inherit', command: '' };
  }
  const value = commands[provider];
  return value === null
    ? { mode: 'detected', command: '' }
    : { mode: 'custom', command: value ?? '' };
}

function targetOptions(
  scope: LaunchSettingsScope,
  enabledProviders: readonly ProviderId[],
  workspaces: readonly WorkspaceSummary[],
  sessions: readonly SessionSummary[]
): Array<{ id: string; label: string }> {
  if (scope === 'provider') {
    return enabledProviders.map((provider) => ({
      id: provider,
      label: PROVIDER_LABELS[provider]
    }));
  }
  if (scope === 'workspace') {
    return workspaces.map((workspace) => ({
      id: workspace.id,
      label: workspace.displayName
    }));
  }
  if (scope === 'session') {
    return sessions.map((session) => ({
      id: session.id,
      label: session.title
    }));
  }
  return [{ id: 'global', label: 'All launches' }];
}

export function LaunchSettingsPanel({
  api = window.lumora,
  enabledProviders = ALL_PROVIDERS,
  profiles,
  sessions,
  workspaces
}: {
  api?: LumoraApi;
  enabledProviders?: readonly ProviderId[];
  profiles: readonly TerminalProfile[];
  sessions: readonly SessionSummary[];
  workspaces: readonly WorkspaceSummary[];
}): ReactNode {
  const [layers, setLayers] = useState<LaunchSettingsLayer[]>([]);
  const [scope, setScope] = useState<LaunchSettingsScope>('global');
  const [targetId, setTargetId] = useState('global');
  const [profileChoice, setProfileChoice] =
    useState<ProfileChoice>('inherit');
  const [commands, setCommands] =
    useState<Record<ProviderId, CommandDraft>>(emptyCommands);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void api.getLaunchSettingsLayers().then(
      (values) => {
        if (!active) return;
        setLayers(values);
        setLoading(false);
      },
      () => {
        if (!active) return;
        setError('Launch settings could not be loaded.');
        setLoading(false);
      }
    );
    return () => {
      active = false;
    };
  }, [api]);

  const options = useMemo(
    () => targetOptions(scope, enabledProviders, workspaces, sessions),
    [enabledProviders, scope, workspaces, sessions]
  );

  useEffect(() => {
    const nextTarget =
      scope === 'global'
        ? 'global'
        : options.some((option) => option.id === targetId)
          ? targetId
          : (options[0]?.id ?? '');
    if (nextTarget !== targetId) setTargetId(nextTarget);
  }, [options, scope, targetId]);

  const selectedLayer = useMemo(
    () =>
      layers.find(
        (layer) => layer.scope === scope && layer.targetId === targetId
      ) ?? null,
    [layers, scope, targetId]
  );

  useEffect(() => {
    const settings = selectedLayer?.settings ?? {};
    setProfileChoice(
      settings.terminalProfileId === undefined
        ? 'inherit'
        : settings.terminalProfileId === null
          ? 'automatic'
          : settings.terminalProfileId
    );
    setCommands(
      Object.fromEntries(
        ALL_PROVIDERS.map((provider) => [
          provider,
          commandDraft(settings, provider)
        ])
      ) as Record<ProviderId, CommandDraft>
    );
  }, [selectedLayer]);

  const applicableProviders = useMemo<ProviderId[]>(() => {
    if (scope === 'provider') {
      return enabledProviders.includes(targetId as ProviderId)
        ? [targetId as ProviderId]
        : [];
    }
    if (scope === 'session') {
      const provider = sessions.find(
        (session) => session.id === targetId
      )?.provider;
      return provider === undefined || !enabledProviders.includes(provider)
        ? []
        : [provider];
    }
    return [...enabledProviders];
  }, [enabledProviders, scope, sessions, targetId]);

  const buildSettings = (): LaunchSettingsValue => {
    const settings: LaunchSettingsValue = {};
    if (profileChoice === 'automatic') {
      settings.terminalProfileId = null;
    } else if (profileChoice !== 'inherit') {
      settings.terminalProfileId = profileChoice;
    }
    const providerCommands: NonNullable<
      LaunchSettingsValue['providerCommands']
    > = {};
    const savedCommands = selectedLayer?.settings.providerCommands;
    if (savedCommands !== undefined) {
      for (const provider of ALL_PROVIDERS) {
        if (
          enabledProviders.includes(provider) ||
          !Object.prototype.hasOwnProperty.call(savedCommands, provider)
        ) {
          continue;
        }
        providerCommands[provider] = savedCommands[provider] ?? null;
      }
    }
    for (const provider of applicableProviders) {
      const draft = commands[provider];
      if (draft.mode === 'detected') {
        providerCommands[provider] = null;
      } else if (draft.mode === 'custom') {
        providerCommands[provider] = draft.command.trim();
      }
    }
    if (Object.keys(providerCommands).length > 0) {
      settings.providerCommands = providerCommands;
    }
    return settings;
  };

  const inputFor = (
    settings: LaunchSettingsValue
  ): LaunchSettingsLayerInput => {
    if (scope === 'global') {
      return { scope, targetId: 'global', settings };
    }
    if (scope === 'provider') {
      return { scope, targetId: targetId as ProviderId, settings };
    }
    return { scope, targetId, settings };
  };

  const save = (settings: LaunchSettingsValue) => {
    if (targetId === '') return;
    setSaving(true);
    setError(null);
    void api.saveLaunchSettingsLayer(inputFor(settings)).then(
      (values) => {
        setLayers(values);
        setSaving(false);
      },
      () => {
        setError('The launch settings layer could not be saved.');
        setSaving(false);
      }
    );
  };

  const invalidCustomCommand = applicableProviders.some((provider) => {
    const draft = commands[provider];
    return draft.mode === 'custom' && draft.command.trim() === '';
  });

  return (
    <section className="catalog-panel launch-settings-panel" aria-labelledby="launch-settings-title">
      <header className="provider-panel-header">
        <div>
          <p className="card-label">Effective configuration</p>
          <h2 id="launch-settings-title">Launch defaults</h2>
          <p>Resolve terminal and provider settings from Global through Session.</p>
        </div>
      </header>

      {loading ? (
        <div className="catalog-state" role="status">Loading launch settings</div>
      ) : (
        <div className="launch-settings-editor">
          <div className="launch-settings-scope">
            <div className="select-field">
              <span>Settings scope</span>
              <SelectMenu
                label="Settings scope"
                onChange={(value) => setScope(value as LaunchSettingsScope)}
                options={[
                  { value: 'global', label: 'Global' },
                  { value: 'provider', label: 'Provider' },
                  { value: 'workspace', label: 'Workspace' },
                  { value: 'session', label: 'Session' }
                ]}
                value={scope}
              />
            </div>
            {scope === 'global' ? null : (
              <div className="select-field">
                <span>Scope target</span>
                <SelectMenu
                  label="Scope target"
                  onChange={setTargetId}
                  options={options.map((option) => ({
                    value: option.id,
                    label: option.label
                  }))}
                  value={targetId}
                />
              </div>
            )}
          </div>

          <div className="select-field">
            <span>Default terminal profile</span>
            <SelectMenu
              label="Default terminal profile"
              onChange={setProfileChoice}
              options={[
                { value: 'inherit', label: 'Inherit' },
                { value: 'automatic', label: 'Automatic recommended' },
                ...profiles.map((profile) => ({
                  value: profile.id,
                  label: `${profile.name}${profile.available ? '' : ' (unavailable)'}`
                }))
              ]}
              value={profileChoice}
            />
          </div>

          <div className="launch-settings-commands">
            {applicableProviders.map((provider) => {
              const label = PROVIDER_LABELS[provider];
              const draft = commands[provider];
              return (
                <fieldset key={provider}>
                  <legend>{label} start command</legend>
                  <div className="select-field">
                    <span>Mode</span>
                    <SelectMenu
                      label={`${label} command mode`}
                      onChange={(value) => {
                        const mode = value as CommandMode;
                        setCommands((current) => ({
                          ...current,
                          [provider]: {
                            ...current[provider],
                            mode
                          }
                        }));
                      }}
                      options={[
                        { value: 'inherit', label: 'Inherit' },
                        { value: 'detected', label: 'Use detected CLI' },
                        { value: 'custom', label: 'Custom command' }
                      ]}
                      value={draft.mode}
                    />
                  </div>
                  {draft.mode !== 'custom' ? null : (
                    <label>
                      <span>Command</span>
                      <input
                        aria-label={`${label} command`}
                        maxLength={4096}
                        onChange={(event) => {
                          const command = event.currentTarget.value;
                          setCommands((current) => ({
                            ...current,
                            [provider]: {
                              ...current[provider],
                              command
                            }
                          }));
                        }}
                        type="text"
                        value={draft.command}
                      />
                    </label>
                  )}
                </fieldset>
              );
            })}
          </div>

          <div className="provider-command-actions">
            <button
              className="refresh-button"
              disabled={saving || targetId === '' || invalidCustomCommand}
              onClick={() => save(buildSettings())}
              type="button"
            >
              {saving ? 'Saving launch settings' : 'Save launch settings'}
            </button>
            <button
              className="text-button"
              disabled={saving || targetId === ''}
              onClick={() => save({})}
              type="button"
            >
              Reset layer
            </button>
          </div>
          <p className="provider-scan-time">
            {selectedLayer === null
              ? 'This scope currently inherits all values.'
              : `Editing saved ${scope} layer.`}
          </p>
        </div>
      )}
      {error === null ? null : (
        <p className="catalog-operation-error" role="alert">{error}</p>
      )}
    </section>
  );
}
