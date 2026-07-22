import type { GeneralSettings } from '../../../shared/contracts';

interface GeneralSettingsPanelProps {
  settings: GeneralSettings;
  saving: boolean;
  saveError: string | null;
  onShowInformationalNoticesChange(value: boolean): void;
}

export function GeneralSettingsPanel({
  settings,
  saving,
  saveError,
  onShowInformationalNoticesChange
}: GeneralSettingsPanelProps) {
  return (
    <section aria-labelledby="general-settings-title" className="general-settings-panel">
      <header className="settings-panel-heading">
        <p className="card-label">Interface</p>
        <h2 id="general-settings-title">General</h2>
        <p>Choose which optional guidance Lumora displays while you work.</p>
      </header>

      <label className="general-setting-card">
        <span className="general-setting-copy">
          <strong>Show informational notices</strong>
          <span id="informational-notices-description">
            Display non-critical diagnostics and helpful guidance throughout Lumora.
          </span>
        </span>
        <span className="settings-switch">
          <input
            aria-describedby="informational-notices-description"
            aria-label="Show informational notices"
            checked={settings.showInformationalNotices}
            disabled={saving}
            onChange={(event) =>
              onShowInformationalNoticesChange(event.currentTarget.checked)
            }
            role="switch"
            type="checkbox"
          />
          <span aria-hidden="true" className="settings-switch-track">
            <span className="settings-switch-thumb" />
          </span>
        </span>
      </label>

      {saveError === null ? null : (
        <p className="general-setting-error" role="alert">
          {saveError}
        </p>
      )}
    </section>
  );
}
