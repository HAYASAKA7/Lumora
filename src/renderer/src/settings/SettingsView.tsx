import { useRef, type KeyboardEvent } from 'react';

import type {
  KeyboardSettings,
  SessionSummary,
  SystemInfo,
  TerminalProfile,
  WorkspaceSummary
} from '../../../shared/contracts';
import {
  ProviderSettings,
  type ProviderScanStatus
} from '../providers/ProviderSettings';
import {
  DeveloperEnvironmentPanel,
  type DeveloperEnvironmentStatus
} from '../environment/DeveloperEnvironment';
import { KeyboardShortcutsPanel } from './KeyboardShortcutsPanel';
import { LaunchSettingsPanel } from './LaunchSettingsPanel';
import { WorkspaceTrustPanel } from './WorkspaceTrustPanel';

export type SettingsCategory =
  | 'providers'
  | 'environment'
  | 'launch'
  | 'security'
  | 'keyboard';

interface SettingsViewProps {
  activeCategory: SettingsCategory;
  catalogReady: boolean;
  environmentStatus: DeveloperEnvironmentStatus;
  onCategoryChange: (category: SettingsCategory) => void;
  onKeyboardSettingsChange: (settings: KeyboardSettings) => void;
  onOpenNodeDownload: () => Promise<void>;
  onRefreshEnvironment: () => void;
  onRefreshProviders: () => void;
  platform: SystemInfo['platform'];
  profiles: readonly TerminalProfile[];
  providerStatus: ProviderScanStatus;
  sessions: readonly SessionSummary[];
  workspaces: readonly WorkspaceSummary[];
}

const SETTINGS_CATEGORIES = [
  { id: 'providers', label: 'Providers' },
  { id: 'environment', label: 'Environment' },
  { id: 'launch', label: 'Launch' },
  { id: 'security', label: 'Security' },
  { id: 'keyboard', label: 'Keyboard' }
] as const;

export function SettingsView({
  activeCategory,
  catalogReady,
  environmentStatus,
  onCategoryChange,
  onKeyboardSettingsChange,
  onOpenNodeDownload,
  onRefreshEnvironment,
  onRefreshProviders,
  platform,
  profiles,
  providerStatus,
  sessions,
  workspaces
}: SettingsViewProps) {
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
        aria-label="Settings categories"
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
              {category.label}
            </button>
          );
        })}
      </div>

      <section
        aria-labelledby="settings-tab-providers"
        className="settings-category-panel"
        hidden={activeCategory !== 'providers'}
        id="settings-panel-providers"
        role="tabpanel"
      >
        <ProviderSettings
          onRefresh={onRefreshProviders}
          status={providerStatus}
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
        {catalogReady ? <WorkspaceTrustPanel workspaces={workspaces} /> : null}
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
    </div>
  );
}
