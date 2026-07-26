/// <reference types="node" />

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const styles = readFileSync(
  join(process.cwd(), 'src', 'renderer', 'src', 'styles.css'),
  'utf8'
).replace(/\r\n/g, '\n');

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
): ReadonlyMap<string, string> {
  const expected = expectedMembers.map(normalizeSelector).sort();
  const flatRulePattern = /([^{}]+)\{([^{}]*)\}/g;
  const declarations = new Map<string, string>();
  let found = false;

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
      found = true;
      for (const [property, value] of effectiveDeclarations(ruleBody)) {
        declarations.set(property, value);
      }
    }
  }

  expect(
    found,
    `Missing CSS rule for selector members: ${expected.join(', ')}`
  ).toBe(true);
  return declarations;
}

function transitionEntryFor(
  transition: string | undefined,
  property: string
): string | undefined {
  if (transition === undefined) {
    return undefined;
  }

  const entries: string[] = [];
  let entryStart = 0;
  let parenthesisDepth = 0;

  for (let index = 0; index < transition.length; index += 1) {
    const character = transition[index];
    if (character === '(') {
      parenthesisDepth += 1;
    } else if (character === ')') {
      parenthesisDepth -= 1;
    } else if (character === ',' && parenthesisDepth === 0) {
      entries.push(transition.slice(entryStart, index).trim());
      entryStart = index + 1;
    }
  }
  entries.push(transition.slice(entryStart).trim());

  return entries.find((entry) => entry.split(/\s+/).includes(property));
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
    const declarations = groupedRule(styles, expandedSelectors);
    const clipPathTransition = transitionEntryFor(
      declarations.get('transition'),
      'clip-path'
    );

    expect
      .soft(declarations.get('clip-path'), 'expanded text clipping')
      .toBe('inset(0 0 0 0)');
    expect(declarations.get('opacity')).toBe('1');
    expect
      .soft(clipPathTransition ?? '', 'expanded clip-path transition')
      .toMatch(/\bsteps\([^)]*\)/);
  });

  it('reverses the text reveal for every text group when collapsed', () => {
    const declarations = groupedRule(styles, collapsedSelectors);

    expect(declarations.get('clip-path')).toBe('inset(0 100% 0 0)');
    expect(declarations.get('opacity')).toBe('0');
  });

  it('keeps reduced-motion transitions and animations effectively instant', () => {
    const reducedMotion = nestedBlock(
      styles,
      '@media (prefers-reduced-motion: reduce)'
    );
    const declarations = groupedRule(reducedMotion, [
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
