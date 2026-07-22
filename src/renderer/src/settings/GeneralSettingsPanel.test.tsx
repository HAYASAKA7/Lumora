import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { DEFAULT_GENERAL_SETTINGS } from '../../../shared/contracts';
import { GeneralSettingsPanel } from './GeneralSettingsPanel';

describe('GeneralSettingsPanel', () => {
  it('renders an accessible enabled switch and reports changes', () => {
    const onChange = vi.fn();
    render(
      <GeneralSettingsPanel
        onShowInformationalNoticesChange={onChange}
        saveError={null}
        saving={false}
        settings={DEFAULT_GENERAL_SETTINGS}
      />
    );

    const toggle = screen.getByRole('switch', {
      name: 'Show informational notices'
    });
    const panel = screen.getByRole('heading', { name: 'General' }).closest('section');
    const header = screen.getByRole('heading', { name: 'General' }).closest('header');
    expect(panel).toHaveClass('catalog-panel', 'general-settings-panel');
    expect(header).toHaveClass('provider-panel-header');
    expect(toggle).toBeChecked();
    expect(
      screen.getByText(
        'Display non-critical diagnostics and helpful guidance throughout Lumora.'
      )
    ).toBeVisible();

    fireEvent.click(toggle);
    expect(onChange).toHaveBeenCalledWith(false);
  });

  it('disables the switch while saving and displays an unsuppressible error', () => {
    render(
      <GeneralSettingsPanel
        onShowInformationalNoticesChange={vi.fn()}
        saveError="Lumora could not save this setting."
        saving
        settings={{
          version: 1,
          showInformationalNotices: false
        }}
      />
    );

    expect(
      screen.getByRole('switch', { name: 'Show informational notices' })
    ).toBeDisabled();
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Lumora could not save this setting.'
    );
  });
});
