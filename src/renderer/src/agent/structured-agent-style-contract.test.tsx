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

describe('structured agent workspace style contract', () => {
  it('separates the session title surface from the conversation', () => {
    expect(rule('.structured-agent-header')).toContain('border-bottom: 1px solid var(--line)');
    expect(rule('.structured-agent-header')).toContain('background: var(--surface-subtle)');
    expect(rule('.structured-composer')).toContain('border-top: 0');
  });

  it('keeps every workspace section in its intended row when the tab bar is hidden', () => {
    expect(rule('.structured-agent-workspace > .terminal-tabbar')).toContain('grid-row: 1');
    expect(rule('.structured-agent-header')).toContain('grid-row: 2');
    expect(rule('.structured-agent-body')).toContain('grid-row: 3');
    expect(rule('.structured-composer')).toContain('grid-row: 4');
    expect(rule('.structured-agent-body')).toContain('overflow: auto');
  });

  it('reserves header space for session actions without letting a long title hide them', () => {
    const header = rule('.structured-agent-header');
    expect(header).toContain('display: grid');
    expect(header).toContain('grid-template-columns: minmax(0, 1fr) auto');
    const title = rule('.structured-agent-header h2');
    expect(title).toContain('overflow: hidden');
    expect(title).toContain('text-overflow: ellipsis');
  });

  it('uses the available chat width instead of a narrow centered column', () => {
    const conversation = rule('.structured-conversation');
    expect(conversation).toContain('width: 100%');
    expect(conversation).not.toContain('900px');
  });

  it('sizes message bubbles from their own content without changing the composer', () => {
    const message = rule('.structured-message');
    expect(message).toContain('width: fit-content');
    expect(message).toContain('max-width: 100%');
    expect(rule('.structured-message-user')).toContain('justify-self: end');
    expect(rule('.structured-message-user')).toContain('var(--structured-user-message-surface)');
    expect(rule('.structured-message-assistant')).toContain('justify-self: start');
    expect(rule('.structured-message-assistant')).toContain('var(--structured-agent-message-surface)');
    expect(rule('.structured-composer textarea')).toContain('min-height: 72px');
  });

  it('places the model selector immediately left of the send or pause action', () => {
    const actions = rule('.structured-composer-actions');
    expect(actions).toContain('right: 10px');
    expect(actions).toContain('display: flex');
    expect(rule('.structured-model-select')).not.toContain('position: absolute');
    expect(rule('.structured-composer-action')).toContain('position: static');
  });

  it('uses the unified Lumora selection highlight for command options', () => {
    expect(styles).toContain([
      '.structured-command-option:hover,',
      '.structured-command-option[aria-selected="true"] {',
      '  color: var(--blue);',
      '  background: var(--blue-soft);',
      '}'
    ].join('\n'));
  });

  it('groups provider operations behind one compact process disclosure', () => {
    const process = rule('.structured-process');
    expect(process).toContain('width: fit-content');
    expect(process).toContain('max-width: 100%');
    expect(rule('.structured-process > summary')).toContain('cursor: pointer');
    const command = rule('.structured-activity-command');
    expect(command).toContain('background: var(--surface-subtle)');
    expect(rule('.structured-activity-command summary')).toContain('cursor: pointer');
  });

  it('aligns the agent status with the title baseline instead of centering it', () => {
    expect(rule('.structured-assistant-title')).toContain('align-items: baseline');
    expect(rule('.structured-assistant-title')).not.toContain('align-items: center');
    expect(rule('.structured-assistant-title .runtime-state')).toContain('align-self: baseline');
  });

  it('keeps provisional launch content in the normal chat flow', () => {
    const body = rule('.direct-session-launch-body');
    expect(body).toContain('grid-row: 2');
    expect(body).not.toContain('align-content: center');
    expect(body).not.toContain('justify-items: center');
    expect(body).not.toContain('clamp(24px, 6vw, 72px)');
  });
});
