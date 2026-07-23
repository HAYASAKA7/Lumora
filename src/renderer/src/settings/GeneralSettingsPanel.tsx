import type { GeneralSettings } from '../../../shared/contracts';

interface GeneralSettingsPanelProps {
  settings: GeneralSettings;
  saving: boolean;
  saveError: string | null;
  onChange(settings: GeneralSettings): void;
}

const GENERAL_SETTINGS = [
  {
    key: 'startMaximized',
    label: 'Start with a maximized window',
    description:
      'Open Lumora maximized on the next launch while preserving your normal window size.'
  },
  {
    key: 'checkProviderUpdatesAutomatically',
    label: 'Check provider updates automatically',
    description:
      'Check enabled agent providers for newer releases when provider settings open.'
  },
  {
    key: 'autoExpandSidebar',
    label: 'Auto-expand sidebar when navigating',
    description:
      'Expand a collapsed sidebar when you choose a destination or use a navigation shortcut.'
  },
  {
    key: 'showInformationalNotices',
    label: 'Show informational notices',
    description:
      'Display non-critical diagnostics and helpful guidance throughout Lumora.'
  },
  {
    key: 'crossAgentWorkflowEnabled',
    label: 'Enable cross-agent session handoff',
    description:
      'Start a new provider session from a temporary local copy of another provider session.'
  }
] as const satisfies ReadonlyArray<{
  key:
    | 'startMaximized'
    | 'checkProviderUpdatesAutomatically'
    | 'autoExpandSidebar'
    | 'showInformationalNotices'
    | 'crossAgentWorkflowEnabled';
  label: string;
  description: string;
}>;

export function GeneralSettingsPanel({
  settings,
  saving,
  saveError,
  onChange
}: GeneralSettingsPanelProps) {
  return (
    <section
      aria-labelledby="general-settings-title"
      className="catalog-panel general-settings-panel"
    >
      <header className="provider-panel-header">
        <div>
          <p className="card-label">Interface</p>
          <h2 id="general-settings-title">General</h2>
          <p>Choose how Lumora starts, navigates, checks, and transfers context.</p>
        </div>
      </header>

      {GENERAL_SETTINGS.map((setting) => {
        const descriptionId = `general-${setting.key}-description`;
        return (
          <label className="general-setting-card" key={setting.key}>
            <span className="general-setting-copy">
              <strong>{setting.label}</strong>
              <span id={descriptionId}>{setting.description}</span>
            </span>
            <span className="settings-switch">
              <input
                aria-describedby={descriptionId}
                aria-label={setting.label}
                checked={settings[setting.key]}
                disabled={saving}
                onChange={(event) =>
                  onChange({
                    ...settings,
                    [setting.key]: event.currentTarget.checked
                  })
                }
                role="switch"
                type="checkbox"
              />
              <span aria-hidden="true" className="settings-switch-track">
                <span className="settings-switch-thumb" />
              </span>
            </span>
          </label>
        );
      })}

      <label className="general-setting-card">
        <span className="general-setting-copy">
          <strong>Temporary handoff retention</strong>
          <span id="general-handoff-retention-description">
            Automatically delete Lumora's managed session copies after this time.
          </span>
        </span>
        <select
          aria-describedby="general-handoff-retention-description"
          aria-label="Temporary handoff retention"
          disabled={saving || !settings.crossAgentWorkflowEnabled}
          onChange={(event) => onChange({
            ...settings,
            crossAgentHandoffRetentionDays: Number(event.currentTarget.value)
          })}
          value={settings.crossAgentHandoffRetentionDays}
        >
          {[1, 7, 30, 60, 90, 180, 365].map((days) => (
            <option key={days} value={days}>
              {days === 1 ? '1 day' : `${days} days`}
            </option>
          ))}
        </select>
      </label>

      {saveError === null ? null : (
        <p className="general-setting-error" role="alert">
          {saveError}
        </p>
      )}
    </section>
  );
}
