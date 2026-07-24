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

describe('popup layout styles', () => {
  it('keeps standard dialogs stable while only their body scrolls', () => {
    const dialog = rule('.new-session-dialog');
    expect(dialog).toContain('display: grid');
    expect(dialog).toContain(
      'grid-template-rows: auto minmax(0, 1fr) auto'
    );
    expect(dialog).toContain(
      'height: min(720px, calc(100vh - 56px))'
    );
    expect(dialog).toContain('overflow: hidden');

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
      'height: min(380px, calc(82vh - 24px))'
    );

    const list = rule('.runtime-switcher-list');
    expect(list).toContain('min-height: 0');
    expect(list).toContain('overflow-y: auto');
  });
});
