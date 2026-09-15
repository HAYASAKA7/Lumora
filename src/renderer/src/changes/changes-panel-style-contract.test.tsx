import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const styles = readFileSync(
  join(process.cwd(), 'src', 'renderer', 'src', 'styles.css'),
  'utf8'
).replace(/\r\n/g, '\n');

/** The body of the rule whose selector list names the selector. */
function rule(selector: string): string {
  const blocks = styles.split('}');
  const block = blocks.find((candidate) => {
    const open = candidate.indexOf('{');
    if (open < 0) return false;
    const selectors = candidate.slice(0, open).replace(/\/\*[\s\S]*?\*\//g, '').split(',');
    return selectors.some((item) => item.trim() === selector);
  });
  expect(block, `Missing CSS rule for ${selector}`).toBeDefined();
  return (block ?? '').slice((block ?? '').indexOf('{') + 1);
}

describe('changes panel style contract', () => {
  it('docks the panel in a second column beside the session body', () => {
    expect(rule('.terminal-workspace.has-changes-panel')).toContain('grid-template-columns: minmax(0, 1fr) auto');
    expect(rule('.terminal-workspace.has-changes-panel > .terminal-tabbar')).toContain('grid-column: 1 / -1');
    expect(rule('.terminal-workspace.has-changes-panel > .terminal-header')).toContain('grid-column: 1 / -1');
    const panel = rule('.terminal-workspace.has-changes-panel > .changes-panel');
    expect(panel).toContain('grid-column: 2');
    expect(panel).toContain('grid-row: 3 / -1');
    expect(panel).not.toContain('overflow');
    for (const body of ['.terminal-grid', '.structured-agent-body', '.structured-composer']) {
      const placed = rule(`.terminal-workspace.has-changes-panel > ${body}`);
      expect(placed).toContain('grid-column: 1');
      expect(placed).toContain('min-width: 0');
    }
  });

  it('keeps the terminal body in its row when the tab bar is hidden', () => {
    expect(rule('.terminal-workspace.has-changes-panel > .terminal-tabbar')).toContain('grid-row: 1');
    expect(rule('.terminal-workspace.has-changes-panel > .terminal-header')).toContain('grid-row: 2');
    expect(rule('.terminal-workspace.has-changes-panel > .terminal-grid')).toContain('grid-row: 3');
  });

  it('hides the session body without resizing it while the panel is maximized', () => {
    expect(rule('.terminal-workspace.changes-maximized > .changes-panel')).toContain('grid-column: 1 / -1');
    for (const body of ['.terminal-grid', '.structured-agent-body', '.structured-composer']) {
      const hidden = rule(`.terminal-workspace.changes-maximized > ${body}`);
      expect(hidden).toContain('visibility: hidden');
      expect(hidden).not.toContain('display');
    }
    expect(rule('.changes-panel-resize')).toContain('left: -3px');
    expect(rule('.changes-panel')).not.toContain('overflow: hidden');
  });
});
