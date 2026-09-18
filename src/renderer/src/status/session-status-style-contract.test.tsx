/// <reference types="node" />

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const stylesheet = readFileSync(
  join(process.cwd(), 'src', 'renderer', 'src', 'styles.css'),
  'utf8'
).replace(/\/\*[\s\S]*?\*\//g, '');

/** Every rule whose selector names the status dot, as `selector { body }`. */
function dotRules(): Array<{ selector: string; body: string }> {
  return [...stylesheet.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .map(([, selector, body]) => ({ selector: selector!.trim(), body: body! }))
    .filter(({ selector }) => selector.includes('session-status-dot'));
}

/**
 * The dot has no colour of its own. People add their own themes, and a theme
 * sets its accent, warning and danger colours, so the dot takes those tokens;
 * a literal colour here would ignore the theme you picked.
 */
describe('the session status dot and the theme', () => {
  it('names no colour of its own', () => {
    const literals = dotRules().filter(({ body }) =>
      /#[0-9a-f]{3,8}\b|\b(?:rgb|rgba|hsl|hsla|hwb|lab|lch|oklab|oklch)\(/i.test(body)
    );

    expect(literals.map(({ selector }) => selector)).toEqual([]);
  });

  it('takes the accent for finished and working, warning for needs you and danger for failed', () => {
    const declaration = (selector: string, property: string) =>
      dotRules().find((rule) => rule.selector === selector)?.body
        .split(';')
        .map((part) => part.trim())
        .find((part) => part.startsWith(`${property}:`))
        ?.slice(property.length + 1)
        .trim();

    expect(declaration('.session-status-dot', 'background')).toBe('var(--blue)');
    expect(declaration('.session-status-dot[data-status="needs_you"]', 'background')).toBe('var(--warning)');
    expect(declaration('.session-status-dot[data-status="failed"]', 'background')).toBe('var(--danger)');
    expect(declaration('.session-status-dot[data-status="working"]', 'border-top-color')).toBe('var(--blue)');
  });

  it('keeps the spinner still for someone who asked for less motion', () => {
    const reduced = stylesheet.match(
      /@media \(prefers-reduced-motion: reduce\)\s*\{\s*\.session-status-dot\[data-status="working"\]\s*\{([^}]*)\}/
    )?.[1];

    expect(reduced).toMatch(/animation:\s*none/);
  });
});
