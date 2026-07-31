import type { AppearanceSettings } from '../../../shared/contracts';

export type ResolvedAppearanceTheme = AppearanceSettings['theme'];
export type TerminalTheme = 'light' | 'dark';

export function resolveAppearanceTheme(
  preference: AppearanceSettings['theme']
): ResolvedAppearanceTheme {
  return preference;
}

export function terminalThemeFor(
  resolvedTheme: ResolvedAppearanceTheme,
  lightTerminalInLightMode: boolean
): TerminalTheme {
  return resolvedTheme === 'light' && lightTerminalInLightMode
    ? 'light'
    : 'dark';
}
