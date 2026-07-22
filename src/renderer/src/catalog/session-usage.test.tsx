import { describe, expect, it } from 'vitest';

import { formatLifetimeTokens } from './session-usage';

describe('formatLifetimeTokens', () => {
  it('formats deterministic compact lifetime totals', () => {
    expect(formatLifetimeTokens(0)).toBe('0 tokens');
    expect(formatLifetimeTokens(999)).toBe('999 tokens');
    expect(formatLifetimeTokens(1_000)).toBe('1K tokens');
    expect(formatLifetimeTokens(12_450)).toBe('12.5K tokens');
    expect(formatLifetimeTokens(1_800_000)).toBe('1.8M tokens');
    expect(formatLifetimeTokens(2_500_000_000)).toBe('2.5B tokens');
  });
});
