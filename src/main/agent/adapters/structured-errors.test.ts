import { describe, expect, it } from 'vitest';

import {
  claudeErrorKind,
  codexErrorKind,
  epochSeconds,
  httpStatusErrorKind,
  providerWords
} from './structured-errors';

describe('structured error kinds', () => {
  it('reads Codex error info whether it is a bare name or a keyed object', () => {
    expect(codexErrorKind('usageLimitExceeded')).toBe('usage_limit');
    expect(codexErrorKind('sessionBudgetExceeded')).toBe('usage_limit');
    expect(codexErrorKind('rateLimitExceeded')).toBe('rate_limit');
    expect(codexErrorKind('contextWindowExceeded')).toBe('context_full');
    expect(codexErrorKind('serverOverloaded')).toBe('overloaded');
    expect(codexErrorKind({ responseStreamDisconnected: { httpStatusCode: 502 } })).toBe('connection');
    expect(codexErrorKind('unauthorized')).toBe('sign_in');
    expect(codexErrorKind('cyberPolicy')).toBe('rejected');
    expect(codexErrorKind('somethingNew')).toBe('other');
    expect(codexErrorKind(null)).toBe('other');
  });

  it('reads Claude API error names', () => {
    expect(claudeErrorKind('rate_limit')).toBe('rate_limit');
    expect(claudeErrorKind('overloaded')).toBe('overloaded');
    expect(claudeErrorKind('authentication_failed')).toBe('sign_in');
    expect(claudeErrorKind('billing_error')).toBe('account');
    expect(claudeErrorKind('model_not_found')).toBe('rejected');
    expect(claudeErrorKind('max_output_tokens')).toBe('other');
  });

  it('falls back on an HTTP status when that is all there is', () => {
    expect(httpStatusErrorKind(429)).toBe('rate_limit');
    expect(httpStatusErrorKind(401)).toBe('sign_in');
    expect(httpStatusErrorKind(402)).toBe('account');
    expect(httpStatusErrorKind(529)).toBe('overloaded');
    expect(httpStatusErrorKind(503)).toBe('overloaded');
    expect(httpStatusErrorKind(400)).toBe('rejected');
    expect(httpStatusErrorKind(null)).toBe('other');
  });

  it('keeps reset times in seconds whichever unit the provider used', () => {
    expect(epochSeconds(1_788_000_000)).toBe(1_788_000_000);
    expect(epochSeconds(1_788_000_000_500)).toBe(1_788_000_000);
    expect(epochSeconds(0)).toBeNull();
    expect(epochSeconds('soon')).toBeNull();
  });

  it('keeps the provider\'s words, cut to fit, and nothing when it gave none', () => {
    expect(providerWords('  Rate limit reached.  ')).toBe('Rate limit reached.');
    expect(providerWords('')).toBeNull();
    expect(providerWords(undefined)).toBeNull();
    expect(providerWords('x'.repeat(2_000))).toHaveLength(1_024);
  });
});
