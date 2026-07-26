/// <reference types="node" />

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const styles = readFileSync(
  join(process.cwd(), 'src', 'renderer', 'src', 'styles.css'),
  'utf8'
).replace(/\r\n/g, '\n');

type CssRule = {
  readonly declarations: ReadonlyMap<string, string>;
  readonly selectors: readonly string[];
};

function effectiveDeclarations(ruleBody: string): ReadonlyMap<string, string> {
  const declarations = new Map<string, string>();

  for (const declaration of ruleBody.split(';')) {
    const separator = declaration.indexOf(':');
    if (separator < 0) {
      continue;
    }

    const property = declaration.slice(0, separator).trim();
    const value = declaration.slice(separator + 1).trim();
    if (property) {
      declarations.set(property, value);
    }
  }

  return declarations;
}

function normalizeSelector(selector: string): string {
  return selector.trim().replace(/\s+/g, ' ');
}

function groupedRule(
  source: string,
  expectedMembers: readonly string[]
): CssRule {
  const expected = expectedMembers.map(normalizeSelector).sort();
  const flatRulePattern = /([^{}]+)\{([^{}]*)\}/g;

  for (const match of source.matchAll(flatRulePattern)) {
    const selectorList = match[1];
    const ruleBody = match[2];
    if (selectorList === undefined || ruleBody === undefined) {
      continue;
    }

    const selectors = selectorList.split(',').map(normalizeSelector);
    const sortedSelectors = [...selectors].sort();
    const matches =
      sortedSelectors.length === expected.length &&
      sortedSelectors.every(
        (selector, index) => selector === expected[index]
      );

    if (matches) {
      return {
        declarations: effectiveDeclarations(ruleBody),
        selectors
      };
    }
  }

  expect(
    undefined,
    `Missing CSS rule for selector members: ${expected.join(', ')}`
  ).toBeDefined();
  return {
    declarations: new Map(),
    selectors: []
  };
}

function nestedBlock(source: string, header: string): string {
  const headerStart = source.indexOf(header);
  expect(
    headerStart,
    `Missing CSS block for ${header}`
  ).toBeGreaterThanOrEqual(0);

  const bodyStart = source.indexOf('{', headerStart) + 1;
  let depth = 1;

  for (let index = bodyStart; index < source.length; index += 1) {
    const character = source[index];
    if (character === '{') {
      depth += 1;
    } else if (character === '}') {
      depth -= 1;
      if (depth === 0) {
        return source.slice(bodyStart, index);
      }
    }
  }

  expect(
    undefined,
    `Unclosed CSS block for ${header}`
  ).toBeDefined();
  return '';
}

describe('sidebar text transition styles', () => {
  const expandedSelectors = [
    '.brand-copy',
    '.nav-label-text',
    '.nav-item-label'
  ] as const;
  const collapsedSelectors = [
    '.sidebar-collapsed .brand-copy',
    '.sidebar-collapsed .nav-label-text',
    '.sidebar-collapsed .nav-item-label'
  ] as const;

  it('reveals every sidebar text group with coordinated typewriter steps', () => {
    const { declarations } = groupedRule(styles, expandedSelectors);

    expect
      .soft(declarations.get('clip-path'), 'expanded text clipping')
      .toBe('inset(0 0 0 0)');
    expect(declarations.get('opacity')).toBe('1');
    expect
      .soft(declarations.get('transition'), 'expanded stepped transition')
      .toContain('steps(');
  });

  it('reverses the text reveal when collapsed without targeting icons', () => {
    const { declarations, selectors } = groupedRule(
      styles,
      collapsedSelectors
    );

    expect(declarations.get('clip-path')).toBe('inset(0 100% 0 0)');
    expect(declarations.get('opacity')).toBe('0');
    expect(
      selectors.some((selector) => selector.includes('.icon'))
    ).toBe(false);
  });

  it('keeps reduced-motion transitions and animations effectively instant', () => {
    const reducedMotion = nestedBlock(
      styles,
      '@media (prefers-reduced-motion: reduce)'
    );
    const { declarations } = groupedRule(reducedMotion, [
      '*',
      '*::before',
      '*::after'
    ]);

    expect(declarations.get('transition-duration')).toBe(
      '0.01ms !important'
    );
    expect(declarations.get('animation-duration')).toBe(
      '0.01ms !important'
    );
  });
});
