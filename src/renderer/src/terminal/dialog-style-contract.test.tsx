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
    expect(dialog).toContain('--modal-shell-inset: 18px');
    expect(dialog).toContain('--modal-section-gap: 12px');
    expect(dialog).toContain('--modal-control-gap: 8px');
    expect(dialog).toContain('--modal-scrollbar-size: 8px');
    expect(dialog).toContain('display: grid');
    expect(dialog).toContain(
      'grid-template-rows: auto minmax(0, auto) auto'
    );
    expect(dialog).toContain('width: min(760px, 100%)');
    expect(dialog).toContain(
      'max-height: calc(100vh - 56px)'
    );
    expect(dialog).not.toContain('height: min(');
    expect(dialog).toContain(
      'padding: var(--modal-shell-inset) calc(var(--modal-shell-inset) - var(--modal-scrollbar-size))'
    );
    expect(dialog).toContain('row-gap: var(--modal-section-gap)');
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
    const body = rule('.dialog-body');
    expect(body).toContain('display: grid');
    expect(body).toContain('gap: var(--modal-section-gap)');
    expect(body).toContain('scrollbar-gutter: stable both-edges');

    const scrollingSections = rule(
      '.launch-readiness,\n.resume-workflow-stage'
    );
    expect(scrollingSections).toContain(
      'margin-inline: calc(-1 * var(--modal-scrollbar-size))'
    );
    expect(scrollingSections).toContain(
      'scrollbar-gutter: stable both-edges'
    );

    expect(
      rule(
        '.dialog-body::-webkit-scrollbar,\n' +
        '.launch-readiness::-webkit-scrollbar,\n' +
        '.resume-workflow-stage::-webkit-scrollbar'
      )
    ).toContain('width: var(--modal-scrollbar-size)');
  });

  it('uses shared section and control gaps instead of competing margins', () => {
    expect(rule('.launch-fields')).toContain(
      'gap: var(--modal-control-gap)'
    );
    expect(rule('.launch-fields label')).toContain('margin: 0');

    const scrollingSections = rule(
      '.launch-readiness,\n.resume-workflow-stage'
    );
    expect(scrollingSections).toContain('gap: var(--modal-section-gap)');
    expect(rule('.launch-readiness')).toContain('margin-top: 0');

    expect(
      rule(
        '.dialog-body > .card-description,\n' +
        '.dialog-body > .resume-session-details,\n' +
        '.dialog-body > .continuation-options,\n' +
        '.dialog-body > .handoff-explanation,\n' +
        '.dialog-body > .launch-details,\n' +
        '.dialog-body > .workspace-trust-notice,\n' +
        '.launch-readiness > .catalog-error'
      )
    ).toContain('margin: 0');
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
