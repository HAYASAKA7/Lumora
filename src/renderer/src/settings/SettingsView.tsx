import { useRef, type KeyboardEvent } from 'react';

import type {
  AppearanceBackgroundState,
  GeneralSettings,
  KeyboardSettings,
  SessionSummary,
  SystemInfo,
  TerminalProfile,
  ThemePresetList,
  WorkspaceSummary
} from '../../../shared/contracts';
import {
  ProviderSettings,
  type ProviderScanStatus
} from '../providers/ProviderSettings';
import type { ProviderUpdatesStatus } from '../providers/useProviderUpdates';
import { useLocalization } from '../localization/useLocalization';
import {
  DeveloperEnvironmentPanel,
  type DeveloperEnvironmentStatus
} from '../environment/DeveloperEnvironment';
import { KeyboardShortcutsPanel } from './KeyboardShortcutsPanel';
import { GeneralSettingsPanel } from './GeneralSettingsPanel';
import { AppearanceSettingsPanel } from './AppearanceSettingsPanel';
import { LaunchSettingsPanel } from './LaunchSettingsPanel';
import { WorkspaceTrustPanel } from './WorkspaceTrustPanel';
import { SessionTransferPanel } from '../transfer/SessionTransferPanel';
import { DiagnosticsPanel } from './DiagnosticsPanel';
import { AboutPanel } from './AboutPanel';
import { ModsSettingsPanel } from './ModsSettingsPanel';

export type SettingsCategory =
  | 'general'
  | 'appearance'
  | 'mods'
  | 'providers'
  | 'environment'
  | 'launch'
  | 'security'
  | 'keyboard'
  | 'transfer'
  | 'diagnostics'
  | 'about';

interface SettingsViewProps {
  appearanceBackground: AppearanceBackgroundState;
  appearanceBackgroundBusy: boolean;
  appearanceBackgroundError: string | null;
  activeCategory: SettingsCategory;
  catalogReady: boolean;
  environmentStatus: DeveloperEnvironmentStatus;
  environmentRefreshing?: boolean;
  generalSettings: GeneralSettings;
  generalSettingsSaveError: string | null;
  generalSettingsSaving: boolean;
  themePresets?: ThemePresetList;
  themePresetsBusy?: boolean;
  themePresetsError?: boolean;
  onCategoryChange: (category: SettingsCategory) => void;
  onChooseAppearanceBackground: () => void;
  onGeneralSettingsChange: (settings: GeneralSettings) => void;
  onKeyboardSettingsChange: (settings: KeyboardSettings) => void;
  onOpenNodeDownload: () => Promise<void>;
  onRemoveAppearanceBackground: () => void;
  onRefreshEnvironment: () => void;
  onRefreshProviders: () => void;
  onRefreshProviderUpdates: () => Promise<void>;
  onRefreshThemePresets?: () => Promise<void>;
  onSaveEnabledProviders: (
    providers: readonly GeneralSettings['enabledProviders'][number][]
  ) => Promise<boolean>;
  onSessionImportCompleted: () => Promise<unknown> | unknown;
  platform: SystemInfo['platform'];
  profiles: readonly TerminalProfile[];
  providerStatus: ProviderScanStatus;
  providerRefreshing?: boolean;
  providerUpdatesRefreshing: boolean;
  providerUpdatesStatus: ProviderUpdatesStatus;
  runningSessionIds: ReadonlySet<string>;
  sessions: readonly SessionSummary[];
  workspaces: readonly WorkspaceSummary[];
}

const SETTINGS_CATEGORIES = [
  { id: 'general', labelKey: 'settings.tabs.general' },
  { id: 'appearance', labelKey: 'settings.tabs.appearance' },
  { id: 'mods', labelKey: 'settings.tabs.mods' },
  { id: 'providers', labelKey: 'settings.tabs.providers' },
  { id: 'environment', labelKey: 'settings.tabs.environment' },
  { id: 'launch', labelKey: 'settings.tabs.launch' },
  { id: 'security', labelKey: 'settings.tabs.security' },
  { id: 'keyboard', labelKey: 'settings.tabs.shortcuts' },
  { id: 'transfer', labelKey: 'settings.tabs.transfer' },
  { id: 'diagnostics', labelKey: 'settings.tabs.diagnostics' },
  { id: 'about', labelKey: 'settings.tabs.about' }
] as const;

export function SettingsView({
  appearanceBackground,
  appearanceBackgroundBusy,
  appearanceBackgroundError,
  activeCategory,
  catalogReady,
  environmentStatus,
  environmentRefreshing = false,
  generalSettings,
  generalSettingsSaveError,
  generalSettingsSaving,
  themePresets = { presets: [], rejectedCount: 0 },
  themePresetsBusy = false,
  themePresetsError = false,
  onCategoryChange,
  onChooseAppearanceBackground,
  onGeneralSettingsChange,
  onKeyboardSettingsChange,
  onOpenNodeDownload,
  onRemoveAppearanceBackground,
  onRefreshEnvironment,
  onRefreshProviders,
  onRefreshProviderUpdates,
  onRefreshThemePresets = async () => undefined,
  onSaveEnabledProviders,
  onSessionImportCompleted,
  platform,
  profiles,
  providerStatus,
  providerRefreshing = false,
  providerUpdatesRefreshing,
  providerUpdatesStatus,
  runningSessionIds,
  sessions,
  workspaces
}: SettingsViewProps) {
  const { t } = useLocalization();
  const tabRefs = useRef(new Map<SettingsCategory, HTMLButtonElement>());

  const selectAndFocus = (category: SettingsCategory) => {
    onCategoryChange(category);
    tabRefs.current.get(category)?.focus();
  };

  const handleTabKeyDown = (
    event: KeyboardEvent<HTMLButtonElement>,
    category: SettingsCategory
  ) => {
    const currentIndex = SETTINGS_CATEGORIES.findIndex(
      (candidate) => candidate.id === category
    );
    let nextIndex: number | null = null;

    if (event.key === 'ArrowRight') {
      nextIndex = (currentIndex + 1) % SETTINGS_CATEGORIES.length;
    } else if (event.key === 'ArrowLeft') {
      nextIndex =
        (currentIndex - 1 + SETTINGS_CATEGORIES.length) %
        SETTINGS_CATEGORIES.length;
    } else if (event.key === 'Home') {
      nextIndex = 0;
    } else if (event.key === 'End') {
      nextIndex = SETTINGS_CATEGORIES.length - 1;
    }

    if (nextIndex === null) return;
    const nextCategory = SETTINGS_CATEGORIES[nextIndex];
    if (nextCategory === undefined) return;

    event.preventDefault();
    selectAndFocus(nextCategory.id);
  };

  return (
    <div className="settings-layout">
      <div
        aria-label={t('settings.categories-label')}
        className="settings-category-tabs"
        role="tablist"
      >
        {SETTINGS_CATEGORIES.map((category) => {
          const selected = activeCategory === category.id;
          return (
            <button
              aria-controls={`settings-panel-${category.id}`}
              aria-selected={selected}
              className="settings-category-tab"
              id={`settings-tab-${category.id}`}
              key={category.id}
              onClick={() => onCategoryChange(category.id)}
              onKeyDown={(event) => handleTabKeyDown(event, category.id)}
              ref={(element) => {
                if (element === null) {
                  tabRefs.current.delete(category.id);
                } else {
                  tabRefs.current.set(category.id, element);
                }
              }}
              role="tab"
              tabIndex={selected ? 0 : -1}
              type="button"
            >
              {t(category.labelKey)}
            </button>
          );
        })}
      </div>

      <section
        aria-labelledby="settings-tab-general"
        className="settings-category-panel"
        hidden={activeCategory !== 'general'}
        id="settings-panel-general"
        role="tabpanel"
      >
        <GeneralSettingsPanel
          onChange={onGeneralSettingsChange}
          saveError={generalSettingsSaveError}
          saving={generalSettingsSaving}
          settings={generalSettings}
        />
      </section>

      <section
        aria-labelledby="settings-tab-mods"
        className="settings-category-panel"
        hidden={activeCategory !== 'mods'}
        id="settings-panel-mods"
        role="tabpanel"
      >
        <ModsSettingsPanel active={activeCategory === 'mods'} />
      </section>

      <section
        aria-labelledby="settings-tab-appearance"
        className="settings-category-panel"
        hidden={activeCategory !== 'appearance'}
        id="settings-panel-appearance"
        role="tabpanel"
      >
        <AppearanceSettingsPanel
          active={activeCategory === 'appearance'}
          background={appearanceBackground}
          backgroundBusy={appearanceBackgroundBusy}
          backgroundError={appearanceBackgroundError}
          onChange={onGeneralSettingsChange}
          onChooseBackground={onChooseAppearanceBackground}
          onRemoveBackground={onRemoveAppearanceBackground}
          onRefreshThemePresets={() => void onRefreshThemePresets()}
          saveError={generalSettingsSaveError}
          saving={generalSettingsSaving}
          settings={generalSettings}
          themePresets={themePresets}
          themePresetsBusy={themePresetsBusy}
          themePresetsError={themePresetsError}
        />
      </section>

      <section
        aria-labelledby="settings-tab-providers"
        className="settings-category-panel"
        hidden={activeCategory !== 'providers'}
        id="settings-panel-providers"
        role="tabpanel"
      >
        <ProviderSettings
          generalSettings={generalSettings}
          generalSettingsSaveError={generalSettingsSaveError}
          generalSettingsSaving={generalSettingsSaving}
          onGeneralSettingsChange={onGeneralSettingsChange}
          onRefresh={onRefreshProviders}
          onRefreshUpdates={onRefreshProviderUpdates}
          refreshing={providerRefreshing}
          onSaveEnabledProviders={onSaveEnabledProviders}
          status={providerStatus}
          updatesRefreshing={providerUpdatesRefreshing}
          updatesStatus={providerUpdatesStatus}
        />
      </section>

      <section
        aria-labelledby="settings-tab-environment"
        className="settings-category-panel"
        hidden={activeCategory !== 'environment'}
        id="settings-panel-environment"
        role="tabpanel"
      >
        <DeveloperEnvironmentPanel
          onOpenNodeDownload={onOpenNodeDownload}
          onRefresh={onRefreshEnvironment}
          refreshing={environmentRefreshing}
          status={environmentStatus}
        />
      </section>

      <section
        aria-labelledby="settings-tab-launch"
        className="settings-category-panel"
        hidden={activeCategory !== 'launch'}
        id="settings-panel-launch"
        role="tabpanel"
      >
        {catalogReady ? (
          <LaunchSettingsPanel
            enabledProviders={generalSettings.enabledProviders}
            profiles={profiles}
            sessions={sessions}
            workspaces={workspaces}
          />
        ) : null}
      </section>

      <section
        aria-labelledby="settings-tab-security"
        className="settings-category-panel"
        hidden={activeCategory !== 'security'}
        id="settings-panel-security"
        role="tabpanel"
      >
        {catalogReady ? (
          <WorkspaceTrustPanel
            onSettingsChange={onGeneralSettingsChange}
            saving={generalSettingsSaving}
            settings={generalSettings}
            workspaces={workspaces}
          />
        ) : null}
      </section>

      <section
        aria-labelledby="settings-tab-keyboard"
        className="settings-category-panel"
        hidden={activeCategory !== 'keyboard'}
        id="settings-panel-keyboard"
        role="tabpanel"
      >
        <KeyboardShortcutsPanel
          onChange={onKeyboardSettingsChange}
          platform={platform}
        />
      </section>

      <section
        aria-labelledby="settings-tab-transfer"
        className="settings-category-panel"
        hidden={activeCategory !== 'transfer'}
        id="settings-panel-transfer"
        role="tabpanel"
      >
        <SessionTransferPanel
          active={activeCategory === 'transfer'}
          onImportCompleted={onSessionImportCompleted}
          providerScan={
            providerStatus.state === 'ready' ? providerStatus.scan : null
          }
          runningSessionIds={runningSessionIds}
          sessions={sessions}
          workspaces={workspaces}
        />
      </section>

      <section
        aria-labelledby="settings-tab-diagnostics"
        className="settings-category-panel"
        hidden={activeCategory !== 'diagnostics'}
        id="settings-panel-diagnostics"
        role="tabpanel"
      >
        <DiagnosticsPanel active={activeCategory === 'diagnostics'} />
      </section>

      <section
        aria-labelledby="settings-tab-about"
        className="settings-category-panel"
        hidden={activeCategory !== 'about'}
        id="settings-panel-about"
        role="tabpanel"
      >
        <AboutPanel active={activeCategory === 'about'} />
      </section>
    </div>
  );
}
