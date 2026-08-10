import { describe, expect, it } from 'vitest';

import { DEFAULT_GENERAL_SETTINGS } from '../../../shared/contracts';
import { buildAppearancePresentation } from './presentation';

describe('buildAppearancePresentation', () => {
  it('does not expose background styles when the managed image is unavailable', () => {
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
      shellStyle: undefined
    });
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
        terminalOpacity: 0.4
      },
      { available: true, revision: '1720000000000-4096' }
    );

    expect(presentation.backgroundActive).toBe(true);
    expect(presentation.hasSurfaceMosaic).toBe(true);
    expect(presentation.shellStyle).toMatchObject({
      '--appearance-terminal-opacity': '40%',
      '--appearance-opacity-normal': '50%',
      '--appearance-opacity-popup': '82.5%',
      '--appearance-surface-mosaic': '12px'
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
