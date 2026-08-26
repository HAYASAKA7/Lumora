import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const stylesheet = readFileSync(
  resolve(process.cwd(), 'src/renderer/src/styles.css'),
  'utf8'
);

const managedSurfaceTokens = [
  'navy-950',
  'navy-900',
  'navy-850',
  'navy-800',
  'surface',
  'surface-raised',
  'surface-subtle',
  'tooltip-surface',
  'control-surface',
  'sidebar-hover',
  'sidebar-selected',
  'topbar-surface',
  'terminal-tab-selected-surface',
  'blue-soft',
  'warning-soft',
  'success-soft',
  'provider-claude-soft',
  'switch-track',
  'switch-thumb',
  'dialog-overlay',
  'terminal-notice-surface',
  'terminal-error-surface',
  'terminal-overlay',
  'runtime-switcher-selected-surface',
  'runtime-switcher-index-surface'
] as const;

describe('appearance style contract', () => {
  it('keeps font preset controls and actions in separate vertical rows', () => {
    const presetLayoutRule = stylesheet.match(
      /\.appearance-font-presets\s*\{([^}]*)\}/
    )?.[1];
    const presetActionsRule = stylesheet.match(
      /\.appearance-font-presets \.provider-panel-actions\s*\{([^}]*)\}/
    )?.[1];

    expect(presetLayoutRule).toContain('display: grid');
    expect(presetLayoutRule).toContain(
      'grid-template-columns: minmax(0, 1fr)'
    );
    expect(presetActionsRule).toContain('justify-content: flex-end');
  });

  it('composes every semantic component surface from centralized opacity tiers', () => {
    const rootRule = stylesheet.match(/^:root\s*\{([^}]*)\}/m)?.[1];
    const appearanceRule = stylesheet.match(
      /\.appearance-root\.has-appearance-background\s*\{([^}]*)\}/
    )?.[1];
    for (const token of managedSurfaceTokens) {
      expect(rootRule).toContain(`--raw-${token}:`);
      expect(rootRule).toContain(`--${token}: var(--raw-${token})`);
      expect(appearanceRule).toContain(`--${token}: color-mix(`);
    }
  });

  it('accounts for every component background as a managed surface or intentional accent', () => {
    const rootlessStylesheet = stylesheet.replace(
      /:root(?:\[data-theme='[^']+'\])?\s*\{[^}]*\}/gs,
      ''
    );
    const componentBackgroundTokens = new Set(
      Array.from(
        rootlessStylesheet.matchAll(
          /background(?:-color)?:\s*var\(--([a-z0-9-]+)\)/g
        ),
        (match) => match[1]!
      )
    );
    const intentionalNonSurfaceTokens = new Set([
      'accent-hover',
      'blue',
      'drag-accent',
      'green',
      'line',
      'line-strong',
      'popup-dialog-shell-surface',
      'popup-switcher-shell-surface',
      'scrollbar',
      'scrollbar-hover',
      'scrollbar-thumb',
      'sidebar-muted',
      'success',
      'terminal-dark-surface',
      'terminal-light-surface',
      'text-soft',
      'warning'
    ]);

    const unclassifiedTokens = Array.from(componentBackgroundTokens)
      .filter(
        (token) =>
          !managedSurfaceTokens.includes(
            token as (typeof managedSurfaceTokens)[number]
          ) && !intentionalNonSurfaceTokens.has(token)
      )
      .sort();

    expect(unclassifiedTokens).toEqual([]);
  });

  it('raises popup shells and their nested component surfaces above normal pages', () => {
    const popupRule = stylesheet.match(
      /\.has-appearance-background \.new-session-dialog,\s*\.has-appearance-background \.runtime-switcher,\s*\.has-appearance-background \.select-menu-options\s*\{([^}]*)\}/
    )?.[1];

    expect(popupRule).toContain('var(--appearance-opacity-popup)');
    expect(popupRule).toContain('var(--appearance-opacity-popup-raised)');
    expect(popupRule).toContain('--surface: color-mix(');
    expect(popupRule).toContain('--surface-raised: color-mix(');
    expect(popupRule).toContain('--control-surface: color-mix(');
  });

  it('lets the managed terminal reveal the selected workspace background', () => {
    const terminalFrameRule = stylesheet.match(
      /\.has-appearance-background\.terminal-active \.workspace-frame\s*\{([^}]*)\}/
    )?.[1];
    const xtermViewportRule = stylesheet.match(
      /\.has-appearance-background \.managed-terminal \.xterm-viewport\s*\{([^}]*)\}/
    )?.[1];
    const darkTerminalRule = stylesheet.match(
      /\.has-appearance-background \.managed-terminal-shell-dark\s*\{([^}]*)\}/
    )?.[1];
    const terminalContentRule = stylesheet.match(
      /\.has-appearance-background \.managed-terminal\s*\{([^}]*)\}/
    )?.[1];

    expect(terminalFrameRule).toContain('background: transparent');
    expect(xtermViewportRule).toContain('background-color: transparent');
    expect(darkTerminalRule).toContain('var(--appearance-terminal-opacity)');
    expect(terminalContentRule).toContain('background: transparent');
  });

  it('applies appearance opacity and mosaic to every popup shell', () => {
    const appearanceRule = stylesheet.match(
      /\.appearance-root\.has-appearance-background\s*\{([^}]*)\}/
    )?.[1];
    const popupRule = stylesheet.match(
      /\.has-appearance-background \.new-session-dialog,\s*\.has-appearance-background \.runtime-switcher,\s*\.has-appearance-background \.select-menu-options\s*\{([^}]*)\}/
    )?.[1];
    const mosaicRule = stylesheet.match(
      /\.has-appearance-background\.has-surface-mosaic \.new-session-dialog,\s*\.has-appearance-background\.has-surface-mosaic \.runtime-switcher,\s*\.has-appearance-background\.has-surface-mosaic \.select-menu-options\s*\{([^}]*)\}/
    )?.[1];

    expect(appearanceRule).toContain(
      '--dialog-overlay: color-mix('
    );
    expect(popupRule).toContain('var(--appearance-opacity-popup)');
    expect(popupRule).toContain('var(--appearance-opacity-popup-raised)');
    expect(mosaicRule).toContain(
      'backdrop-filter: blur(var(--appearance-surface-mosaic))'
    );
  });

  it('styles custom select option tables as Lumora popup surfaces', () => {
    const tableRule = [...stylesheet.matchAll(
      /\.has-appearance-background \.select-menu-options\s*\{([^}]*)\}/g
    )].find((match) => match[1]?.includes('background:'))?.[1];
    const optionStateRule = stylesheet.match(
      /\.select-menu-option:hover,\s*\.select-menu-option\.is-active\s*\{([^}]*)\}/
    )?.[1];

    expect(tableRule).toContain(
      'background: var(--popup-dialog-shell-surface)'
    );
    expect(optionStateRule).toContain('color: var(--text)');
    expect(optionStateRule).toContain('background: var(--surface-subtle)');
    expect(optionStateRule).not.toContain('sidebar');
  });

  it('applies surface opacity to terminal chrome and the system status bar', () => {
    const appearanceRule = stylesheet.match(
      /\.appearance-root\.has-appearance-background\s*\{([^}]*)\}/
    )?.[1];

    expect(appearanceRule).toContain(
      '--navy-850: color-mix(in srgb, var(--raw-navy-850) var(--appearance-opacity-raised)'
    );
    expect(appearanceRule).toContain(
      '--surface-subtle: color-mix(in srgb, var(--raw-surface-subtle) var(--appearance-opacity-recessed)'
    );
  });

  it('applies surface mosaic only through the explicit opt-in class', () => {
    const appearanceRule = stylesheet.match(
      /\.appearance-root\.has-appearance-background\s*\{([^}]*)\}/
    )?.[1];
    const mosaicRule = stylesheet.match(
      /\.has-appearance-background\.has-surface-mosaic \.sidebar,\s*\.has-appearance-background\.has-surface-mosaic:not\(\.terminal-active\) \.workspace-frame\s*\{([^}]*)\}/
    )?.[1];

    expect(appearanceRule).not.toContain('backdrop-filter');
    expect(mosaicRule).toContain(
      'backdrop-filter: blur(var(--appearance-surface-mosaic))'
    );
  });

  it('moves surface mosaic onto the active terminal page without stacking blur layers', () => {
    const routeMosaicRule = stylesheet.match(
      /\.has-appearance-background\.has-surface-mosaic \.sidebar,\s*\.has-appearance-background\.has-surface-mosaic:not\(\.terminal-active\) \.workspace-frame\s*\{([^}]*)\}/
    )?.[1];
    const terminalMosaicRule = stylesheet.match(
      /\.has-appearance-background\.has-surface-mosaic\.terminal-active \.terminal-workspace\s*\{([^}]*)\}/
    )?.[1];

    expect(routeMosaicRule).toContain(
      'backdrop-filter: blur(var(--appearance-surface-mosaic))'
    );
    expect(terminalMosaicRule).toContain(
      'backdrop-filter: blur(var(--appearance-surface-mosaic))'
    );
  });

  it('uses theme-aware semantic colors for status and warning surfaces', () => {
    const statusRule = stylesheet.match(/\.status-bar\s*\{([^}]*)\}/)?.[1];
    const environmentWarningRule = stylesheet.match(
      /\.developer-environment-warning\s*\{([^}]*)\}/
    )?.[1];
    const transferWarningRule = stylesheet.match(
      /\.transfer-unencrypted-warning\s*\{([^}]*)\}/
    )?.[1];

    expect(statusRule).toContain('color: var(--text-soft)');
    expect(statusRule).toContain('background: var(--surface-subtle)');
    expect(environmentWarningRule).toContain('color: var(--warning)');
    expect(environmentWarningRule).toContain('background: var(--warning-soft)');
    expect(transferWarningRule).toContain('color: var(--warning)');
    expect(transferWarningRule).toContain('background: var(--warning-soft)');
  });

  it('uses readable semantic colors for terminal tabs in every app theme', () => {
    const tabRule = stylesheet.match(/\.terminal-tab\s*\{([^}]*)\}/)?.[1];
    const selectedTabRule = stylesheet.match(
      /\.terminal-tab\[aria-selected="true"\]\s*\{([^}]*)\}/
    )?.[1];

    expect(tabRule).toContain('color: var(--terminal-tab-text)');
    expect(selectedTabRule).toContain('color: var(--terminal-tab-selected-text)');
    expect(selectedTabRule).toContain(
      'background: var(--terminal-tab-selected-surface)'
    );
  });

  it('preserves the original Lumora mixed dark-sidebar and light-workspace palette', () => {
    const rootTheme = stylesheet.match(/^:root\s*\{([^}]*)\}/m)?.[1];
    const mixedTheme = stylesheet.match(
      /:root\[data-theme='lumora'\]\s*\{([^}]*)\}/
    )?.[1];

    expect(mixedTheme).toContain('--raw-navy-900: #0b1728');
    expect(rootTheme).toContain('--raw-surface: #f6f8fb');
    expect(rootTheme).toContain('--raw-surface-raised: #ffffff');
    expect(mixedTheme).toContain('--sidebar-heading: #ffffff');
  });

  it('keeps component color literals centralized in theme tokens', () => {
    const componentStyles = stylesheet.replace(
      /:root(?:\[data-theme='[^']+'\])?\s*\{[^}]*\}/gs,
      ''
    );
    const hardCodedColors = componentStyles.match(
      /#[0-9a-f]{3,8}|rgba?\([^)]*\)|rgb\([^)]*\)/gi
    );

    expect(hardCodedColors).toEqual(null);
  });
  it('styles Lumora tooltips as compact theme-aware popup surfaces', () => {
    const rootRule = stylesheet.match(/^:root\s*\{([^}]*)\}/m)?.[1];
    const tooltipRule = stylesheet.match(/\.lumora-tooltip\s*\{([^}]*)\}/)?.[1];
    const reducedMotionRule = stylesheet.match(
      /@media \(prefers-reduced-motion: reduce\)\s*\{([\s\S]*?)\n\}/
    )?.[1];

    expect(rootRule).toContain('--tooltip-surface:');
    expect(rootRule).toContain('--tooltip-border:');
    expect(rootRule).toContain('--tooltip-text:');
    expect(rootRule).toContain('--tooltip-shortcut:');
    expect(tooltipRule).toContain('position: fixed');
    expect(tooltipRule).toContain('padding: 7px 10px');
    expect(tooltipRule).toContain('max-width: 320px');
    expect(tooltipRule).toContain('pointer-events: none');
    expect(tooltipRule).toContain('background: var(--tooltip-surface)');
    expect(reducedMotionRule).toContain('.lumora-tooltip');
  });
});
