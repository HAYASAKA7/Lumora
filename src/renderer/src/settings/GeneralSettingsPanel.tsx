import { useState } from 'react';

import type {
  GeneralSettings,
  LocaleWarning,
  LumoraApi
} from '../../../shared/contracts';
import { useLocalization } from '../localization/useLocalization';
import { SelectMenu } from '../ui/SelectMenu';

interface GeneralSettingsPanelProps {
  settings: GeneralSettings;
  saving: boolean;
  saveError: string | null;
  onChange(settings: GeneralSettings): void;
  api?: Pick<LumoraApi, 'openUserLocaleFolder' | 'reloadLocalization'>;
}

type BooleanGeneralSettingKey =
  | 'startMaximized'
  | 'checkProviderUpdatesAutomatically'
  | 'autoExpandSidebar'
  | 'showInformationalNotices'
  | 'showUnavailableWorkspaces'
  | 'showUnusableSessions'
  | 'warnBeforeApplicationQuit'
  | 'warnBeforeRemoteDisconnect'
  | 'crossAgentWorkflowEnabled';

interface BooleanGeneralSettingDefinition {
  key: BooleanGeneralSettingKey;
  labelKey: string;
  descriptionKey: string;
}

const GENERAL_SETTING_DEFINITIONS = {
  startMaximized: {
    key: 'startMaximized',
    labelKey: 'settings.general.start-maximized',
    descriptionKey: 'settings.general.start-maximized-description'
  },
  checkProviderUpdatesAutomatically: {
    key: 'checkProviderUpdatesAutomatically',
    labelKey: 'settings.general.provider-updates',
    descriptionKey: 'settings.general.provider-updates-description'
  },
  autoExpandSidebar: {
    key: 'autoExpandSidebar',
    labelKey: 'settings.general.auto-expand-sidebar',
    descriptionKey: 'settings.general.auto-expand-sidebar-description'
  },
  showInformationalNotices: {
    key: 'showInformationalNotices',
    labelKey: 'settings.general.show-notices',
    descriptionKey: 'settings.general.show-notices-description'
  },
  showUnavailableWorkspaces: {
    key: 'showUnavailableWorkspaces',
    labelKey: 'settings.general.show-unavailable-workspaces',
    descriptionKey: 'settings.general.show-unavailable-workspaces-description'
  },
  showUnusableSessions: {
    key: 'showUnusableSessions',
    labelKey: 'settings.general.show-unusable-sessions',
    descriptionKey: 'settings.general.show-unusable-sessions-description'
  },
  warnBeforeApplicationQuit: {
    key: 'warnBeforeApplicationQuit',
    labelKey: 'settings.general.warn-quit',
    descriptionKey: 'settings.general.warn-quit-description'
  },
  warnBeforeRemoteDisconnect: {
    key: 'warnBeforeRemoteDisconnect',
    labelKey: 'settings.general.warn-remote',
    descriptionKey: 'settings.general.warn-remote-description'
  },
  crossAgentWorkflowEnabled: {
    key: 'crossAgentWorkflowEnabled',
    labelKey: 'settings.general.cross-agent-enabled',
    descriptionKey: 'settings.general.cross-agent-description'
  }
} as const satisfies Record<BooleanGeneralSettingKey, BooleanGeneralSettingDefinition>;

export function GeneralSettingsPanel({
  api = window.lumora,
  settings,
  saving,
  saveError,
  onChange
}: GeneralSettingsPanelProps) {
  const { snapshot, t } = useLocalization();
  const [localeActionStatus, setLocaleActionStatus] = useState<string | null>(null);
  const [localeActionError, setLocaleActionError] = useState<string | null>(null);
  const localeOptions: Array<{
    value: GeneralSettings['languagePreference'];
    label: string;
  }> = [
    {
      value: 'system',
      label: t('settings.general.language-system-active', {
        language: snapshot.availableLocales.find(
          (locale) => locale.locale === snapshot.locale
        )?.displayName ?? snapshot.locale
      })
    },
    ...snapshot.availableLocales.map((locale) => {
      let translatedName = locale.displayName;
      try {
        translatedName = new Intl.DisplayNames(snapshot.formattingLocale, {
          type: 'language'
        }).of(locale.locale) ?? locale.displayName;
      } catch {
        // The manifest self-name remains a stable fallback.
      }
      return {
        value: locale.locale,
        label: translatedName === locale.displayName
          ? locale.displayName
          : `${locale.displayName} — ${translatedName}`
      };
    })
  ];
  if (
    settings.languagePreference !== 'system' &&
    !snapshot.availableLocales.some(
      (locale) => locale.locale === settings.languagePreference
    )
  ) {
    localeOptions.push({
      value: settings.languagePreference,
      label: t('settings.general.language-unavailable', {
        locale: settings.languagePreference
      })
    });
  }

  const warningText = (warning: LocaleWarning): string => {
    const keys: Record<LocaleWarning['code'], string> = {
      'invalid-user-pack': 'settings.general.language-warning-invalid',
      'unsupported-schema': 'settings.general.language-warning-schema',
      'catalog-version-mismatch': 'settings.general.language-warning-catalog',
      'unknown-message-key': 'settings.general.language-warning-key'
    };
    return t(keys[warning.code]);
  };

  const renderBooleanSetting = (setting: BooleanGeneralSettingDefinition) => {
    const descriptionId = `general-${setting.key}-description`;
    const label = t(setting.labelKey);
    return (
      <label className="general-setting-row" key={setting.key}>
        <span className="general-setting-copy">
          <strong>{label}</strong>
          <span id={descriptionId}>{t(setting.descriptionKey)}</span>
        </span>
        <span className="settings-switch">
          <input
            aria-describedby={descriptionId}
            aria-label={label}
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
          <p className="card-label">{t('settings.general.eyebrow')}</p>
          <h2 id="general-settings-title">{t('settings.general.title')}</h2>
          <p>{t('settings.general.description')}</p>
        </div>
      </header>

      <section
        aria-labelledby="general-language-title"
        className="general-setting-group"
        role="group"
      >
        <h3 className="general-setting-group-title" id="general-language-title">
          {t('settings.general.language-title')}
        </h3>
        <div className="general-setting-group-rows">
          <div className="general-setting-row general-setting-row-control">
            <span className="general-setting-copy">
              <strong>{t('settings.general.language-title')}</strong>
              <span id="general-language-description">
                {t('settings.general.language-description')}
              </span>
            </span>
            <SelectMenu
              ariaDescribedBy="general-language-description"
              disabled={saving}
              label={t('settings.general.language-title')}
              onChange={(value) => onChange({
                ...settings,
                languagePreference: value
              })}
              options={localeOptions}
              value={settings.languagePreference}
            />
          </div>
          <div className="general-setting-row general-setting-row-control">
            <span className="general-setting-copy">
              <strong>{t('settings.general.open-language-folder')}</strong>
              <span>{t('settings.general.language-description')}</span>
            </span>
            <div className="provider-panel-actions">
              <button
                className="secondary-button"
                data-lumora-command
                disabled={saving}
                onClick={() => {
                  setLocaleActionError(null);
                  void api.openUserLocaleFolder().catch(() => {
                    setLocaleActionError(t('settings.general.language-open-failed'));
                  });
                }}
                tabIndex={-1}
                type="button"
              >
                {t('settings.general.open-language-folder')}
              </button>
              <button
                className="secondary-button"
                data-lumora-command
                disabled={saving}
                onClick={() => {
                  setLocaleActionError(null);
                  setLocaleActionStatus(null);
                  void api.reloadLocalization().then(
                    (result) => {
                      const rejected = result.rejectedUserPacks === 0
                        ? ''
                        : ` ${t('settings.general.language-rejected', {
                            count: result.rejectedUserPacks
                          })}`;
                      setLocaleActionStatus(
                        `${t('settings.general.language-reload-complete')}${rejected}`
                      );
                    },
                    () => setLocaleActionError(
                      t('settings.general.language-reload-failed')
                    )
                  );
                }}
                tabIndex={-1}
                type="button"
              >
                {t('settings.general.reload-languages')}
              </button>
            </div>
          </div>
        </div>
        {localeActionStatus === null ? null : <p role="status">{localeActionStatus}</p>}
        {localeActionError === null ? null : (
          <p className="general-setting-error" role="alert">{localeActionError}</p>
        )}
        {snapshot.warnings.length === 0 ? null : (
          <div className="general-setting-error" role="alert">
            {[...new Set(snapshot.warnings.map(warningText))].map((message) => (
              <p key={message}>{message}</p>
            ))}
          </div>
        )}
      </section>

      <section
        aria-labelledby="general-window-behavior-title"
        className="general-setting-group"
        role="group"
      >
        <h3 className="general-setting-group-title" id="general-window-behavior-title">
          {t('settings.general.startup-title')}
        </h3>
        <div className="general-setting-group-rows">
          {renderBooleanSetting(GENERAL_SETTING_DEFINITIONS.startMaximized)}
          <label className="general-setting-row">
            <span className="general-setting-copy">
              <strong>{t('settings.general.close-behavior')}</strong>
              <span id="general-window-close-description">
                {t('settings.general.close-behavior-description')}
              </span>
            </span>
            <span className="settings-switch">
              <input
                aria-describedby="general-window-close-description"
                aria-label={t('settings.general.close-behavior')}
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
          {renderBooleanSetting(GENERAL_SETTING_DEFINITIONS.warnBeforeApplicationQuit)}
        </div>
      </section>

      <section
        aria-labelledby="general-sidebar-notices-title"
        className="general-setting-group"
        role="group"
      >
        <h3 className="general-setting-group-title" id="general-sidebar-notices-title">
          {t('settings.general.notices-title')}
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
          {t('settings.general.workspace-visibility-title')}
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
          {t('settings.general.provider-maintenance-title')}
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
          {t('settings.general.remote-title')}
        </h3>
        <div className="general-setting-group-rows">
          <label className="general-setting-row">
            <span className="general-setting-copy">
              <strong>{t('settings.general.remote-disconnect')}</strong>
              <span id="general-remote-window-close-description">
                {t('settings.general.remote-disconnect-description')}
              </span>
            </span>
            <span className="settings-switch">
              <input
                aria-describedby="general-remote-window-close-description"
                aria-label={t('settings.general.remote-disconnect')}
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
          {renderBooleanSetting(GENERAL_SETTING_DEFINITIONS.warnBeforeRemoteDisconnect)}
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
          {t('settings.general.cross-agent-title')}
        </h3>
        <div className="general-setting-group-rows">
          {renderBooleanSetting(GENERAL_SETTING_DEFINITIONS.crossAgentWorkflowEnabled)}
          <div className="general-setting-row general-setting-row-control">
            <span className="general-setting-copy">
              <strong>{t('settings.general.retention-days')}</strong>
              <span id="general-handoff-retention-description">
                {t('settings.general.retention-description')}
              </span>
            </span>
            <SelectMenu
              ariaDescribedBy="general-handoff-retention-description"
              disabled={saving || !settings.crossAgentWorkflowEnabled}
              label={t('settings.general.retention-days')}
              onChange={(value) => onChange({
                ...settings,
                crossAgentHandoffRetentionDays: Number(value)
              })}
              options={[1, 7, 30, 60, 90, 180, 365].map((days) => ({
                value: String(days),
                label: t('settings.general.days', { count: days })
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
