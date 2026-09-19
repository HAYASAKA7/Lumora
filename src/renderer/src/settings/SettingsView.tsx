import {
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode
} from 'react';

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
import { useFocusSearchRequest } from '../keyboard/page-requests';
import { scrollUnderPageToolbar, useKeepPageToolbarPinned } from '../shell/page-toolbar';
import { Tooltip } from '../ui/Tooltip';
import { KeyboardShortcutsPanel } from './KeyboardShortcutsPanel';
import { GeneralSettingsPanel } from './GeneralSettingsPanel';
import { AppearanceSettingsPanel } from './AppearanceSettingsPanel';
import { LaunchSettingsPanel } from './LaunchSettingsPanel';
import { WorkspaceTrustPanel } from './WorkspaceTrustPanel';
import { SessionTransferPanel } from '../transfer/SessionTransferPanel';
import { DiagnosticsPanel } from './DiagnosticsPanel';
import { AboutPanel } from './AboutPanel';
import { ModsSettingsPanel } from './ModsSettingsPanel';
import {
  applySettingsSearch,
  isSearching,
  parseSettingsQuery,
  SettingsSearchingContext,
  withModifiedToken
} from './settings-search';

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
  /** Whether the search shortcut is Settings' to answer. */
  shortcutsActive?: boolean;
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

/** Space left between the pinned bar and a category brought under it. */
const REVEALED_CATEGORY_GAP = 12;

type MatchCounts = Readonly<Record<string, number>>;

function sameCounts(first: MatchCounts, second: MatchCounts): boolean {
  const keys = Object.keys(first);
  return keys.length === Object.keys(second).length &&
    keys.every((key) => first[key] === second[key]);
}

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
  shortcutsActive = true,
  workspaces
}: SettingsViewProps) {
  const { t } = useLocalization();
  const tabRefs = useRef(new Map<SettingsCategory, HTMLButtonElement>());
  const layoutRef = useRef<HTMLDivElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const [queryText, setQueryText] = useState('');
  const query = useMemo(() => parseSettingsQuery(queryText), [queryText]);
  const searching = isSearching(query);
  const [counts, setCounts] = useState<MatchCounts>({});
  const matchCount = Object.values(counts).reduce((total, count) => total + count, 0);

  useFocusSearchRequest(shortcutsActive, () => {
    const field = searchRef.current;
    if (field === null) return;
    // Selecting what is there lets the next keystroke start a new search.
    field.focus();
    field.select();
  });
  // A new search shows its first results under the pinned bar.
  useKeepPageToolbarPinned(searchRef, JSON.stringify(query));

  useLayoutEffect(() => {
    const root = layoutRef.current;
    if (root === null) return undefined;
    const match = () => {
      const next = applySettingsSearch(root, query, t);
      setCounts((current) => sameCounts(current, next) ? current : next);
    };
    match();
    if (!searching || typeof MutationObserver === 'undefined') return undefined;
    // Rows that load, open or change while searching are matched as they come.
    const observer = new MutationObserver(match);
    observer.observe(root, { characterData: true, childList: true, subtree: true });
    const matchEdited = (event: Event) => {
      if (event.target !== searchRef.current) match();
    };
    root.addEventListener('input', matchEdited);
    return () => {
      observer.disconnect();
      root.removeEventListener('input', matchEdited);
    };
  }, [query, searching, t]);

  const revealCategory = (category: SettingsCategory) => {
    const layout = layoutRef.current;
    const page = layout?.closest<HTMLElement>('.main-content');
    const panel = layout?.querySelector<HTMLElement>(`#settings-panel-${category}`);
    if (page === null || page === undefined || panel === null || panel === undefined || panel.hidden) return;
    scrollUnderPageToolbar(page, panel, REVEALED_CATEGORY_GAP);
  };

  // While searching, a category shows its results rather than replacing them.
  const chooseCategory = (category: SettingsCategory) => {
    if (searching) revealCategory(category);
    else onCategoryChange(category);
  };

  const selectAndFocus = (category: SettingsCategory) => {
    chooseCategory(category);
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

  // Esc clears the search, and once it is clear leaves the box.
  const handleSearchKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    event.stopPropagation();
    if (queryText.length > 0) setQueryText('');
    else event.currentTarget.blur();
  };

  const toggleModified = () => {
    setQueryText((text) => withModifiedToken(text, !parseSettingsQuery(text).modifiedOnly));
  };

  const typedWords = withModifiedToken(queryText, false).trim();
  const noMatchMessage = typedWords.length === 0
    ? t('settings.search.no-modified')
    : t(
      query.modifiedOnly ? 'settings.search.no-modified-results' : 'settings.search.no-results',
      { query: typedWords }
    );

  const content: Record<SettingsCategory, ReactNode> = {
    general: (
      <GeneralSettingsPanel
        onChange={onGeneralSettingsChange}
        saveError={generalSettingsSaveError}
        saving={generalSettingsSaving}
        settings={generalSettings}
      />
    ),
    appearance: (
      <AppearanceSettingsPanel
        active={activeCategory === 'appearance' || searching}
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
    ),
    mods: <ModsSettingsPanel active={activeCategory === 'mods' || searching} />,
    providers: (
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
    ),
    environment: (
      <DeveloperEnvironmentPanel
        onOpenNodeDownload={onOpenNodeDownload}
        onRefresh={onRefreshEnvironment}
        refreshing={environmentRefreshing}
        status={environmentStatus}
      />
    ),
    launch: catalogReady ? (
      <LaunchSettingsPanel
        enabledProviders={generalSettings.enabledProviders}
        profiles={profiles}
        sessions={sessions}
        workspaces={workspaces}
      />
    ) : null,
    security: catalogReady ? (
      <WorkspaceTrustPanel
        onSettingsChange={onGeneralSettingsChange}
        saving={generalSettingsSaving}
        settings={generalSettings}
        workspaces={workspaces}
      />
    ) : null,
    keyboard: (
      <KeyboardShortcutsPanel
        onChange={onKeyboardSettingsChange}
        platform={platform}
      />
    ),
    transfer: (
      <SessionTransferPanel
        active={activeCategory === 'transfer' || searching}
        onImportCompleted={onSessionImportCompleted}
        providerScan={
          providerStatus.state === 'ready' ? providerStatus.scan : null
        }
        runningSessionIds={runningSessionIds}
        sessions={sessions}
        workspaces={workspaces}
      />
    ),
    // Sampling stays with the tab; a search only needs the storage rows.
    diagnostics: (
      <DiagnosticsPanel
        active={activeCategory === 'diagnostics'}
        searching={searching}
      />
    ),
    about: <AboutPanel active={activeCategory === 'about'} />
  };

  return (
    <SettingsSearchingContext.Provider value={searching}>
      <div
        className="settings-layout"
        data-settings-searching={searching ? '' : undefined}
        ref={layoutRef}
      >
        {/* The tabs scroll sideways, which would clip a backing of their own, so a wrapper pins them. */}
        <div className="settings-category-bar page-toolbar">
          <div className="settings-search" role="search">
            <input
              aria-label={t('settings.search.label')}
              className="settings-search-input"
              onChange={(event) => setQueryText(event.currentTarget.value)}
              onKeyDown={handleSearchKeyDown}
              placeholder={t('settings.search.placeholder')}
              ref={searchRef}
              spellCheck={false}
              type="search"
              value={queryText}
            />
            <Tooltip content={t('settings.search.modified-label')}>
              <button
                aria-pressed={query.modifiedOnly}
                className="settings-search-modified"
                onClick={toggleModified}
                type="button"
              >
                {t('settings.search.modified')}
              </button>
            </Tooltip>
          </div>
          <div
            aria-label={t('settings.categories-label')}
            className="settings-category-tabs"
            role="tablist"
          >
            {SETTINGS_CATEGORIES.map((category) => {
              const selected = activeCategory === category.id;
              const label = t(category.labelKey);
              const count = counts[category.id] ?? 0;
              return (
                <button
                  aria-controls={`settings-panel-${category.id}`}
                  aria-label={searching
                    ? t('settings.search.tab-count', { category: label, count })
                    : undefined}
                  aria-selected={selected}
                  className="settings-category-tab"
                  data-search-empty={searching && count === 0 ? '' : undefined}
                  id={`settings-tab-${category.id}`}
                  key={category.id}
                  onClick={() => chooseCategory(category.id)}
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
                  {label}
                  {searching ? (
                    <span aria-hidden="true" className="settings-category-count">{count}</span>
                  ) : null}
                </button>
              );
            })}
          </div>
        </div>

        {searching && matchCount === 0 ? (
          <div className="settings-search-empty" role="status">
            <p>{noMatchMessage}</p>
            <button
              className="secondary-button"
              onClick={() => {
                setQueryText('');
                searchRef.current?.focus();
              }}
              type="button"
            >
              {t('settings.search.clear')}
            </button>
          </div>
        ) : null}

        {SETTINGS_CATEGORIES.map((category) => (
          <section
            aria-labelledby={`settings-tab-${category.id}`}
            className="settings-category-panel"
            data-settings-category={category.id}
            hidden={searching
              ? (counts[category.id] ?? 0) === 0
              : activeCategory !== category.id}
            id={`settings-panel-${category.id}`}
            key={category.id}
            role="tabpanel"
          >
            {searching ? (
              <h2 className="settings-search-category">{t(category.labelKey)}</h2>
            ) : null}
            {content[category.id]}
          </section>
        ))}
      </div>
    </SettingsSearchingContext.Provider>
  );
}
