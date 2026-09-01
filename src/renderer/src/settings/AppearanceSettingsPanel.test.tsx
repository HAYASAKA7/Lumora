import { fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import {
  DEFAULT_GENERAL_SETTINGS,
  type LumoraApi
} from '../../../shared/contracts';
import { AppearanceSettingsPanel } from './AppearanceSettingsPanel';
import { renderWithLocalization } from '../test/render-with-localization';

const render = renderWithLocalization;

describe('AppearanceSettingsPanel', () => {
  it('applies a validated theme Mod and can return to a built-in theme', () => {
    const onChange = vi.fn();
    const themePresets = {
      presets: [{
        id: 'midnight-cyan',
        displayName: 'Midnight cyan',
        baseTheme: 'dark' as const,
        palette: {
          accent: '#22D3EE', onAccent: '#06202A', background: '#07111F',
          sidebar: '#081525', sidebarText: '#E6F7FF', surface: '#102033',
          surfaceRaised: '#172A40', control: '#1C334D', text: '#F3FAFF',
          textMuted: '#9CB2C8', border: '#39536D', success: '#41D6A3',
          warning: '#F2BE5C', danger: '#F4778A'
        }
      }],
      rejectedCount: 0
    };
    render(
      <AppearanceSettingsPanel
        background={{ available: false, revision: null }}
        backgroundBusy={false}
        backgroundError={null}
        onChange={onChange}
        onChooseBackground={vi.fn()}
        onRefreshThemePresets={vi.fn()}
        onRemoveBackground={vi.fn()}
        saveError={null}
        saving={false}
        settings={DEFAULT_GENERAL_SETTINGS}
        themePresets={themePresets}
        themePresetsBusy={false}
        themePresetsError={false}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Theme pack' }));
    fireEvent.click(screen.getByRole('option', { name: 'Midnight cyan' }));
    expect(screen.getByLabelText('Midnight cyan color preview').children)
      .toHaveLength(5);
    fireEvent.click(screen.getByRole('button', { name: 'Apply theme pack' }));
    expect(onChange).toHaveBeenLastCalledWith({
      ...DEFAULT_GENERAL_SETTINGS,
      appearance: {
        ...DEFAULT_GENERAL_SETTINGS.appearance,
        theme: 'dark',
        themePresetId: 'midnight-cyan'
      }
    });

    fireEvent.click(screen.getByDisplayValue('light'));
    expect(onChange).toHaveBeenLastCalledWith({
      ...DEFAULT_GENERAL_SETTINGS,
      appearance: {
        ...DEFAULT_GENERAL_SETTINGS.appearance,
        theme: 'light',
        themePresetId: null
      }
    });
  });

  it('commits independent font drafts and applies data-only Mod presets', async () => {
    const onChange = vi.fn();
    const api = {
      getFontPresets: vi.fn().mockResolvedValue({
        presets: [{
          id: 'readable',
          displayName: 'Readable pair',
          interfaceFontFamily: 'Atkinson Hyperlegible',
          terminalFontFamily: 'JetBrains Mono'
        }],
        rejectedCount: 0
      })
    } as unknown as LumoraApi;
    render(
      <AppearanceSettingsPanel
        active
        api={api}
        background={{ available: false, revision: null }}
        backgroundBusy={false}
        backgroundError={null}
        onChange={onChange}
        onChooseBackground={vi.fn()}
        onRemoveBackground={vi.fn()}
        saveError={null}
        saving={false}
        settings={DEFAULT_GENERAL_SETTINGS}
      />
    );

    const interfaceFont = screen.getByRole('textbox', { name: 'Interface font' });
    fireEvent.change(interfaceFont, { target: { value: 'Segoe UI Variable' } });
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.blur(interfaceFont);
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({
      appearance: expect.objectContaining({
        interfaceFontFamily: 'Segoe UI Variable',
        terminalFontFamily: null
      })
    }));

    await waitFor(() => expect(api.getFontPresets).toHaveBeenCalledOnce());
    fireEvent.click(screen.getByRole('button', { name: 'Font preset' }));
    fireEvent.click(screen.getByRole('option', { name: 'Readable pair' }));
    fireEvent.click(screen.getByRole('button', { name: 'Apply font preset' }));
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({
      appearance: expect.objectContaining({
        interfaceFontFamily: 'Atkinson Hyperlegible',
        terminalFontFamily: 'JetBrains Mono'
      })
    }));

    fireEvent.click(screen.getByRole('button', { name: 'Refresh font presets' }));
    await waitFor(() => expect(api.getFontPresets).toHaveBeenCalledTimes(2));
  });

  it('offers Lumora mixed as the default without a System theme option', () => {
    render(
      <AppearanceSettingsPanel
        background={{ available: false, revision: null }}
        backgroundBusy={false}
        backgroundError={null}
        onChange={vi.fn()}
        onChooseBackground={vi.fn()}
        onRemoveBackground={vi.fn()}
        saveError={null}
        saving={false}
        settings={DEFAULT_GENERAL_SETTINGS}
      />
    );

    expect(screen.getByRole('radio', { name: /Lumora mixed/i })).toBeChecked();
    expect(screen.queryByRole('radio', { name: /System/i })).not.toBeInTheDocument();
  });

  it('updates the selected app theme without changing other settings', () => {
    const onChange = vi.fn();
    render(
      <AppearanceSettingsPanel
        background={{ available: false, revision: null }}
        backgroundBusy={false}
        backgroundError={null}
        onChange={onChange}
        onChooseBackground={vi.fn()}
        onRemoveBackground={vi.fn()}
        saveError={null}
        saving={false}
        settings={DEFAULT_GENERAL_SETTINGS}
      />
    );

    fireEvent.click(screen.getByDisplayValue('dark'));

    expect(onChange).toHaveBeenCalledWith({
      ...DEFAULT_GENERAL_SETTINGS,
      appearance: {
        ...DEFAULT_GENERAL_SETTINGS.appearance,
        theme: 'dark'
      }
    });
  });

  it('keeps the light terminal as an independent opt-in', () => {
    const onChange = vi.fn();
    render(
      <AppearanceSettingsPanel
        background={{ available: false, revision: null }}
        backgroundBusy={false}
        backgroundError={null}
        onChange={onChange}
        onChooseBackground={vi.fn()}
        onRemoveBackground={vi.fn()}
        saveError={null}
        saving={false}
        settings={{
          ...DEFAULT_GENERAL_SETTINGS,
          appearance: {
            ...DEFAULT_GENERAL_SETTINGS.appearance,
            theme: 'light'
          }
        }}
      />
    );

    fireEvent.click(screen.getByRole('switch', {
      name: 'Use a light terminal in Light mode'
    }));

    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({
      appearance: expect.objectContaining({ lightTerminalInLightMode: true })
    }));
  });

  it('customizes and resets the structured user message color', () => {
    const onChange = vi.fn();
    const view = render(
      <AppearanceSettingsPanel
        background={{ available: false, revision: null }}
        backgroundBusy={false}
        backgroundError={null}
        onChange={onChange}
        onChooseBackground={vi.fn()}
        onRemoveBackground={vi.fn()}
        saveError={null}
        saving={false}
        settings={DEFAULT_GENERAL_SETTINGS}
      />
    );

    fireEvent.change(screen.getByLabelText('User message color'), {
      target: { value: '#8B5CF6' }
    });
    const themeColorButton = screen.getByRole('button', { name: 'Use theme color' });
    expect(themeColorButton.parentElement).toHaveClass(
      'provider-panel-actions',
      'appearance-conversation-actions'
    );
    expect(themeColorButton.closest('.appearance-color-control')).toBeNull();
    expect(onChange).toHaveBeenLastCalledWith({
      ...DEFAULT_GENERAL_SETTINGS,
      appearance: {
        ...DEFAULT_GENERAL_SETTINGS.appearance,
        userMessageColor: '#8B5CF6'
      }
    });

    view.rerender(
      <AppearanceSettingsPanel
        background={{ available: false, revision: null }}
        backgroundBusy={false}
        backgroundError={null}
        onChange={onChange}
        onChooseBackground={vi.fn()}
        onRemoveBackground={vi.fn()}
        saveError={null}
        saving={false}
        settings={{
          ...DEFAULT_GENERAL_SETTINGS,
          appearance: {
            ...DEFAULT_GENERAL_SETTINGS.appearance,
            userMessageColor: '#8B5CF6'
          }
        }}
      />
    );
    fireEvent.click(themeColorButton);
    expect(onChange).toHaveBeenLastCalledWith({
      ...DEFAULT_GENERAL_SETTINGS,
      appearance: {
        ...DEFAULT_GENERAL_SETTINGS.appearance,
        userMessageColor: null
      }
    });
  });

  it('offers managed image actions without exposing a local path', () => {
    const onChooseBackground = vi.fn();
    const onRemoveBackground = vi.fn();
    render(
      <AppearanceSettingsPanel
        background={{ available: true, revision: '1720000000000-4096' }}
        backgroundBusy={false}
        backgroundError={null}
        onChange={vi.fn()}
        onChooseBackground={onChooseBackground}
        onRemoveBackground={onRemoveBackground}
        saveError={null}
        saving={false}
        settings={DEFAULT_GENERAL_SETTINGS}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Replace image' }));
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    expect(onChooseBackground).toHaveBeenCalledOnce();
    expect(onRemoveBackground).toHaveBeenCalledOnce();
    expect(screen.queryByText(/1720000000000/)).not.toBeInTheDocument();
  });

  it('previews range changes while dragging and saves once when released', () => {
    const onChange = vi.fn();
    render(
      <AppearanceSettingsPanel
        background={{ available: true, revision: '1720000000000-4096' }}
        backgroundBusy={false}
        backgroundError={null}
        onChange={onChange}
        onChooseBackground={vi.fn()}
        onRemoveBackground={vi.fn()}
        saveError={null}
        saving={false}
        settings={DEFAULT_GENERAL_SETTINGS}
      />
    );

    const opacity = screen.getByRole('slider', { name: 'Image opacity' });
    fireEvent.change(opacity, { target: { value: '70' } });

    expect(screen.getByText('70%')).toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();

    fireEvent.pointerUp(opacity);

    expect(onChange).toHaveBeenCalledOnce();
    expect(onChange).toHaveBeenCalledWith({
      ...DEFAULT_GENERAL_SETTINGS,
      appearance: {
        ...DEFAULT_GENERAL_SETTINGS.appearance,
        backgroundOpacity: 0.7
      }
    });
  });

  it('allows the workspace image to become fully transparent', () => {
    const onChange = vi.fn();
    render(
      <AppearanceSettingsPanel
        background={{ available: true, revision: '1720000000000-4096' }}
        backgroundBusy={false}
        backgroundError={null}
        onChange={onChange}
        onChooseBackground={vi.fn()}
        onRemoveBackground={vi.fn()}
        saveError={null}
        saving={false}
        settings={DEFAULT_GENERAL_SETTINGS}
      />
    );

    const opacity = screen.getByRole('slider', { name: 'Image opacity' });
    expect(opacity).toHaveAttribute('min', '0');

    fireEvent.change(opacity, { target: { value: '0' } });
    fireEvent.pointerUp(opacity);

    expect(onChange).toHaveBeenCalledWith({
      ...DEFAULT_GENERAL_SETTINGS,
      appearance: {
        ...DEFAULT_GENERAL_SETTINGS.appearance,
        backgroundOpacity: 0
      }
    });
  });

  it('allows surfaces and terminals to become fully transparent', () => {
    const onChange = vi.fn();
    render(
      <AppearanceSettingsPanel
        background={{ available: true, revision: '1720000000000-4096' }}
        backgroundBusy={false}
        backgroundError={null}
        onChange={onChange}
        onChooseBackground={vi.fn()}
        onRemoveBackground={vi.fn()}
        saveError={null}
        saving={false}
        settings={DEFAULT_GENERAL_SETTINGS}
      />
    );

    const surfaceOpacity = screen.getByRole('slider', { name: 'Surface opacity' });
    const terminalOpacity = screen.getByRole('slider', { name: 'Terminal opacity' });
    expect(surfaceOpacity).toHaveAttribute('min', '0');
    expect(terminalOpacity).toHaveAttribute('min', '0');

    fireEvent.change(surfaceOpacity, { target: { value: '0' } });
    fireEvent.pointerUp(surfaceOpacity);
    fireEvent.change(terminalOpacity, { target: { value: '0' } });
    fireEvent.pointerUp(terminalOpacity);

    expect(onChange).toHaveBeenNthCalledWith(1, {
      ...DEFAULT_GENERAL_SETTINGS,
      appearance: {
        ...DEFAULT_GENERAL_SETTINGS.appearance,
        surfaceOpacity: 0
      }
    });
    expect(onChange).toHaveBeenNthCalledWith(2, {
      ...DEFAULT_GENERAL_SETTINGS,
      appearance: {
        ...DEFAULT_GENERAL_SETTINGS.appearance,
        terminalOpacity: 0
      }
    });
  });

  it('lets users adjust surface mosaic independently from image blur', () => {
    const onChange = vi.fn();
    render(
      <AppearanceSettingsPanel
        background={{ available: true, revision: '1720000000000-4096' }}
        backgroundBusy={false}
        backgroundError={null}
        onChange={onChange}
        onChooseBackground={vi.fn()}
        onRemoveBackground={vi.fn()}
        saveError={null}
        saving={false}
        settings={DEFAULT_GENERAL_SETTINGS}
      />
    );

    const mosaic = screen.getByRole('slider', { name: 'Surface mosaic' });
    expect(mosaic).toHaveAttribute('min', '0');
    expect(mosaic).toHaveAttribute('max', '24');
    expect(mosaic).toHaveValue('0');

    fireEvent.change(mosaic, { target: { value: '12' } });
    expect(screen.getByText('12 px')).toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.pointerUp(mosaic);

    expect(onChange).toHaveBeenCalledWith({
      ...DEFAULT_GENERAL_SETTINGS,
      appearance: {
        ...DEFAULT_GENERAL_SETTINGS.appearance,
        surfaceMosaic: 12
      }
    });
  });
});
