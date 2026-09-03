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

function winningDeclaration(
  element: Element,
  property: string,
  pseudoElement = ''
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
      if (pseudoElement && !selector.endsWith(pseudoElement)) {
        continue;
      }
      if (!pseudoElement && selector.includes('::')) {
        continue;
      }

      const originatingElementSelector = pseudoElement
        ? selector.slice(0, -pseudoElement.length)
        : selector;
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
      'grid-template-rows: auto minmax(0, 1fr) auto'
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

  it('scrolls a long dialog body instead of clipping it', () => {
    const dialog = effectiveDeclarations(rule('.new-session-dialog'));
    const body = effectiveDeclarations(rule('.dialog-body'));

    /**
     * The dialog is capped by `max-height` and hides its own overflow, so the
     * body row has to take the space left over from the header and footer. An
     * `auto` maximum sizes that row to its content instead, and everything past
     * the cap - including the footer actions - is clipped away with no
     * scrollbar, because the body is exactly as tall as its own content.
     */
    expect(dialog.get('grid-template-rows')).toBe('auto minmax(0, 1fr) auto');
    expect(dialog.get('max-height')).toBe('calc(100vh - 56px)');
    expect(dialog.get('overflow')).toBe('hidden');
    expect(body.get('min-height')).toBe('0');
    expect(body.get('overflow-y')).toBe('auto');
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
        winningDeclaration(
          scrollingRegion,
          'width',
          '::-webkit-scrollbar'
        ),
        `${className} scrollbar width must win the CSS cascade`
      ).toBe('var(--modal-scrollbar-size)');
    }
  });

  it('gives the new-session start prompt its own full-width row', () => {
    expect(
      effectiveDeclarations(rule('.new-session-start-prompt')).get(
        'grid-column'
      )
    ).toBe('1 / -1');
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

    const dialog = document.createElement('div');
    dialog.className = 'new-session-dialog';
    dialog.innerHTML = `
      <div class="dialog-body">
        <p class="card-description"></p>
        <dl class="resume-session-details"></dl>
        <section class="resume-workflow-stage">
          <fieldset class="continuation-options"></fieldset>
          <p class="handoff-explanation"></p>
          <section class="launch-readiness">
            <div class="catalog-operation-error"></div>
            <section class="workspace-trust-notice"></section>
            <details class="launch-details"></details>
          </section>
        </section>
      </div>
      <footer></footer>
    `;

    for (const selector of [
      '.card-description',
      '.resume-session-details',
      '.continuation-options',
      '.handoff-explanation',
      '.catalog-operation-error',
      '.workspace-trust-notice',
      '.launch-details',
      'footer'
    ]) {
      const section = dialog.querySelector(selector);
      expect(section, `Missing rendered section ${selector}`).not.toBeNull();
      expect(
        winningDeclaration(section!, 'margin'),
        `${selector} must rely on the shared 12px grid gap`
      ).toBe('0');
    }
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

  it('keeps the runtime switcher content-sized until it runs out of window', () => {
    const switcher = effectiveDeclarations(rule('.runtime-switcher'));
    const list = effectiveDeclarations(rule('.runtime-switcher-list'));

    expect(switcher.get('width')).toBe('min(440px, calc(100vw - 40px))');
    expect(switcher.get('overflow')).toBe('hidden');

    /**
     * The switcher opens below a fixed offset in its layer, so without a bound
     * a long list of open terminals simply runs off the bottom of the window,
     * taking the hint line with it. It stays content-sized while it fits; past
     * that the list, and only the list, scrolls under a pinned title and hint.
     */
    expect(switcher.get('display')).toBe('grid');
    expect(switcher.get('grid-template-rows')).toBe('auto minmax(0, 1fr) auto');
    expect(switcher.get('max-height')).toBe(
      'calc(100vh - var(--runtime-switcher-offset) - 20px)'
    );
    expect(switcher.get('height')).toBeUndefined();
    expect(list.get('display')).toBe('grid');
    expect(list.get('min-height')).toBe('0');
    expect(list.get('overflow-y')).toBe('auto');
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
