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
  it('docks the panel in a second column sized by the width the panel writes', () => {
    expect(rule('.terminal-workspace.has-changes-panel')).toContain(
      'grid-template-columns: minmax(0, 1fr) var(--changes-column-width, 480px)'
    );
    expect(rule('.terminal-workspace.has-changes-panel > .terminal-tabbar')).toContain('grid-column: 1 / -1');
    expect(rule('.terminal-workspace.has-changes-panel > .terminal-header')).toContain('grid-column: 1 / -1');
    const panel = rule('.terminal-workspace.has-changes-panel > .changes-panel');
    expect(panel).toContain('grid-column: 2');
    expect(panel).toContain('grid-row: 3 / -1');
    expect(panel).toContain('width: auto');
    expect(panel).not.toContain('overflow');
    for (const body of ['.terminal-grid', '.structured-agent-body', '.structured-composer']) {
      const placed = rule(`.terminal-workspace.has-changes-panel > ${body}`);
      expect(placed).toContain('grid-column: 1');
      expect(placed).toContain('min-width: 0');
    }
  });

  it('docks the panel beside the workspace page content under a full width toolbar', () => {
    expect(rule('.workspace-detail.has-changes-panel')).toContain(
      'grid-template-columns: minmax(0, 1fr) var(--changes-column-width, 480px)'
    );
    expect(rule('.workspace-detail.has-changes-panel > .workspace-detail-toolbar')).toContain('grid-column: 1 / -1');
    const main = rule('.workspace-detail.has-changes-panel > .workspace-detail-main');
    expect(main).toContain('grid-column: 1');
    expect(main).toContain('grid-row: 2');
    const panel = rule('.workspace-detail.has-changes-panel > .changes-panel');
    expect(panel).toContain('grid-column: 2');
    expect(panel).toContain('width: auto');
    expect(rule('.workspace-detail.changes-maximized > .changes-panel')).toContain('grid-column: 1 / -1');
    // A maximized panel hides the sessions but leaves the toolbar in the first row.
    expect(rule('.workspace-detail.changes-maximized > .workspace-detail-main')).toContain('display: none');
  });

  it('takes the docked panel height from the measured viewport rather than a fixed size', () => {
    const panel = rule('.workspace-detail.has-changes-panel > .changes-panel');
    expect(panel).toContain('position: sticky');
    expect(panel).toContain('height: var(--changes-panel-visible-height, auto)');
    expect(panel).toContain('max-height: var(--changes-panel-visible-height, none)');
    expect(panel).not.toContain('100vh');
    expect(panel).not.toContain('min-height');
  });

  it('stacks the panel under the sessions on a narrow workspace page', () => {
    const narrow = ".workspace-detail.has-changes-panel[data-changes-layout='stacked']";
    expect(rule(narrow)).toContain('grid-template-columns: minmax(0, 1fr)');
    const stacked = rule(`${narrow} > .changes-panel`);
    expect(stacked).toContain('position: static');
    expect(stacked).toContain('grid-column: 1');
    expect(rule(".workspace-detail[data-changes-layout='stacked'] .changes-panel-resize")).toContain('display: none');
  });

  it('clamps the panel width in script rather than with a percentage', () => {
    const panel = rule('.changes-panel');
    expect(panel).toContain('width: var(--changes-column-width, 480px)');
    expect(panel).not.toContain('max-width');
    expect(panel).not.toContain('overflow: hidden');
  });

  it('pins the terminal rows whether or not a panel is open', () => {
    expect(rule('.terminal-workspace > .terminal-tabbar')).toContain('grid-row: 1');
    expect(rule('.terminal-workspace > .terminal-header')).toContain('grid-row: 2');
    expect(rule('.terminal-workspace > .terminal-grid')).toContain('grid-row: 3');
  });

  it('hides the session body without resizing its column while the panel is maximized', () => {
    expect(rule('.terminal-workspace.changes-maximized > .changes-panel')).toContain('grid-column: 1 / -1');
    expect(styles).not.toMatch(/\.changes-maximized[^{]*\{[^}]*grid-template-columns/);
    for (const body of ['.terminal-grid', '.structured-agent-body', '.structured-composer']) {
      const hidden = rule(`.terminal-workspace.changes-maximized > ${body}`);
      expect(hidden).toContain('visibility: hidden');
      expect(hidden).not.toContain('display');
    }
  });

  it('shows a guide at the dragged edge only while dragging', () => {
    expect(rule('.changes-panel-resize')).toContain('left: -3px');
    const guide = rule('.changes-panel-resize::after');
    expect(guide).toContain('display: none');
    expect(guide).toContain('transform: translateX(var(--changes-resize-guide-offset, 0px))');
    expect(guide).toContain('pointer-events: none');
    expect(rule(".changes-panel-resize[data-dragging='true']::after")).toContain('display: block');
  });
});
