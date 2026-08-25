import type { CSSProperties } from 'react';

import type {
  AppearanceBackgroundState,
  AppearanceSettings,
  ThemePreset
} from '../../../shared/contracts';
import {
  buildAppearanceOpacityTiers,
  formatAppearanceOpacity
} from './opacity-tiers';
import {
  resolveInterfaceFontFamily,
  resolveTerminalFontFamily
} from './font-family';
import { buildThemePresetStyle } from './theme-preset';

type AppearanceShellStyle = CSSProperties &
  Partial<Record<`--${string}`, string>>;

export interface AppearancePresentationStyles {
  backgroundActive: boolean;
  backgroundStyle: CSSProperties | undefined;
  hasSurfaceMosaic: boolean;
  shellStyle: AppearanceShellStyle;
}

const BACKGROUND_POSITIONS: Record<
  AppearanceSettings['backgroundPosition'],
  string
> = {
  center: 'center',
  top: 'center top',
  bottom: 'center bottom',
  left: 'left center',
  right: 'right center',
  'top-left': 'left top',
  'top-right': 'right top',
  'bottom-left': 'left bottom',
  'bottom-right': 'right bottom'
};

export function buildAppearancePresentation(
  appearance: AppearanceSettings,
  background: AppearanceBackgroundState,
  themePreset: ThemePreset | null = null
): AppearancePresentationStyles {
  const backgroundActive = appearance.backgroundEnabled && background.available;
  const fontStyle: AppearanceShellStyle = {
    ...buildThemePresetStyle(themePreset),
    '--font-ui': resolveInterfaceFontFamily(appearance.interfaceFontFamily),
    '--font-mono': resolveTerminalFontFamily(appearance.terminalFontFamily)
  };
  if (!backgroundActive) {
    return {
      backgroundActive: false,
      backgroundStyle: undefined,
      hasSurfaceMosaic: false,
      shellStyle: fontStyle
    };
  }

  const opacity = buildAppearanceOpacityTiers(appearance.surfaceOpacity);
  return {
    backgroundActive: true,
    hasSurfaceMosaic: appearance.surfaceMosaic > 0,
    shellStyle: {
      ...fontStyle,
      '--appearance-terminal-opacity': `${Math.round(appearance.terminalOpacity * 100)}%`,
      '--appearance-opacity-recessed': formatAppearanceOpacity(opacity.recessed),
      '--appearance-opacity-normal': formatAppearanceOpacity(opacity.normal),
      '--appearance-opacity-raised': formatAppearanceOpacity(opacity.raised),
      '--appearance-opacity-popup': formatAppearanceOpacity(opacity.popup),
      '--appearance-opacity-popup-raised': formatAppearanceOpacity(opacity.popupRaised),
      '--appearance-surface-mosaic': appearance.surfaceMosaic > 0
        ? `${appearance.surfaceMosaic}px`
        : undefined
    },
    backgroundStyle: {
      backgroundImage: `url("app://appearance/background?revision=${encodeURIComponent(background.revision)}")`,
      backgroundPosition: BACKGROUND_POSITIONS[appearance.backgroundPosition],
      backgroundSize: appearance.backgroundFit === 'original'
        ? 'auto'
        : appearance.backgroundFit,
      filter: `brightness(${appearance.backgroundBrightness}) blur(${appearance.backgroundBlur}px)`,
      opacity: appearance.backgroundOpacity,
      transform: appearance.backgroundBlur > 0 ? 'scale(1.04)' : undefined
    }
  };
}
