/// <reference types="node" />

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const stylesheet = readFileSync(
  join(process.cwd(), 'src', 'renderer', 'src', 'styles.css'),
  'utf8'
).replace(/\/\*[\s\S]*?\*\//g, '');

/** The declarations of the top-level rule with exactly this selector. */
function rule(selector: string): Map<string, string> {
  const match = [...stylesheet.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .find(([, candidate]) => candidate!.trim() === selector);
  expect(match, `a rule for ${selector}`).toBeDefined();
  return new Map(match![2]!
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const colon = part.indexOf(':');
      return [part.slice(0, colon).trim(), part.slice(colon + 1).trim()] as const;
    }));
}

/**
 * A page keeps its toolbar under the top bar while its content scrolls, and its
 * title fades as it scrolls away. These are layout rules jsdom cannot show, so
 * the stylesheet is held to them here.
 */
describe('page toolbars and the page title', () => {
  it('pins the toolbar under the top bar, lifted out of the page padding', () => {
    const toolbar = rule('.page-toolbar');

    expect(toolbar.get('position')).toBe('sticky');
    expect(toolbar.get('top')).toBe('calc(var(--page-toolbar-inset) - var(--page-gutter-block))');
    expect(toolbar.get('container-type')).toBe('scroll-state');
    expect(rule('.main-content').get('padding'))
      .toBe('var(--page-gutter-block) var(--page-gutter-inline)');
  });

  it('keeps a pinned toolbar above every layer of the page and under the overlays', () => {
    // The runtime switcher and the status tip start the overlays, then dialogs, menus and tooltips.
    const OVERLAY_LAYER = 70;
    const toolbarLayer = Number(rule('.page-toolbar').get('z-index'));
    const pageLayers = [...stylesheet.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
      .flatMap(([, selector, body]) => {
        const layer = /\bz-index:\s*(-?\d+)/.exec(body!)?.[1];
        return layer === undefined || selector!.includes('.page-toolbar')
          ? []
          : [{ selector: selector!.trim(), layer: Number(layer) }];
      })
      .filter(({ layer }) => layer < OVERLAY_LAYER);

    // A hovered workspace card once rose to the toolbar's layer and covered it.
    expect(pageLayers.filter(({ layer }) => layer >= toolbarLayer)).toEqual([]);
    expect(toolbarLayer).toBeLessThan(OVERLAY_LAYER);
  });

  it('backs a pinned toolbar with the top bar surface only while it is pinned', () => {
    const backing = rule('.page-toolbar::before');

    expect(backing.get('opacity')).toBe('0');
    // Painted as the top bar is seen: the top bar surface alone lets rows show through.
    expect(backing.get('background'))
      .toBe('linear-gradient(var(--topbar-surface), var(--topbar-surface)), var(--surface)');
    expect(backing.get('inset'))
      .toBe('calc(var(--page-toolbar-inset) * -1) 0 calc(var(--page-toolbar-bleed, 0px) * -1)');
    // Shadows reach both page edges without adding scrollable overflow.
    expect(backing.get('box-shadow'))
      .toBe('0 0 0 100vmax var(--topbar-surface), 0 0 0 100vmax var(--surface)');
    expect(backing.get('clip-path')).toBe('inset(0 -100vmax)');
    expect(stylesheet).toMatch(
      /@container scroll-state\(stuck: top\)\s*\{\s*\.page-toolbar::before\s*\{\s*opacity: 1;\s*\}/
    );
  });

  it('blurs the rows under a see-through backing over a background picture', () => {
    expect(rule('.has-appearance-background .page-toolbar::before').get('backdrop-filter'))
      .toBe('blur(18px)');
  });

  it('fades the title while it scrolls out and keeps it still for less motion', () => {
    const title = rule('.page-header');

    // A bare view() would take the page scroll padding and fade the title at rest.
    expect(title.get('animation-timeline')).toBe('view(block 0px)');
    expect(title.get('animation-range')).toBe('exit 0% exit 100%');
    const reduced = [...stylesheet.matchAll(/@media \(prefers-reduced-motion: reduce\)\s*\{([\s\S]*?)\n\}/g)]
      .map(([, body]) => body!);
    expect(reduced.some((body) => /\.page-header\s*\{\s*animation: none;/.test(body))).toBe(true);
  });

  it('swaps the top bar text for the page name once the title is away', () => {
    expect(rule('.topbar-page-title').get('opacity')).toBe('0');
    expect(rule(".topbar[data-page-heading='away'] .topbar-page-title").get('opacity')).toBe('1');
    expect(rule(".topbar[data-page-heading='away'] .topbar-brand").get('opacity')).toBe('0');
  });

  it('docks the changes panel under the pinned toolbar', () => {
    expect(rule('.workspace-detail.has-changes-panel > .changes-panel').get('top')).toBe(
      'calc(var(--page-toolbar-inset) + var(--page-toolbar-height, 0px) + 12px - var(--page-gutter-block))'
    );
  });
});
