export const DEFAULT_INTERFACE_FONT_STACK =
  'Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';

export const DEFAULT_TERMINAL_FONT_STACK =
  '"Cascadia Mono", "SFMono-Regular", Consolas, monospace';

function resolveFontFamily(
  family: string | null,
  fallback: string
): string {
  return family === null ? fallback : `${JSON.stringify(family)}, ${fallback}`;
}

export function resolveInterfaceFontFamily(family: string | null): string {
  return resolveFontFamily(family, DEFAULT_INTERFACE_FONT_STACK);
}

export function resolveTerminalFontFamily(family: string | null): string {
  return resolveFontFamily(family, DEFAULT_TERMINAL_FONT_STACK);
}
