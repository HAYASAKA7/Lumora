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
  }
] as const satisfies ReadonlyArray<{
  key:
    | 'startMaximized'
    | 'checkProviderUpdatesAutomatically'
    | 'autoExpandSidebar'
    | 'showInformationalNotices';
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
          <p>Choose how Lumora starts, navigates, and checks for updates.</p>
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

      {saveError === null ? null : (
        <p className="general-setting-error" role="alert">
          {saveError}
        </p>
      )}
    </section>
  );
}
