import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const styles = readFileSync(
  join(process.cwd(), 'src', 'renderer', 'src', 'styles.css'),
  'utf8'
);

function ruleFor(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = styles.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`));
  return match?.[1] ?? '';
}

describe('terminal tab style contract', () => {
  it('removes the tab strip from layout when the sidebar owns session switching', () => {
    expect(ruleFor('.terminal-tabbar[hidden]')).toContain('display: none');
  });

  it('bounds tabs and truncates long session titles without wrapping', () => {
    expect(ruleFor('.terminal-tab')).toContain('max-width:');

    const titleRule = ruleFor('.terminal-tab-title');
    expect(titleRule).toContain('min-width: 0');
    expect(titleRule).toContain('overflow: hidden');
    expect(titleRule).toContain('text-overflow: ellipsis');
    expect(titleRule).toContain('white-space: nowrap');
  });
});
