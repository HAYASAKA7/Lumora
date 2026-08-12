import type { GeneralSettings } from '../../../shared/contracts';
import { SelectMenu } from '../ui/SelectMenu';

interface GeneralSettingsPanelProps {
  settings: GeneralSettings;
  saving: boolean;
  saveError: string | null;
  onChange(settings: GeneralSettings): void;
}

type BooleanGeneralSettingKey =
  | 'startMaximized'
  | 'checkProviderUpdatesAutomatically'
  | 'autoExpandSidebar'
  | 'showInformationalNotices'
  | 'showUnavailableWorkspaces'
  | 'showUnusableSessions'
  | 'crossAgentWorkflowEnabled';

interface BooleanGeneralSettingDefinition {
  key: BooleanGeneralSettingKey;
  label: string;
  description: string;
}

const GENERAL_SETTING_DEFINITIONS = {
  startMaximized: {
    key: 'startMaximized',
    label: 'Start with a maximized window',
    description:
      'Open Lumora maximized on the next launch while preserving your normal window size.'
  },
  checkProviderUpdatesAutomatically: {
    key: 'checkProviderUpdatesAutomatically',
    label: 'Check provider updates automatically',
    description:
      'Check enabled agent providers for newer releases when provider settings open.'
  },
  autoExpandSidebar: {
    key: 'autoExpandSidebar',
    label: 'Auto-expand sidebar when navigating',
    description:
      'Expand a collapsed sidebar when you choose a destination or use a navigation shortcut.'
  },
  showInformationalNotices: {
    key: 'showInformationalNotices',
    label: 'Show informational notices',
    description:
      'Display non-critical diagnostics and helpful guidance throughout Lumora.'
  },
  showUnavailableWorkspaces: {
    key: 'showUnavailableWorkspaces',
    label: 'Show unavailable workspaces',
    description:
      'Keep workspaces visible when their folders are not currently available.'
  },
  showUnusableSessions: {
    key: 'showUnusableSessions',
    label: 'Show unusable sessions',
    description:
      'Keep sessions visible when Lumora cannot currently resume them.'
  },
  crossAgentWorkflowEnabled: {
    key: 'crossAgentWorkflowEnabled',
    label: 'Enable cross-agent session handoff',
    description:
      'Start a new provider session from a temporary local copy of another provider session.'
  }
} as const satisfies Record<BooleanGeneralSettingKey, BooleanGeneralSettingDefinition>;

export function GeneralSettingsPanel({
  settings,
  saving,
  saveError,
  onChange
}: GeneralSettingsPanelProps) {
  const renderBooleanSetting = (setting: BooleanGeneralSettingDefinition) => {
    const descriptionId = `general-${setting.key}-description`;
    return (
      <label className="general-setting-row" key={setting.key}>
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
            onChange={(event) => onChange({
              ...settings,
              [setting.key]: event.currentTarget.checked
            })}
            role="switch"
            type="checkbox"
          />
          <span aria-hidden="true" className="settings-switch-track">
            <span className="settings-switch-thumb" />
          </span>
        </span>
      </label>
    );
  };

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

      <section
        aria-labelledby="general-window-behavior-title"
        className="general-setting-group"
        role="group"
      >
        <h3 className="general-setting-group-title" id="general-window-behavior-title">
          Window behavior
        </h3>
        <div className="general-setting-group-rows">
          {renderBooleanSetting(GENERAL_SETTING_DEFINITIONS.startMaximized)}
          <label className="general-setting-row">
            <span className="general-setting-copy">
              <strong>Keep Lumora running after closing the window</strong>
              <span id="general-window-close-description">
                Hide Lumora in the tray instead of exiting and stopping managed agents.
              </span>
            </span>
            <span className="settings-switch">
              <input
                aria-describedby="general-window-close-description"
                aria-label="Keep Lumora running after closing the window"
                checked={settings.windowCloseBehavior === 'hide_to_tray'}
                disabled={saving}
                onChange={(event) => onChange({
                  ...settings,
                  windowCloseBehavior: event.currentTarget.checked
                    ? 'hide_to_tray'
                    : 'quit'
                })}
                role="switch"
                type="checkbox"
              />
              <span aria-hidden="true" className="settings-switch-track">
                <span className="settings-switch-thumb" />
              </span>
            </span>
          </label>
        </div>
      </section>

      <section
        aria-labelledby="general-sidebar-notices-title"
        className="general-setting-group"
        role="group"
      >
        <h3 className="general-setting-group-title" id="general-sidebar-notices-title">
          Sidebar and notices
        </h3>
        <div className="general-setting-group-rows">
          {renderBooleanSetting(GENERAL_SETTING_DEFINITIONS.autoExpandSidebar)}
          {renderBooleanSetting(GENERAL_SETTING_DEFINITIONS.showInformationalNotices)}
        </div>
      </section>

      <section
        aria-labelledby="general-catalog-visibility-title"
        className="general-setting-group"
        role="group"
      >
        <h3 className="general-setting-group-title" id="general-catalog-visibility-title">
          Catalog visibility
        </h3>
        <div className="general-setting-group-rows">
          {renderBooleanSetting(GENERAL_SETTING_DEFINITIONS.showUnavailableWorkspaces)}
          {renderBooleanSetting(GENERAL_SETTING_DEFINITIONS.showUnusableSessions)}
        </div>
      </section>

      <section
        aria-labelledby="general-provider-maintenance-title"
        className="general-setting-group"
        role="group"
      >
        <h3
          className="general-setting-group-title"
          id="general-provider-maintenance-title"
        >
          Provider maintenance
        </h3>
        <div className="general-setting-group-rows">
          {renderBooleanSetting(
            GENERAL_SETTING_DEFINITIONS.checkProviderUpdatesAutomatically
          )}
        </div>
      </section>

      <section
        aria-labelledby="general-remote-behavior-title"
        className="general-setting-group"
        role="group"
      >
        <h3 className="general-setting-group-title" id="general-remote-behavior-title">
          Remote behavior
        </h3>
        <div className="general-setting-group-rows">
          <label className="general-setting-row">
            <span className="general-setting-copy">
              <strong>Disconnect when a remote window closes</strong>
              <span id="general-remote-window-close-description">
                Close its SSH connection when the remote Lumora window closes.
                Running remote agents require confirmation first.
              </span>
            </span>
            <span className="settings-switch">
              <input
                aria-describedby="general-remote-window-close-description"
                aria-label="Disconnect when a remote window closes"
                checked={settings.remoteWindowCloseBehavior === 'disconnect'}
                disabled={saving}
                onChange={(event) => onChange({
                  ...settings,
                  remoteWindowCloseBehavior: event.currentTarget.checked
                    ? 'disconnect'
                    : 'keep_connected'
                })}
                role="switch"
                type="checkbox"
              />
              <span aria-hidden="true" className="settings-switch-track">
                <span className="settings-switch-thumb" />
              </span>
            </span>
          </label>
        </div>
      </section>

      <section
        aria-labelledby="general-cross-agent-handoff-title"
        className="general-setting-group"
        role="group"
      >
        <h3
          className="general-setting-group-title"
          id="general-cross-agent-handoff-title"
        >
          Cross-agent handoff
        </h3>
        <div className="general-setting-group-rows">
          {renderBooleanSetting(GENERAL_SETTING_DEFINITIONS.crossAgentWorkflowEnabled)}
          <div className="general-setting-row general-setting-row-control">
            <span className="general-setting-copy">
              <strong>Temporary handoff retention</strong>
              <span id="general-handoff-retention-description">
                Automatically delete Lumora's managed session copies after this time.
              </span>
            </span>
            <SelectMenu
              ariaDescribedBy="general-handoff-retention-description"
              disabled={saving || !settings.crossAgentWorkflowEnabled}
              label="Temporary handoff retention"
              onChange={(value) => onChange({
                ...settings,
                crossAgentHandoffRetentionDays: Number(value)
              })}
              options={[1, 7, 30, 60, 90, 180, 365].map((days) => ({
                value: String(days),
                label: days === 1 ? '1 day' : `${days} days`
              }))}
              value={String(settings.crossAgentHandoffRetentionDays)}
            />
          </div>
        </div>
      </section>

      {saveError === null ? null : (
        <p className="general-setting-error" role="alert">
          {saveError}
        </p>
      )}
    </section>
  );
}
