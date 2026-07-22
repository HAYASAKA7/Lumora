import { fireEvent, render, screen } from '@testing-library/react';
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
      'Show informational notices'
    ];
    const panel = screen.getByRole('heading', { name: 'General' }).closest('section');
    const header = screen.getByRole('heading', { name: 'General' }).closest('header');
    expect(panel).toHaveClass('catalog-panel', 'general-settings-panel');
    expect(header).toHaveClass('provider-panel-header');
    for (const name of switches) {
      expect(screen.getByRole('switch', { name })).toBeChecked();
    }
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
