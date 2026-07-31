import { describe, expect, it } from 'vitest';

import { resolveAppearanceTheme, terminalThemeFor } from './theme';

describe('appearance theme resolution', () => {
  it('resolves the explicit Lumora mixed, light, and dark choices', () => {
    expect(resolveAppearanceTheme('lumora')).toBe('lumora');
    expect(resolveAppearanceTheme('light')).toBe('light');
    expect(resolveAppearanceTheme('dark')).toBe('dark');
  });

  it('keeps terminals dark unless light terminals are explicitly enabled', () => {
    expect(terminalThemeFor('light', false)).toBe('dark');
    expect(terminalThemeFor('light', true)).toBe('light');
    expect(terminalThemeFor('dark', true)).toBe('dark');
    expect(terminalThemeFor('lumora', true)).toBe('dark');
  });
});
