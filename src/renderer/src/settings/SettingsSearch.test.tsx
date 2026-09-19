import { useState } from 'react';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { DEFAULT_GENERAL_SETTINGS } from '../../../shared/contracts';
import { requestFocusSearch } from '../keyboard/page-requests';
import {
  renderWithLocalization,
  TEST_LOCALIZATION_SNAPSHOT
} from '../test/render-with-localization';
import { SettingsView, type SettingsCategory } from './SettingsView';

/*
 * General is the real panel. The others stand in with a few marked rows each,
 * enough to show how search treats a category.
 */
vi.mock('./AppearanceSettingsPanel', () => ({
  AppearanceSettingsPanel: () => (
    <div data-setting="settings.appearance.color-theme" data-setting-modified="">
      <strong>Color theme</strong>
      <button type="button">Midnight</button>
    </div>
  )
}));

vi.mock('./KeyboardShortcutsPanel', () => ({
  KeyboardShortcutsPanel: () => (
    <div>
      <div data-setting="settings.shortcuts.focus-search">
        <strong>Focus search</strong>
        <button type="button">Ctrl + F</button>
      </div>
      <div data-setting-companion="">
        <button type="button">Save shortcuts</button>
      </div>
    </div>
  )
}));

// Its rows come only once it is asked to load, as the real one's do.
vi.mock('./ModsSettingsPanel', () => ({
  ModsSettingsPanel: ({ active }: { active: boolean }) => active ? (
    <div data-setting="settings.mods.root-label">
      <strong>Mods folder</strong>
      <code>D:/Lumora/mods</code>
    </div>
  ) : (
    <p role="status">Loading mods</p>
  )
}));

vi.mock('../providers/ProviderSettings', () => ({
  ProviderSettings: () => (
    <article data-setting="providers.settings.installations">
      <h4>Codex</h4>
    </article>
  )
}));

vi.mock('../environment/DeveloperEnvironment', () => ({
  DeveloperEnvironmentPanel: () => <div>Environment content</div>
}));
vi.mock('./LaunchSettingsPanel', () => ({
  LaunchSettingsPanel: () => <div>Launch content</div>
}));
vi.mock('./WorkspaceTrustPanel', () => ({
  WorkspaceTrustPanel: () => <div>Security content</div>
}));
vi.mock('../transfer/SessionTransferPanel', () => ({
  SessionTransferPanel: () => <div>Transfer content</div>
}));
vi.mock('./DiagnosticsPanel', () => ({
  DiagnosticsPanel: () => <div>Diagnostics content</div>
}));
vi.mock('./AboutPanel', () => ({
  AboutPanel: () => <div>About content</div>
}));

function Harness() {
  const [activeCategory, setActiveCategory] = useState<SettingsCategory>('general');
  return (
    <SettingsView
      activeCategory={activeCategory}
      appearanceBackground={{ available: false, revision: null }}
      appearanceBackgroundBusy={false}
      appearanceBackgroundError={null}
      catalogReady
      environmentStatus={{ state: 'loading' }}
      generalSettings={DEFAULT_GENERAL_SETTINGS}
      generalSettingsSaveError={null}
      generalSettingsSaving={false}
      onCategoryChange={setActiveCategory}
      onChooseAppearanceBackground={vi.fn()}
      onGeneralSettingsChange={vi.fn()}
      onKeyboardSettingsChange={vi.fn()}
      onOpenNodeDownload={vi.fn().mockResolvedValue(undefined)}
      onRemoveAppearanceBackground={vi.fn()}
      onRefreshEnvironment={vi.fn()}
      onRefreshProviderUpdates={vi.fn().mockResolvedValue(undefined)}
      onRefreshProviders={vi.fn()}
      onSaveEnabledProviders={vi.fn().mockResolvedValue(true)}
      onSessionImportCompleted={vi.fn()}
      platform="win32"
      profiles={[]}
      providerStatus={{ state: 'loading' }}
      providerUpdatesRefreshing={false}
      providerUpdatesStatus={{ state: 'idle' }}
      runningSessionIds={new Set<string>()}
      sessions={[]}
      workspaces={[]}
    />
  );
}

function search(): HTMLInputElement {
  return screen.getByRole('searchbox', { name: 'Search settings' });
}

function type(text: string): void {
  fireEvent.change(search(), { target: { value: text } });
}

function panel(category: SettingsCategory): HTMLElement {
  return document.getElementById(`settings-panel-${category}`)!;
}

function tab(category: SettingsCategory): HTMLElement {
  return document.getElementById(`settings-tab-${category}`)!;
}

/** The rows a search shows, by their marker. */
function shown(): string[] {
  return [...document.querySelectorAll<HTMLElement>('[data-setting]:not([data-search-miss])')]
    .filter((row) => !row.closest<HTMLElement>('.settings-category-panel')!.hidden)
    .map((row) => row.dataset.setting!);
}

describe('Search in Settings', () => {
  it('shows the matching settings of every category under its heading and counts them on the tabs', () => {
    renderWithLocalization(<Harness />);

    type('focus');

    expect(shown()).toEqual(['settings.shortcuts.focus-search']);
    expect(panel('keyboard')).not.toHaveAttribute('hidden');
    expect(panel('general')).toHaveAttribute('hidden');
    expect(screen.getByRole('heading', { name: 'Keyboard' })).toBeInTheDocument();
    expect(tab('keyboard')).toHaveAttribute('aria-label', 'Keyboard, 1 match');
    expect(tab('general')).toHaveAttribute('aria-label', 'General, 0 matches');
    expect(tab('general')).toHaveAttribute('data-search-empty');
    // What belongs with the rows stays with them.
    expect(screen.getByRole('button', { name: 'Save shortcuts' })).toBeInTheDocument();
  });

  it('finds a setting by its English name while Lumora is in another language', () => {
    renderWithLocalization(<Harness />, {
      ...TEST_LOCALIZATION_SNAPSHOT,
      locale: 'ja',
      formattingLocale: 'ja-JP',
      messages: {
        ...TEST_LOCALIZATION_SNAPSHOT.messages,
        'settings.general.start-maximized': '最大化したウィンドウで起動'
      }
    });

    type('maximized window');

    expect(shown()).toEqual(['settings.general.start-maximized']);
    expect(screen.getByText('最大化したウィンドウで起動')).toBeInTheDocument();
  });

  it('finds a setting by what it is set to, a provider by name and a shortcut by its keys', () => {
    renderWithLocalization(<Harness />);

    type('midnight');
    expect(shown()).toEqual(['settings.appearance.color-theme']);

    type('codex');
    expect(shown()).toEqual(['providers.settings.installations']);

    type('ctrl+f');
    expect(shown()).toEqual(['settings.shortcuts.focus-search']);
  });

  it('finds every setting of a group by the group title', () => {
    renderWithLocalization(<Harness />);

    type('window behavior');

    // The whole Window behavior group, whatever else also mentions both words.
    expect(shown()).toEqual(expect.arrayContaining([
      'settings.general.start-maximized',
      'settings.general.close-behavior',
      'settings.general.warn-quit'
    ]));
  });

  it('shows only changed settings from the toggle or @modified and keeps the two in step', () => {
    renderWithLocalization(<Harness />);
    const modified = screen.getByRole('button', { name: 'Modified' });

    fireEvent.click(modified);
    expect(search()).toHaveValue('@modified ');
    expect(modified).toHaveAttribute('aria-pressed', 'true');
    // Every General setting is at its default here.
    expect(shown()).toEqual(['settings.appearance.color-theme']);

    type('@modified theme');
    expect(shown()).toEqual(['settings.appearance.color-theme']);
    type('@modified sidebar');
    expect(shown()).toEqual([]);

    fireEvent.click(modified);
    expect(search()).toHaveValue('sidebar');
    expect(modified).toHaveAttribute('aria-pressed', 'false');

    type('theme @modified');
    expect(modified).toHaveAttribute('aria-pressed', 'true');
  });

  it('brings a category forward from its tab while searching and returns to the one left when cleared', () => {
    renderWithLocalization(<Harness />);
    type('focus');

    fireEvent.click(tab('keyboard'));
    type('');

    // The tab showed results; it did not switch away from General.
    expect(panel('general')).not.toHaveAttribute('hidden');
    expect(panel('keyboard')).toHaveAttribute('hidden');
    expect(tab('general')).toHaveAttribute('aria-selected', 'true');
    expect(document.querySelectorAll('[data-search-miss]')).toHaveLength(0);
    expect(screen.queryByRole('heading', { name: 'Keyboard' })).not.toBeInTheDocument();
  });

  it('says when nothing matches and clears from there', () => {
    renderWithLocalization(<Harness />);

    type('zzzz');
    expect(screen.getByRole('status')).toHaveTextContent('No settings match “zzzz”.');

    fireEvent.click(screen.getByRole('button', { name: 'Clear search' }));
    expect(search()).toHaveValue('');
    expect(search()).toHaveFocus();
    expect(panel('general')).not.toHaveAttribute('hidden');
  });

  it('clears the search with Esc and leaves the box with the next', () => {
    renderWithLocalization(<Harness />);
    search().focus();
    type('focus');

    fireEvent.keyDown(search(), { key: 'Escape' });
    expect(search()).toHaveValue('');
    expect(search()).toHaveFocus();

    fireEvent.keyDown(search(), { key: 'Escape' });
    expect(search()).not.toHaveFocus();
  });

  it('asks a panel that loads on request for its rows and matches them as they arrive', async () => {
    renderWithLocalization(<Harness />);
    expect(screen.getByText('Loading mods')).toBeInTheDocument();

    type('mods folder');

    await waitFor(() => expect(shown()).toEqual(['settings.mods.root-label']));
    expect(tab('mods')).toHaveAttribute('aria-label', 'Mods, 1 match');
  });

  it('puts the cursor in the search from the search shortcut', async () => {
    renderWithLocalization(<Harness />);
    type('focus');
    fireEvent.blur(search());
    search().blur();

    await act(async () => undefined);
    act(() => {
      expect(requestFocusSearch()).toBe(true);
    });

    expect(search()).toHaveFocus();
    // Selected, so the next keystroke starts a new search.
    expect(search().selectionStart).toBe(0);
    expect(search().selectionEnd).toBe('focus'.length);
  });
});
