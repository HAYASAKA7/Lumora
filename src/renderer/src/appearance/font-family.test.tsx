import { describe, expect, it } from 'vitest';

import {
  DEFAULT_INTERFACE_FONT_STACK,
  DEFAULT_TERMINAL_FONT_STACK,
  resolveInterfaceFontFamily,
  resolveTerminalFontFamily
} from './font-family';

describe('appearance font families', () => {
  it('keeps the platform-safe defaults when no family is selected', () => {
    expect(resolveInterfaceFontFamily(null)).toBe(DEFAULT_INTERFACE_FONT_STACK);
    expect(resolveTerminalFontFamily(null)).toBe(DEFAULT_TERMINAL_FONT_STACK);
  });

  it('quotes the selected family and preserves immutable fallbacks', () => {
    expect(resolveInterfaceFontFamily('Atkinson Hyperlegible')).toBe(
      `"Atkinson Hyperlegible", ${DEFAULT_INTERFACE_FONT_STACK}`
    );
    expect(resolveTerminalFontFamily('JetBrains Mono')).toBe(
      `"JetBrains Mono", ${DEFAULT_TERMINAL_FONT_STACK}`
    );
  });

  it('escapes punctuation inside a schema-valid family name', () => {
    expect(resolveInterfaceFontFamily('A "Quoted" Font')).toBe(
      `"A \\"Quoted\\" Font", ${DEFAULT_INTERFACE_FONT_STACK}`
    );
  });
});
