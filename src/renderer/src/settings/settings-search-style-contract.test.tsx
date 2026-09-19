/// <reference types="node" />

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const stylesheet = readFileSync(
  join(process.cwd(), 'src', 'renderer', 'src', 'styles.css'),
  'utf8'
).replace(/\/\*[\s\S]*?\*\//g, '');

/** The declarations of the rule whose selector, spaces collapsed, is exactly this. */
function rule(selector: string): string {
  const flat = (text: string) => text.replace(/\s+/g, ' ').trim();
  const match = [...stylesheet.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .find(([, candidate]) => flat(candidate!) === flat(selector));
  expect(match, `a rule for ${selector}`).toBeDefined();
  return flat(match![2]!);
}

/**
 * Search in Settings hides with the stylesheet alone: the page marks rows and
 * the rules decide what shows. jsdom applies no styles, so they are held here.
 */
describe('search in Settings and the stylesheet', () => {
  it('hides a row that misses whatever display its own rules give it', () => {
    expect(rule('[data-search-miss]')).toContain('display: none !important');
  });

  it('keeps only matching settings and what belongs with them while searching', () => {
    const body = rule(`.settings-layout[data-settings-searching] .settings-category-panel :not(
      [data-setting],
      [data-setting] *,
      [data-setting-companion],
      [data-setting-companion] *,
      [role='alert'],
      [role='alert'] *,
      .settings-search-category,
      :has([data-setting]:not([data-search-miss]))
    )`);
    expect(body).toContain('display: none !important');
  });

  it('holds the parts of one setting together without a box of their own', () => {
    expect(rule('.setting-block')).toContain('display: contents');
  });

  it('gives the search its own row in the pinned bar so the tabs keep their width', () => {
    // Beside the tabs it pushed all eleven into a scrolling strip at common widths.
    expect(rule('.settings-category-bar')).toContain('display: grid');
    expect(rule('.settings-search')).toContain('display: flex');
  });

  it('steps a category without results back rather than hiding its tab', () => {
    expect(rule(".settings-category-tab[data-search-empty]")).toContain('opacity: 0.45');
  });
});
