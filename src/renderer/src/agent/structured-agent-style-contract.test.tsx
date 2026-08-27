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
  it('keeps the conversation open without a terminal-style header divider', () => {
    expect(rule('.structured-agent-header')).toContain('border-bottom: 0');
    expect(rule('.structured-composer')).toContain('border-top: 0');
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

  it('groups provider operations behind one compact process disclosure', () => {
    const process = rule('.structured-process');
    expect(process).toContain('width: fit-content');
    expect(process).toContain('max-width: 100%');
    expect(rule('.structured-process > summary')).toContain('cursor: pointer');
    const command = rule('.structured-activity-command');
    expect(command).toContain('background: var(--surface-subtle)');
    expect(rule('.structured-activity-command summary')).toContain('cursor: pointer');
  });
});
