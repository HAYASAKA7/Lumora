/// <reference types="node" />

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const styles = readFileSync(
  join(process.cwd(), 'src', 'renderer', 'src', 'styles.css'),
  'utf8'
).replace(/\r\n/g, '\n');

function rule(selector: string): string {
  const start = styles.indexOf(`${selector} {`);
  expect(start, `Missing CSS rule for ${selector}`).toBeGreaterThanOrEqual(0);
  const bodyStart = styles.indexOf('{', start) + 1;
  const bodyEnd = styles.indexOf('}', bodyStart);
  return styles.slice(bodyStart, bodyEnd);
}

describe('sidebar session list styles', () => {
  it('separates session access from the primary navigation', () => {
    const container = rule('.sidebar-dynamic-content');
    expect(container).toContain('margin-top: 12px');
    expect(container).toContain('border-top: 1px solid var(--line-soft)');
  });

  it('bounds the region and reserves at least thirty percent for Recent', () => {
    expect(rule('.sidebar-session-region')).toContain('min-height: 0');
    expect(rule('.sidebar-session-region')).toContain('overflow: hidden');
    const running = rule('.sidebar-session-section-running');
    expect(running).toContain('flex: 0 1 auto');
    expect(running).toContain('max-height: 70%');
    const recent = rule('.sidebar-session-section-recent');
    expect(recent).toContain('min-height: 30%');
    expect(recent).toContain('flex: 1 1 30%');
    expect(rule('.sidebar-session-section:only-child')).toContain('max-height: none');
  });

  it('uses independent autohiding Lumora scroll areas without layout growth', () => {
    const list = rule('.sidebar-session-items');
    expect(list).toContain('min-height: 0');
    expect(list).toContain('overflow-y: auto');
    expect(list).toContain('scrollbar-color: transparent transparent');
    expect(styles).toContain(
      '.sidebar-session-items:hover,\n.sidebar-session-items.is-scrolling {'
    );
    expect(styles).toContain('scrollbar-color: var(--scrollbar) transparent');
    expect(rule('.sidebar-session-items::-webkit-scrollbar')).toContain('width: 12px');
    expect(styles).toContain('.sidebar-session-items::-webkit-scrollbar-thumb');
    expect(styles).toContain('.sidebar-session-items:hover::-webkit-scrollbar-thumb');
    expect(styles).toContain('background: var(--scrollbar-hover)');
    expect(styles).toContain('border: 3px solid transparent');
  });

  it('smoothly reveals and conceals section contents without unmounting them', () => {
    const section = rule('.sidebar-session-section');
    expect(section).toContain('align-content: start');
    expect(section).toContain('grid-template-rows: auto minmax(0, 1fr)');
    expect(section).toContain('transition: grid-template-rows 240ms ease');
    const collapsed = rule('.sidebar-session-section[data-expanded="false"]');
    expect(collapsed).toContain('grid-template-rows: auto 0fr');
    const collapsedItems = rule(
      '.sidebar-session-section[data-expanded="false"] .sidebar-session-items'
    );
    expect(collapsedItems).toContain('opacity: 0');
    expect(collapsedItems).toContain('visibility: hidden');
    expect(collapsedItems).toContain('pointer-events: none');
    const items = rule('.sidebar-session-items');
    expect(items).toContain('overflow-anchor: none');
    expect(items).toContain('opacity 180ms ease');
    expect(items).not.toContain('opacity 160ms ease 60ms');
    expect(rule('.sidebar-session-toggle')).toContain('align-self: start');
    expect(collapsedItems).toContain('overflow-y: hidden');
  });

  it('uses readable type, ellipsizes titles, and uses semantic color variables', () => {
    const title = rule('.sidebar-session-title');
    const metadata = rule('.sidebar-session-copy small');
    expect(title).toContain('font-size: 0.82rem');
    expect(metadata).toContain('font-size: 0.7rem');
    expect(title).toContain('text-overflow: ellipsis');
    expect(title).toContain('white-space: nowrap');
    expect(rule('.sidebar-session-item')).toContain('color: var(--sidebar-text)');
  });
});
