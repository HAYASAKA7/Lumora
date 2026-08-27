import { describe, expect, it } from 'vitest';

import { DEFAULT_GENERAL_SETTINGS } from '../../../shared/contracts';
import { buildAppearancePresentation } from './presentation';

const themePreset = {
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
};

describe('buildAppearancePresentation', () => {
  it('keeps global font variables when the managed image is unavailable', () => {
    expect(buildAppearancePresentation(
      {
        ...DEFAULT_GENERAL_SETTINGS.appearance,
        backgroundEnabled: true
      },
      { available: false, revision: null }
    )).toEqual({
      backgroundActive: false,
      backgroundStyle: undefined,
      hasSurfaceMosaic: false,
      shellStyle: {
        '--font-ui': 'Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
        '--font-mono': '"Cascadia Mono", "SFMono-Regular", Consolas, monospace'
      }
    });
  });

  it('applies a custom structured user-message color without changing agent messages', () => {
    const presentation = buildAppearancePresentation(
      {
        ...DEFAULT_GENERAL_SETTINGS.appearance,
        userMessageColor: '#8B5CF6'
      },
      { available: false, revision: null }
    );

    expect(presentation.shellStyle).toMatchObject({
      '--raw-structured-user-message-surface': '#8B5CF6'
    });
    expect(presentation.shellStyle['--raw-structured-agent-message-surface'])
      .toBeUndefined();
  });

  it('builds the complete shared presentation for local and remote windows', () => {
    const presentation = buildAppearancePresentation(
      {
        ...DEFAULT_GENERAL_SETTINGS.appearance,
        backgroundEnabled: true,
        backgroundBlur: 8,
        backgroundBrightness: 0.72,
        backgroundFit: 'cover',
        backgroundOpacity: 0.61,
        backgroundPosition: 'bottom-right',
        surfaceMosaic: 12,
        surfaceOpacity: 0.5,
        terminalOpacity: 0.4,
        interfaceFontFamily: 'Atkinson Hyperlegible',
        terminalFontFamily: 'JetBrains Mono'
      },
      { available: true, revision: '1720000000000-4096' },
      themePreset
    );

    expect(presentation.backgroundActive).toBe(true);
    expect(presentation.hasSurfaceMosaic).toBe(true);
    expect(presentation.shellStyle).toMatchObject({
      '--font-ui': '"Atkinson Hyperlegible", Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      '--font-mono': '"JetBrains Mono", "Cascadia Mono", "SFMono-Regular", Consolas, monospace',
      '--appearance-terminal-opacity': '40%',
      '--appearance-opacity-normal': '50%',
      '--appearance-opacity-popup': '82.5%',
      '--appearance-surface-mosaic': '12px'
    });
    expect(presentation.shellStyle).toMatchObject({
      '--blue': '#22D3EE',
      '--raw-surface': '#102033'
    });
    expect(presentation.backgroundStyle).toEqual({
      backgroundImage:
        'url("app://appearance/background?revision=1720000000000-4096")',
      backgroundPosition: 'right bottom',
      backgroundSize: 'cover',
      filter: 'brightness(0.72) blur(8px)',
      opacity: 0.61,
      transform: 'scale(1.04)'
    });
  });

  it('preserves original image sizing and omits optional CSS values at zero', () => {
    const presentation = buildAppearancePresentation(
      {
        ...DEFAULT_GENERAL_SETTINGS.appearance,
        backgroundEnabled: true,
        backgroundBlur: 0,
        backgroundFit: 'original',
        backgroundPosition: 'top-left',
        surfaceMosaic: 0
      },
      { available: true, revision: '1720000000001-100' }
    );

    expect(presentation.shellStyle?.['--appearance-surface-mosaic']).toBeUndefined();
    expect(presentation.backgroundStyle).toMatchObject({
      backgroundPosition: 'left top',
      backgroundSize: 'auto',
      transform: undefined
    });
  });
});
