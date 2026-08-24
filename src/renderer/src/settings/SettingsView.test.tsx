import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import {
  DEFAULT_GENERAL_SETTINGS,
  DEFAULT_KEYBOARD_SETTINGS
} from '../../../shared/contracts';
import type {
  KeyboardSettings,
  ProviderId
} from '../../../shared/contracts';
import type { DeveloperEnvironmentStatus } from '../environment/DeveloperEnvironment';
import { SettingsView, type SettingsCategory } from './SettingsView';

vi.mock('../providers/ProviderSettings', () => ({
  ProviderSettings: ({ onRefresh }: { onRefresh: () => void }) => (
    <button onClick={onRefresh}>Providers content</button>
  )
}));

vi.mock('../environment/DeveloperEnvironment', () => ({
  DeveloperEnvironmentPanel: ({
    onRefresh,
    status
  }: {
    onRefresh: () => void;
    status: DeveloperEnvironmentStatus;
  }) => (
    <button onClick={onRefresh}>Environment {status.state}</button>
  )
}));

vi.mock('./LaunchSettingsPanel', () => ({
  LaunchSettingsPanel: () => <div>Launch content</div>
}));

vi.mock('./GeneralSettingsPanel', () => ({
  GeneralSettingsPanel: ({
    onChange
  }: {
    onChange(value: typeof DEFAULT_GENERAL_SETTINGS): void;
  }) => (
    <button onClick={() => onChange({
      ...DEFAULT_GENERAL_SETTINGS,
      showInformationalNotices: false
    })}>
      General content
    </button>
  )
}));

vi.mock('./AppearanceSettingsPanel', () => ({
  AppearanceSettingsPanel: () => <div>Appearance content</div>
}));

vi.mock('./WorkspaceTrustPanel', () => ({
  WorkspaceTrustPanel: () => <div>Security content</div>
}));

vi.mock('./KeyboardShortcutsPanel', () => ({
  KeyboardShortcutsPanel: ({
    onChange
  }: {
    onChange: (settings: KeyboardSettings) => void;
  }) => <button onClick={() => onChange(KEYBOARD_SETTINGS)}>Keyboard content</button>
}));

vi.mock('../transfer/SessionTransferPanel', () => ({
  SessionTransferPanel: ({
    active,
    onImportCompleted
  }: {
    active: boolean;
    onImportCompleted(): Promise<unknown> | unknown;
  }) => (
    <button
      data-active={String(active)}
      onClick={() => void onImportCompleted()}
      type="button"
    >
      Transfer content
    </button>
  )
}));

vi.mock('./DiagnosticsPanel', () => ({
  DiagnosticsPanel: ({ active }: { active: boolean }) => (
    <div data-active={String(active)}>Diagnostics content</div>
  )
}));

vi.mock('./AboutPanel', () => ({
  AboutPanel: ({ active }: { active: boolean }) => (
    <div data-active={String(active)}>About content</div>
  )
}));

const KEYBOARD_SETTINGS: KeyboardSettings = {
  ...DEFAULT_KEYBOARD_SETTINGS,
  terminalSwitcher: {
    code: 'Tab',
    control: true,
    alt: false,
    shift: false,
    meta: false
  }
};

interface HarnessProps {
  catalogReady?: boolean;
  onGeneralSettingsChange?: (value: typeof DEFAULT_GENERAL_SETTINGS) => void;
  onKeyboardSettingsChange?: (settings: KeyboardSettings) => void;
  onRefreshEnvironment?: () => void;
  onRefreshProviders?: () => void;
  onSessionImportCompleted?: () => Promise<unknown> | unknown;
  onSaveEnabledProviders?: (providers: readonly ProviderId[]) => Promise<boolean>;
  environmentStatus?: DeveloperEnvironmentStatus;
}

function Harness({
  catalogReady = true,
  environmentStatus = { state: 'loading' },
  onGeneralSettingsChange = vi.fn(),
  onKeyboardSettingsChange = vi.fn(),
  onRefreshEnvironment = vi.fn(),
  onRefreshProviders = vi.fn(),
  onSessionImportCompleted = vi.fn(),
  onSaveEnabledProviders = vi.fn().mockResolvedValue(true)
}: HarnessProps) {
  const [activeCategory, setActiveCategory] =
    useState<SettingsCategory>('general');

  return (
    <SettingsView
      activeCategory={activeCategory}
      appearanceBackground={{ available: false, revision: null }}
      appearanceBackgroundBusy={false}
      appearanceBackgroundError={null}
      catalogReady={catalogReady}
      environmentStatus={environmentStatus}
      generalSettings={DEFAULT_GENERAL_SETTINGS}
      generalSettingsSaveError={null}
      generalSettingsSaving={false}
      onCategoryChange={setActiveCategory}
      onChooseAppearanceBackground={vi.fn()}
      onGeneralSettingsChange={onGeneralSettingsChange}
      onKeyboardSettingsChange={onKeyboardSettingsChange}
      onOpenNodeDownload={vi.fn().mockResolvedValue(undefined)}
      onRemoveAppearanceBackground={vi.fn()}
      onRefreshEnvironment={onRefreshEnvironment}
      onRefreshProviderUpdates={vi.fn().mockResolvedValue(undefined)}
      onRefreshProviders={onRefreshProviders}
      onSaveEnabledProviders={onSaveEnabledProviders}
      onSessionImportCompleted={onSessionImportCompleted}
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

describe('SettingsView', () => {
  it('selects Providers and keeps every ready category mounted', () => {
    render(<Harness />);

    const tabs = screen.getAllByRole('tab');
    expect(tabs.map((tab) => tab.textContent)).toEqual([
      'General',
      'Appearance',
      'Providers',
      'Environment',
      'Launch',
      'Security',
      'Keyboard',
      'Transfer',
      'Diagnostics',
      'About'
    ]);
    expect(screen.getByRole('tablist')).toHaveAccessibleName(
      'Settings categories'
    );

    for (const [index, tab] of tabs.entries()) {
      const category = tab.textContent?.toLowerCase();
      const panel = document.getElementById(`settings-panel-${category}`);
      expect(tab).toHaveAttribute('id', `settings-tab-${category}`);
      expect(tab).toHaveAttribute('aria-controls', `settings-panel-${category}`);
      expect(panel).toHaveAttribute('role', 'tabpanel');
      expect(panel).toHaveAttribute('aria-labelledby', `settings-tab-${category}`);
      expect(tab).toHaveAttribute('aria-selected', String(index === 0));
      expect(tab).toHaveAttribute('tabindex', index === 0 ? '0' : '-1');
      expect(panel).toHaveProperty('hidden', index !== 0);
    }

    expect(screen.getByText('General content')).toBeVisible();
    expect(screen.getByText('Appearance content')).toBeInTheDocument();
    expect(screen.getByText('Providers content')).toBeInTheDocument();
    expect(screen.getByText('Environment loading')).toBeInTheDocument();
    expect(screen.getByText('Launch content')).toBeInTheDocument();
    expect(screen.getByText('Security content')).toBeInTheDocument();
    expect(screen.getByText('Keyboard content')).toBeInTheDocument();
    expect(screen.getByText('Transfer content')).toBeInTheDocument();
    expect(screen.getByText('Diagnostics content')).toBeInTheDocument();
    expect(screen.getByText('About content')).toBeInTheDocument();
  });

  it('changes the visible category when a tab is clicked', () => {
    render(<Harness />);

    fireEvent.click(screen.getByRole('tab', { name: 'Launch' }));

    expect(screen.getByRole('tab', { name: 'Launch' })).toHaveAttribute(
      'aria-selected',
      'true'
    );
    expect(document.getElementById('settings-panel-launch')).not.toHaveAttribute(
      'hidden'
    );
    expect(document.getElementById('settings-panel-providers')).toHaveAttribute(
      'hidden'
    );
  });

  it('cycles with arrow keys and supports Home and End', () => {
    render(<Harness />);
    const general = screen.getByRole('tab', { name: 'General' });

    general.focus();
    expect(fireEvent.keyDown(general, { key: 'ArrowRight' })).toBe(false);
    const appearance = screen.getByRole('tab', { name: 'Appearance' });
    expect(appearance).toHaveFocus();
    expect(appearance).toHaveAttribute('aria-selected', 'true');

    fireEvent.keyDown(appearance, { key: 'Home' });
    expect(general).toHaveFocus();
    expect(general).toHaveAttribute('aria-selected', 'true');

    fireEvent.keyDown(general, { key: 'ArrowLeft' });
    const about = screen.getByRole('tab', { name: 'About' });
    expect(about).toHaveFocus();
    expect(about).toHaveAttribute('aria-selected', 'true');

    fireEvent.keyDown(about, { key: 'Home' });
    expect(general).toHaveFocus();

    fireEvent.keyDown(general, { key: 'End' });
    expect(about).toHaveFocus();
    expect(about).toHaveAttribute('aria-selected', 'true');
  });

  it('keeps category wrappers while catalog-dependent content is unavailable', () => {
    render(<Harness catalogReady={false} />);

    expect(document.getElementById('settings-panel-providers')).toBeInTheDocument();
    expect(document.getElementById('settings-panel-general')).toBeInTheDocument();
    expect(document.getElementById('settings-panel-appearance')).toBeInTheDocument();
    expect(document.getElementById('settings-panel-environment')).toBeInTheDocument();
    expect(document.getElementById('settings-panel-launch')).toBeInTheDocument();
    expect(document.getElementById('settings-panel-security')).toBeInTheDocument();
    expect(document.getElementById('settings-panel-keyboard')).toBeInTheDocument();
    expect(document.getElementById('settings-panel-transfer')).toBeInTheDocument();
    expect(document.getElementById('settings-panel-diagnostics')).toBeInTheDocument();
    expect(document.getElementById('settings-panel-about')).toBeInTheDocument();
    expect(screen.getByText('Providers content')).toBeInTheDocument();
    expect(screen.getByText('General content')).toBeInTheDocument();
    expect(screen.getByText('Appearance content')).toBeInTheDocument();
    expect(screen.getByText('Keyboard content')).toBeInTheDocument();
    expect(screen.getByText('Transfer content')).toBeInTheDocument();
    expect(screen.getByText('Diagnostics content')).toBeInTheDocument();
    expect(screen.getByText('About content')).toBeInTheDocument();
    expect(screen.queryByText('Launch content')).not.toBeInTheDocument();
    expect(screen.queryByText('Security content')).not.toBeInTheDocument();
  });

  it('activates Session Transfer lazily and passes completed imports upward', () => {
    const onSessionImportCompleted = vi.fn().mockResolvedValue(undefined);
    render(<Harness onSessionImportCompleted={onSessionImportCompleted} />);

    const transferContent = screen.getByText('Transfer content');
    expect(transferContent).toHaveAttribute('data-active', 'false');

    fireEvent.click(screen.getByRole('tab', { name: 'Transfer' }));
    expect(transferContent).toHaveAttribute('data-active', 'true');
    fireEvent.click(transferContent);

    expect(onSessionImportCompleted).toHaveBeenCalledOnce();
  });
  it('passes provider and keyboard changes to its callers', () => {
    const onRefreshProviders = vi.fn();
    const onRefreshEnvironment = vi.fn();
    const onKeyboardSettingsChange = vi.fn();
    const onGeneralSettingsChange = vi.fn();
    render(
      <Harness
        onKeyboardSettingsChange={onKeyboardSettingsChange}
        onGeneralSettingsChange={onGeneralSettingsChange}
        onRefreshEnvironment={onRefreshEnvironment}
        onRefreshProviders={onRefreshProviders}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'General content' }));
    fireEvent.click(screen.getByRole('tab', { name: 'Providers' }));
    fireEvent.click(screen.getByRole('button', { name: 'Providers content' }));
    fireEvent.click(screen.getByRole('tab', { name: 'Environment' }));
    fireEvent.click(screen.getByRole('button', { name: 'Environment loading' }));
    fireEvent.click(screen.getByRole('tab', { name: 'Keyboard' }));
    fireEvent.click(screen.getByRole('button', { name: 'Keyboard content' }));

    expect(onGeneralSettingsChange).toHaveBeenCalledWith({
      ...DEFAULT_GENERAL_SETTINGS,
      showInformationalNotices: false
    });
    expect(onRefreshProviders).toHaveBeenCalledOnce();
    expect(onRefreshEnvironment).toHaveBeenCalledOnce();
    expect(onKeyboardSettingsChange).toHaveBeenCalledWith(KEYBOARD_SETTINGS);
  });
});
