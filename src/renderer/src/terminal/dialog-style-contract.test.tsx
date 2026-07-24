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
  it('keeps standard dialogs stable while only their body scrolls', () => {
    const dialog = rule('.new-session-dialog');
    expect(dialog).toContain('display: grid');
    expect(dialog).toContain(
      'grid-template-rows: auto minmax(0, 1fr) auto'
    );
    expect(dialog).toContain('width: min(760px, 100%)');
    expect(dialog).toContain(
      'height: min(var(--dialog-height), calc(100vh - 56px))'
    );
    expect(dialog).toContain('overflow: hidden');

    expect(rule('.new-session-launch-dialog')).toContain(
      '--dialog-height: 600px'
    );
    expect(rule('.resume-session-dialog')).toContain(
      '--dialog-height: 720px'
    );
    expect(rule('.runtime-recovery-dialog')).toContain(
      '--dialog-height: 660px'
    );
    expect(rule('.terminal-details-dialog')).toContain(
      '--dialog-height: 580px'
    );
    expect(rule('.terminal-details-dialog')).toContain(
      'width: min(900px, 100%)'
    );

    const body = rule('.dialog-body');
    expect(body).toContain('min-height: 0');
    expect(body).toContain('overflow-y: auto');
    expect(body).toContain('scrollbar-gutter: stable');
  });

  it('keeps popup focus outlines inside clipped surfaces', () => {
    const focus = rule(
      '.new-session-dialog :focus-visible,\n' +
      '.runtime-switcher :focus-visible'
    );
    expect(focus).toContain('outline-offset: -3px');
  });

  it('keeps the runtime switcher stable while its list scrolls', () => {
    const switcher = rule('.runtime-switcher');
    expect(switcher).toContain('display: grid');
    expect(switcher).toContain(
      'grid-template-rows: auto minmax(0, 1fr) auto'
    );
    expect(switcher).toContain(
      'width: min(440px, calc(100vw - 40px))'
    );
    expect(switcher).toContain(
      'height: min(380px, calc(82vh - 24px))'
    );

    const list = rule('.runtime-switcher-list');
    expect(list).toContain('min-height: 0');
    expect(list).toContain('overflow-y: auto');
  });

  it('uses the available height for standard dialogs on narrow windows', () => {
    const expectedRule =
      '.new-session-dialog {\n' +
      '    height: min(var(--dialog-height), calc(100vh - 20px));\n' +
      '  }';
    expect(
      nestedBlocks('@media (max-width: 680px)').some((mobile) =>
        mobile.includes(expectedRule)
      )
    ).toBe(true);
  });
});
