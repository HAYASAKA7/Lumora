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
});
