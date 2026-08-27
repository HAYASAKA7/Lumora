import type { CSSProperties } from 'react';

import type { ThemePreset } from '../../../shared/contracts';

export type ThemePresetStyle = CSSProperties &
  Partial<Record<`--${string}`, string>>;

function mix(primary: string, amount: number, secondary: string): string {
  return `color-mix(in srgb, ${primary} ${amount}%, ${secondary})`;
}

function translucent(color: string, amount: number): string {
  return mix(color, amount, 'transparent');
}

export function buildThemePresetStyle(
  theme: ThemePreset | null
): ThemePresetStyle {
  if (theme === null) return {};
  const color = theme.palette;
  return {
    backgroundColor: color.background,
    '--raw-navy-950': color.sidebar,
    '--raw-navy-900': mix(color.sidebar, 88, color.background),
    '--raw-navy-850': mix(color.sidebar, 78, color.surface),
    '--raw-navy-800': mix(color.sidebar, 65, color.surfaceRaised),
    '--raw-surface': color.surface,
    '--raw-surface-raised': color.surfaceRaised,
    '--raw-surface-subtle': mix(color.surface, 70, color.surfaceRaised),
    '--raw-control-surface': color.control,
    '--line': color.border,
    '--line-strong': mix(color.border, 68, color.text),
    '--line-soft': mix(color.border, 48, color.surface),
    '--text': color.text,
    '--text-muted': color.textMuted,
    '--text-soft': mix(color.textMuted, 68, color.surface),
    '--sidebar-heading': color.sidebarText,
    '--sidebar-text': mix(color.sidebarText, 78, color.sidebar),
    '--sidebar-muted': mix(color.sidebarText, 60, color.sidebar),
    '--raw-sidebar-hover': translucent(color.sidebarText, 7),
    '--raw-sidebar-selected': mix(color.accent, 16, color.sidebar),
    '--raw-topbar-surface': color.surfaceRaised,
    '--frame-border': translucent(color.sidebarText, 12),
    '--scrollbar': translucent(color.textMuted, 58),
    '--scrollbar-hover': translucent(color.textMuted, 78),
    '--terminal-tab-text': mix(color.sidebarText, 78, color.sidebar),
    '--terminal-tab-selected-text': color.sidebarText,
    '--raw-terminal-tab-selected-surface': color.sidebar,
    '--blue': color.accent,
    '--raw-blue-soft': mix(color.accent, 15, color.surfaceRaised),
    '--warning': color.warning,
    '--warning-strong': mix(color.warning, 74, color.text),
    '--raw-warning-soft': mix(color.warning, 14, color.surfaceRaised),
    '--warning-border': mix(color.warning, 40, color.border),
    '--success': color.success,
    '--raw-success-soft': mix(color.success, 14, color.surfaceRaised),
    '--success-border': mix(color.success, 40, color.border),
    '--danger': color.danger,
    '--on-accent': color.onAccent,
    '--accent-hover': mix(color.accent, 84, color.text),
    '--control-focus-ring': `0 0 0 3px ${translucent(color.accent, 20)}`,
    '--focus-outline': translucent(color.accent, 58),
    '--card-focus-outline': translucent(color.accent, 48),
    '--raw-switch-track': mix(color.textMuted, 68, color.control),
    '--raw-switch-thumb': color.text,
    '--provider-codex-text': mix(color.accent, 78, color.text),
    '--raw-dialog-overlay': translucent(color.background, 74),
    '--sidebar-grid-line': translucent(color.sidebarText, 3),
    '--drag-accent': color.accent,
    '--drag-accent-glow': translucent(color.accent, 55),
    '--terminal-notice-text': color.text,
    '--raw-terminal-notice-surface': color.surfaceRaised,
    '--terminal-notice-border': mix(color.accent, 45, color.border),
    '--terminal-error-text': mix(color.danger, 35, color.text),
    '--raw-terminal-error-surface': mix(color.danger, 28, color.surfaceRaised),
    '--runtime-switcher-text': color.text,
    '--runtime-switcher-border': color.border,
    '--runtime-switcher-muted': color.textMuted,
    '--runtime-switcher-selected-text': color.text,
    '--raw-runtime-switcher-selected-surface': mix(
      color.accent,
      18,
      color.surfaceRaised
    ),
    '--runtime-switcher-selected-border': mix(color.accent, 55, color.border),
    '--runtime-switcher-index-text': color.text,
    '--raw-runtime-switcher-index-surface': color.control,
    '--raw-tooltip-surface': color.surfaceRaised,
    '--tooltip-border': color.border,
    '--tooltip-text': color.text,
    '--tooltip-shortcut': color.textMuted,
    '--raw-structured-user-message-surface': mix(
      color.accent,
      18,
      color.surfaceRaised
    ),
    '--raw-structured-agent-message-surface': color.surfaceRaised
  };
}
