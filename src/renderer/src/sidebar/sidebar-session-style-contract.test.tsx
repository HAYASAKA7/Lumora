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
    expect(rule('.sidebar-session-section-running')).toContain('max-height: 70%');
    expect(rule('.sidebar-session-section-recent')).toContain('min-height: 30%');
  });

  it('uses independent autohiding scroll areas without layout growth', () => {
    const list = rule('.sidebar-session-items');
    expect(list).toContain('min-height: 0');
    expect(list).toContain('overflow-y: auto');
    expect(list).toContain('scrollbar-width: none');
    expect(styles).toContain(
      '.sidebar-session-items:hover,\n.sidebar-session-items.is-scrolling {'
    );
    expect(styles).toContain('scrollbar-width: thin');
    expect(styles).toContain('.sidebar-session-items::-webkit-scrollbar-thumb');
    expect(styles).toContain('.sidebar-session-items:hover::-webkit-scrollbar-thumb');
  });

  it('ellipsizes titles and uses semantic color variables', () => {
    const title = rule('.sidebar-session-title');
    expect(title).toContain('text-overflow: ellipsis');
    expect(title).toContain('white-space: nowrap');
    expect(rule('.sidebar-session-item')).toContain('color: var(--sidebar-text)');
  });
});
