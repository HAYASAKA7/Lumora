/// <reference types="node" />

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const styles = readFileSync(
  join(process.cwd(), 'src', 'renderer', 'src', 'styles.css'),
  'utf8'
);

/**
 * Reading a declaration out of the file only proves it was written. These
 * assertions ask the cascade what actually wins, which is where an auto margin
 * is lost: a later, more specific rule can overrule it while both still read
 * correctly on the page.
 */
function computedMarginLeft(markup: string, selector: string): string {
  const sheet = document.createElement('style');
  sheet.textContent = styles;
  document.head.append(sheet);
  document.body.innerHTML = markup;
  const element = document.body.querySelector(selector);
  expect(element, `No element matched ${selector}`).not.toBeNull();
  return window.getComputedStyle(element as Element).marginLeft;
}

afterEach(() => {
  document.head.querySelectorAll('style').forEach((sheet) => sheet.remove());
  document.body.innerHTML = '';
});

describe('provider card action row styles', () => {
  it('keeps the switch against the right edge behind any button', () => {
    expect(
      computedMarginLeft(
        `<div class="provider-card-actions">
           <button class="icon-button" type="button"></button>
           <label class="settings-switch provider-card-switch"></label>
         </div>`,
        '.provider-card-switch'
      )
    ).toBe('auto');
  });

  it('still opens a gap where a row\'s words meet its marks', () => {
    expect(
      computedMarginLeft(
        `<div class="provider-card-actions">
           <button class="icon-button" type="button"></button>
           <button class="text-button" type="button"></button>
         </div>`,
        '.text-button'
      )
    ).toBe('8px');
  });
});
