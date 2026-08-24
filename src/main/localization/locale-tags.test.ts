import { describe, expect, it } from 'vitest';

import {
  canonicalizeLocaleTag,
  localeFallbackChain,
  resolveLocaleSelection
} from './locale-tags';

describe('locale tags', () => {
  it.each([
    ['en-us', 'en-US'],
    ['zh-CN', 'zh-Hans'],
    ['zh-SG', 'zh-Hans'],
    ['zh-TW', 'zh-Hant'],
    ['zh-HK', 'zh-Hant'],
    ['zh-MO', 'zh-Hant'],
    ['zh-Hans-CN', 'zh-Hans-CN'],
    ['zh-Hant-TW', 'zh-Hant-TW']
  ])('canonicalizes %s as %s', (input, expected) => {
    expect(canonicalizeLocaleTag(input)).toBe(expected);
  });

  it('rejects malformed tags and builds script-aware parent fallbacks', () => {
    expect(canonicalizeLocaleTag('not_a_locale')).toBeNull();
    expect(localeFallbackChain('zh-Hant-HK')).toEqual([
      'zh-Hant-HK',
      'zh-Hant',
      'zh'
    ]);
    expect(localeFallbackChain('en-US')).toEqual(['en-US', 'en']);
  });

  it('uses ordered system languages and preserves the formatting locale', () => {
    expect(resolveLocaleSelection(
      'system',
      ['fr-FR', 'zh-HK', 'en-US'],
      ['en', 'zh-Hans', 'zh-Hant', 'ja', 'ko']
    )).toEqual({ locale: 'zh-Hant', formattingLocale: 'zh-HK' });
  });

  it('uses an explicit supported locale and falls back to English', () => {
    expect(resolveLocaleSelection(
      'ja-JP',
      ['zh-CN'],
      ['en', 'ja']
    )).toEqual({ locale: 'ja', formattingLocale: 'ja-JP' });
    expect(resolveLocaleSelection(
      'de-DE',
      ['zh-CN'],
      ['en', 'ja']
    )).toEqual({ locale: 'en', formattingLocale: 'de-DE' });
  });
});
