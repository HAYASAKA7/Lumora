/// <reference types="node" />

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const normalizedStyles = readFileSync(
  join(process.cwd(), 'src', 'renderer', 'src', 'styles.css'),
  'utf8'
).replace(/\r\n/g, '\n');

function rule(selector: string): string {
  const ruleStart = normalizedStyles.indexOf(`${selector} {`);
  expect(ruleStart, `Missing CSS rule for ${selector}`).toBeGreaterThanOrEqual(
    0
  );
  const bodyStart = normalizedStyles.indexOf('{', ruleStart) + 1;
  const bodyEnd = normalizedStyles.indexOf('}', bodyStart);
  expect(bodyEnd, `Unclosed CSS rule for ${selector}`).toBeGreaterThan(
    bodyStart
  );
  return normalizedStyles.slice(bodyStart, bodyEnd);
}

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

type Specificity = readonly [number, number, number];

function selectorSpecificity(selector: string): Specificity {
  const pseudoElements = selector.match(/::[\w-]+/g)?.length ?? 0;
  const withoutPseudoElements = selector.replace(/::[\w-]+/g, '');
  const withoutNot = withoutPseudoElements.replace(
    /:not\(([^()]*)\)/g,
    '$1'
  );
  const ids = withoutNot.match(/#[\w-]+/g)?.length ?? 0;
  const classes = withoutNot.match(/\.[\w-]+/g)?.length ?? 0;
  const attributes = withoutNot.match(/\[[^\]]+\]/g)?.length ?? 0;
  const pseudoClasses = withoutNot.match(/:(?!:)[\w-]+/g)?.length ?? 0;
  const types =
    withoutNot.match(/(?:^|[\s>+~,(])([a-zA-Z][\w-]*)/g)?.length ?? 0;

  return [
    ids,
    classes + attributes + pseudoClasses,
    types + pseudoElements
  ];
}

function compareSpecificity(left: Specificity, right: Specificity): number {
  for (const index of [0, 1, 2] as const) {
    const difference = left[index] - right[index];
    if (difference !== 0) {
      return difference;
    }
  }
  return 0;
}

function winningPseudoElementDeclaration(
  element: Element,
  pseudoElement: string,
  property: string
): string | undefined {
  const candidates: Array<{
    value: string;
    specificity: Specificity;
    sourceOrder: number;
  }> = [];
  const flatRulePattern = /([^{}]+)\{([^{}]*)\}/g;

  for (const match of normalizedStyles.matchAll(flatRulePattern)) {
    const selectorList = match[1];
    const ruleBody = match[2];
    if (selectorList === undefined || ruleBody === undefined) {
      continue;
    }

    const declarations = effectiveDeclarations(ruleBody);
    const value = declarations.get(property);
    if (value === undefined) {
      continue;
    }

    for (const rawSelector of selectorList.split(',')) {
      const selector = normalizeSelector(rawSelector);
      if (!selector.endsWith(pseudoElement)) {
        continue;
      }

      const originatingElementSelector = selector.slice(
        0,
        -pseudoElement.length
      );
      if (element.matches(originatingElementSelector)) {
        candidates.push({
          value,
          specificity: selectorSpecificity(selector),
          sourceOrder: match.index ?? 0
        });
      }
    }
  }

  candidates.sort((left, right) => {
    const specificityOrder = compareSpecificity(
      left.specificity,
      right.specificity
    );
    return specificityOrder || left.sourceOrder - right.sourceOrder;
  });

  return candidates.at(-1)?.value;
}

function groupedRule(expectedMembers: readonly string[]): string {
  const expected = expectedMembers.map(normalizeSelector).sort();
  const flatRulePattern = /([^{}]+)\{([^{}]*)\}/g;

  for (const match of normalizedStyles.matchAll(flatRulePattern)) {
    const selectorList = match[1];
    const ruleBody = match[2];
    if (selectorList === undefined || ruleBody === undefined) {
      continue;
    }

    const actual = selectorList
      .split(',')
      .map(normalizeSelector)
      .sort();
    const matches =
      actual.length === expected.length &&
      actual.every((member, index) => member === expected[index]);

    if (matches) {
      return ruleBody;
    }
  }

  expect(
    undefined,
    `Missing CSS rule for selector members: ${expected.join(', ')}`
  ).toBeDefined();
  return '';
}

function nestedBlocks(selector: string): readonly string[] {
  const blocks: string[] = [];
  let searchStart = 0;

  while (searchStart < normalizedStyles.length) {
    const blockStart = normalizedStyles.indexOf(
      `${selector} {`,
      searchStart
    );
    if (blockStart < 0) {
      break;
    }
    const bodyStart = normalizedStyles.indexOf('{', blockStart) + 1;
    let depth = 1;
    let bodyEnd = -1;

    for (let index = bodyStart; index < normalizedStyles.length; index += 1) {
      const character = normalizedStyles[index];
      if (character === '{') {
        depth += 1;
      } else if (character === '}') {
        depth -= 1;
        if (depth === 0) {
          bodyEnd = index;
          break;
        }
      }
    }

    expect(bodyEnd, `Unclosed CSS block for ${selector}`).toBeGreaterThan(
      bodyStart
    );
    blocks.push(normalizedStyles.slice(bodyStart, bodyEnd));
    searchStart = bodyEnd + 1;
  }

  expect(blocks, `Missing CSS block for ${selector}`).not.toHaveLength(0);
  return blocks;
}

describe('popup layout styles', () => {
  it('keeps standard dialogs content-sized and viewport bounded', () => {
    const dialog = rule('.new-session-dialog');
    const dialogDeclarations = effectiveDeclarations(dialog);
    expect(dialogDeclarations.get('--modal-shell-inset')).toBe('18px');
    expect(dialogDeclarations.get('--modal-section-gap')).toBe('12px');
    expect(dialogDeclarations.get('--modal-control-gap')).toBe('8px');
    expect(dialogDeclarations.get('--modal-scrollbar-size')).toBe('8px');
    expect(dialog).toContain('display: grid');
    expect(dialog).toContain(
      'grid-template-rows: auto minmax(0, auto) auto'
    );
    expect(dialog).toContain('width: min(760px, 100%)');
    expect(dialog).toContain(
      'max-height: calc(100vh - 56px)'
    );
    expect(dialog).not.toContain('height: min(');
    expect(dialogDeclarations.get('padding')).toBe(
      'var(--modal-shell-inset) calc(var(--modal-shell-inset) - var(--modal-scrollbar-size))'
    );
    expect(dialogDeclarations.get('row-gap')).toBe(
      'var(--modal-section-gap)'
    );
    expect(dialog).toContain('overflow: hidden');

    expect(rule('.terminal-details-dialog')).toContain(
      'width: min(900px, 100%)'
    );

    const body = rule('.dialog-body');
    expect(body).toContain('min-height: 0');
    expect(body).toContain('overflow-y: auto');
    expect(body).toContain('scrollbar-gutter: stable');
  });

  it('aligns modal content symmetrically outside fixed scrollbar gutters', () => {
    const body = effectiveDeclarations(rule('.dialog-body'));
    expect(body.get('display')).toBe('grid');
    expect(body.get('gap')).toBe('var(--modal-section-gap)');
    expect(body.get('scrollbar-gutter')).toBe('stable both-edges');

    const scrollingSections = effectiveDeclarations(
      groupedRule(['.launch-readiness', '.resume-workflow-stage'])
    );
    expect(scrollingSections.get('margin-inline')).toBe(
      'calc(-1 * var(--modal-scrollbar-size))'
    );
    expect(scrollingSections.get('scrollbar-gutter')).toBe(
      'stable both-edges'
    );

    const appShell = document.createElement('div');
    appShell.className = 'app-shell';
    const dialog = document.createElement('div');
    dialog.className = 'new-session-dialog';
    appShell.append(dialog);

    for (const className of [
      'dialog-body',
      'launch-readiness',
      'resume-workflow-stage'
    ]) {
      const scrollingRegion = document.createElement('div');
      scrollingRegion.className = className;
      dialog.append(scrollingRegion);
      expect(
        winningPseudoElementDeclaration(
          scrollingRegion,
          '::-webkit-scrollbar',
          'width'
        ),
        `${className} scrollbar width must win the CSS cascade`
      ).toBe('var(--modal-scrollbar-size)');
    }
  });

  it('uses shared section and control gaps instead of competing margins', () => {
    expect(effectiveDeclarations(rule('.launch-fields')).get('gap')).toBe(
      'var(--modal-control-gap)'
    );
    expect(
      effectiveDeclarations(rule('.launch-fields label')).get('margin')
    ).toBe('0');

    const scrollingSections = effectiveDeclarations(
      groupedRule(['.launch-readiness', '.resume-workflow-stage'])
    );
    expect(scrollingSections.get('gap')).toBe(
      'var(--modal-section-gap)'
    );
    expect(
      effectiveDeclarations(rule('.launch-readiness')).get('margin-top')
    ).toBe('0');

    const directSections = effectiveDeclarations(
      groupedRule([
        '.dialog-body > .card-description',
        '.dialog-body > .resume-session-details',
        '.dialog-body > .continuation-options',
        '.dialog-body > .handoff-explanation',
        '.dialog-body > .launch-details',
        '.dialog-body > .workspace-trust-notice',
        '.launch-readiness > .catalog-error',
        '.new-session-dialog footer'
      ])
    );
    expect(directSections.get('margin')).toBe('0');
  });

  it('reserves stable regions for launch readiness and resume workflow pages', () => {
    const readiness = rule('.launch-readiness');
    expect(readiness).toContain('block-size: 220px');
    expect(readiness).toContain('overflow-y: auto');
    expect(readiness).toContain('scrollbar-gutter: stable');

    const workflow = rule('.resume-workflow-stage');
    expect(workflow).toContain('block-size: 400px');
  });

  it('keeps popup focus outlines inside clipped surfaces', () => {
    const focus = rule(
      '.new-session-dialog :focus-visible,\n' +
      '.runtime-switcher :focus-visible'
    );
    expect(focus).toContain('outline-offset: -3px');
  });

  it('keeps the runtime switcher content-sized like its former design', () => {
    const switcher = rule('.runtime-switcher');
    expect(switcher).toContain(
      'width: min(440px, calc(100vw - 40px))'
    );
    expect(switcher).toContain('overflow: hidden');
    expect(switcher).not.toContain('display: grid');
    expect(switcher).not.toContain('grid-template-rows');
    expect(switcher).not.toContain('height:');

    const list = rule('.runtime-switcher-list');
    expect(list).toContain('display: grid');
    expect(list).not.toContain('min-height:');
    expect(list).not.toContain('overflow-y:');
    expect(list).not.toContain('scrollbar-gutter:');
  });

  it('caps standard dialogs to the available height on narrow windows', () => {
    const expectedRule =
      '.new-session-dialog {\n' +
      '    max-height: calc(100vh - 20px);\n' +
      '  }';
    expect(
      nestedBlocks('@media (max-width: 680px)').some((mobile) =>
        mobile.includes(expectedRule)
      )
    ).toBe(true);
  });
});
