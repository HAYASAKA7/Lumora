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
