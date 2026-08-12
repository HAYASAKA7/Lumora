import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { DEFAULT_GENERAL_SETTINGS } from '../../../shared/contracts';
import { GeneralSettingsPanel } from './GeneralSettingsPanel';

describe('GeneralSettingsPanel', () => {
  it('renders every general preference and reports complete settings changes', () => {
    const onChange = vi.fn();
    render(
      <GeneralSettingsPanel
        onChange={onChange}
        saveError={null}
        saving={false}
        settings={DEFAULT_GENERAL_SETTINGS}
      />
    );

    const switches = [
      'Start with a maximized window',
      'Check provider updates automatically',
      'Auto-expand sidebar when navigating',
      'Show informational notices',
      'Show unavailable workspaces',
      'Show unusable sessions',
      'Enable cross-agent session handoff',
      'Keep Lumora running after closing the window',
      'Disconnect when a remote window closes'
    ];
    const panel = screen.getByRole('heading', { name: 'General' }).closest('section');
    const header = screen.getByRole('heading', { name: 'General' }).closest('header');
    expect(panel).toHaveClass('catalog-panel', 'general-settings-panel');
    expect(header).toHaveClass('provider-panel-header');

    const windowGroup = screen.getByRole('group', { name: 'Window behavior' });
    expect(within(windowGroup).getByRole('switch', {
      name: 'Start with a maximized window'
    })).toBeVisible();
    expect(within(windowGroup).getByRole('switch', {
      name: 'Keep Lumora running after closing the window'
    })).toBeVisible();

    const navigationGroup = screen.getByRole('group', { name: 'Sidebar and notices' });
    expect(within(navigationGroup).getByRole('switch', {
      name: 'Auto-expand sidebar when navigating'
    })).toBeVisible();
    expect(within(navigationGroup).getByRole('switch', {
      name: 'Show informational notices'
    })).toBeVisible();

    const catalogGroup = screen.getByRole('group', { name: 'Catalog visibility' });
    expect(within(catalogGroup).getByRole('switch', {
      name: 'Show unavailable workspaces'
    })).toBeVisible();
    expect(within(catalogGroup).getByRole('switch', {
      name: 'Show unusable sessions'
    })).toBeVisible();

    expect(within(screen.getByRole('group', { name: 'Provider maintenance' })).getByRole(
      'switch',
      { name: 'Check provider updates automatically' }
    )).toBeVisible();
    expect(within(screen.getByRole('group', { name: 'Remote behavior' })).getByRole(
      'switch',
      { name: 'Disconnect when a remote window closes' }
    )).toBeVisible();

    const handoffGroup = screen.getByRole('group', { name: 'Cross-agent handoff' });
    expect(within(handoffGroup).getByRole('switch', {
      name: 'Enable cross-agent session handoff'
    })).toBeVisible();
    expect(within(handoffGroup).getByRole('button', {
      name: 'Temporary handoff retention'
    })).toBeDisabled();

    for (const name of switches.slice(0, 6)) {
      expect(screen.getByRole('switch', { name })).toBeChecked();
    }
    expect(screen.getByRole('switch', {
      name: 'Enable cross-agent session handoff'
    })).not.toBeChecked();
    expect(screen.getByRole('switch', {
      name: 'Keep Lumora running after closing the window'
    })).not.toBeChecked();
    expect(screen.getByRole('switch', {
      name: 'Disconnect when a remote window closes'
    })).not.toBeChecked();
    expect(screen.getByRole('button', {
      name: 'Temporary handoff retention'
    })).toBeDisabled();
    expect(
      screen.getByText(
        'Display non-critical diagnostics and helpful guidance throughout Lumora.'
      )
    ).toBeVisible();

    fireEvent.click(
      screen.getByRole('switch', {
        name: 'Check provider updates automatically'
      })
    );
    expect(onChange).toHaveBeenCalledWith({
      ...DEFAULT_GENERAL_SETTINGS,
      checkProviderUpdatesAutomatically: false
    });

    fireEvent.click(screen.getByRole('switch', {
      name: 'Show unavailable workspaces'
    }));
    expect(onChange).toHaveBeenCalledWith({
      ...DEFAULT_GENERAL_SETTINGS,
      showUnavailableWorkspaces: false
    });

    fireEvent.click(screen.getByRole('switch', {
      name: 'Enable cross-agent session handoff'
    }));
    expect(onChange).toHaveBeenCalledWith({
      ...DEFAULT_GENERAL_SETTINGS,
      crossAgentWorkflowEnabled: true
    });

    fireEvent.click(screen.getByRole('switch', {
      name: 'Keep Lumora running after closing the window'
    }));
    expect(onChange).toHaveBeenCalledWith({
      ...DEFAULT_GENERAL_SETTINGS,
      windowCloseBehavior: 'hide_to_tray'
    });

    fireEvent.click(screen.getByRole('switch', {
      name: 'Disconnect when a remote window closes'
    }));
    expect(onChange).toHaveBeenCalledWith({
      ...DEFAULT_GENERAL_SETTINGS,
      remoteWindowCloseBehavior: 'disconnect'
    });
  });

  it('disables the switch while saving and displays an unsuppressible error', () => {
    render(
      <GeneralSettingsPanel
        onChange={vi.fn()}
        saveError="Lumora could not save this setting."
        saving
        settings={{
          ...DEFAULT_GENERAL_SETTINGS,
          showInformationalNotices: false
        }}
      />
    );

    for (const toggle of screen.getAllByRole('switch')) {
      expect(toggle).toBeDisabled();
    }
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Lumora could not save this setting.'
    );
  });
});
