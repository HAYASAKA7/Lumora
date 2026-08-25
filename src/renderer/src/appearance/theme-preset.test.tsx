import { describe, expect, it } from 'vitest';

import type { ThemePreset } from '../../../shared/contracts';
import { buildThemePresetStyle } from './theme-preset';

const theme: ThemePreset = {
  id: 'midnight-cyan',
  displayName: 'Midnight cyan',
  baseTheme: 'dark',
  palette: {
    accent: '#22D3EE',
    onAccent: '#06202A',
    background: '#07111F',
    sidebar: '#081525',
    sidebarText: '#E6F7FF',
    surface: '#102033',
    surfaceRaised: '#172A40',
    control: '#1C334D',
    text: '#F3FAFF',
    textMuted: '#9CB2C8',
    border: '#39536D',
    success: '#41D6A3',
    warning: '#F2BE5C',
    danger: '#F4778A'
  }
};

describe('buildThemePresetStyle', () => {
  it('maps bounded semantic colors onto Lumora theme variables', () => {
    expect(buildThemePresetStyle(theme)).toMatchObject({
      '--raw-navy-950': '#081525',
      '--raw-surface': '#102033',
      '--raw-surface-raised': '#172A40',
      '--raw-control-surface': '#1C334D',
      '--text': '#F3FAFF',
      '--text-muted': '#9CB2C8',
      '--line': '#39536D',
      '--blue': '#22D3EE',
      '--on-accent': '#06202A',
      '--success': '#41D6A3',
      '--warning': '#F2BE5C',
      '--danger': '#F4778A'
    });
  });

  it('does not override built-in theme variables without a pack', () => {
    expect(buildThemePresetStyle(null)).toEqual({});
  });
});
