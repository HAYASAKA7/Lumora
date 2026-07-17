import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { KeyboardSettings } from '../../../shared/contracts';
import type { DeveloperEnvironmentStatus } from '../environment/DeveloperEnvironment';
import { SettingsView, type SettingsCategory } from './SettingsView';

vi.mock('../providers/ProviderSettings', () => ({
  ProviderSettings: ({
    environmentStatus,
    onRefresh
  }: {
    environmentStatus: DeveloperEnvironmentStatus;
    onRefresh: () => void;
  }) => (
    <>
      <button onClick={onRefresh}>Providers content</button>
      <span>Environment {environmentStatus.state}</span>
    </>
  )
}));

vi.mock('./LaunchSettingsPanel', () => ({
  LaunchSettingsPanel: () => <div>Launch content</div>
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

const KEYBOARD_SETTINGS: KeyboardSettings = {
  version: 1,
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
  onKeyboardSettingsChange?: (settings: KeyboardSettings) => void;
  onRefreshProviders?: () => void;
  environmentStatus?: DeveloperEnvironmentStatus;
}

function Harness({
  catalogReady = true,
  environmentStatus = { state: 'loading' },
  onKeyboardSettingsChange = vi.fn(),
  onRefreshProviders = vi.fn()
}: HarnessProps) {
  const [activeCategory, setActiveCategory] =
    useState<SettingsCategory>('providers');

  return (
    <SettingsView
      activeCategory={activeCategory}
      catalogReady={catalogReady}
      environmentStatus={environmentStatus}
      onCategoryChange={setActiveCategory}
      onKeyboardSettingsChange={onKeyboardSettingsChange}
      onOpenNodeDownload={vi.fn().mockResolvedValue(undefined)}
      onRefreshProviders={onRefreshProviders}
      platform="win32"
      profiles={[]}
      providerStatus={{ state: 'loading' }}
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
      'Providers',
      'Launch',
      'Security',
      'Keyboard'
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

    expect(screen.getByText('Providers content')).toBeVisible();
    expect(screen.getByText('Environment loading')).toBeVisible();
    expect(screen.getByText('Launch content')).toBeInTheDocument();
    expect(screen.getByText('Security content')).toBeInTheDocument();
    expect(screen.getByText('Keyboard content')).toBeInTheDocument();
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
    const providers = screen.getByRole('tab', { name: 'Providers' });

    providers.focus();
    expect(fireEvent.keyDown(providers, { key: 'ArrowRight' })).toBe(false);
    const launch = screen.getByRole('tab', { name: 'Launch' });
    expect(launch).toHaveFocus();
    expect(launch).toHaveAttribute('aria-selected', 'true');

    fireEvent.keyDown(launch, { key: 'Home' });
    expect(providers).toHaveFocus();
    expect(providers).toHaveAttribute('aria-selected', 'true');

    fireEvent.keyDown(providers, { key: 'ArrowLeft' });
    const keyboard = screen.getByRole('tab', { name: 'Keyboard' });
    expect(keyboard).toHaveFocus();
    expect(keyboard).toHaveAttribute('aria-selected', 'true');

    fireEvent.keyDown(keyboard, { key: 'Home' });
    expect(providers).toHaveFocus();

    fireEvent.keyDown(providers, { key: 'End' });
    expect(keyboard).toHaveFocus();
    expect(keyboard).toHaveAttribute('aria-selected', 'true');
  });

  it('keeps category wrappers while catalog-dependent content is unavailable', () => {
    render(<Harness catalogReady={false} />);

    expect(document.getElementById('settings-panel-providers')).toBeInTheDocument();
    expect(document.getElementById('settings-panel-launch')).toBeInTheDocument();
    expect(document.getElementById('settings-panel-security')).toBeInTheDocument();
    expect(document.getElementById('settings-panel-keyboard')).toBeInTheDocument();
    expect(screen.getByText('Providers content')).toBeInTheDocument();
    expect(screen.getByText('Keyboard content')).toBeInTheDocument();
    expect(screen.queryByText('Launch content')).not.toBeInTheDocument();
    expect(screen.queryByText('Security content')).not.toBeInTheDocument();
  });

  it('passes provider and keyboard changes to its callers', () => {
    const onRefreshProviders = vi.fn();
    const onKeyboardSettingsChange = vi.fn();
    render(
      <Harness
        onKeyboardSettingsChange={onKeyboardSettingsChange}
        onRefreshProviders={onRefreshProviders}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Providers content' }));
    fireEvent.click(screen.getByRole('tab', { name: 'Keyboard' }));
    fireEvent.click(screen.getByRole('button', { name: 'Keyboard content' }));

    expect(onRefreshProviders).toHaveBeenCalledOnce();
    expect(onKeyboardSettingsChange).toHaveBeenCalledWith(KEYBOARD_SETTINGS);
  });
});
