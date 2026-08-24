import { describe, expect, it } from 'vitest';

import { resolveMessageCatalog } from './message-catalog';

describe('message catalog fallback', () => {
  it('layers exact, parent, and English catalogs in the specified order', () => {
    const bundled = new Map([
      ['en', { greeting: 'bundled en', englishOnly: 'bundled fallback' }],
      ['zh-Hant', { greeting: 'bundled parent', bundledParent: 'parent' }],
      ['zh-Hant-HK', { greeting: 'bundled exact', exactOnly: 'exact' }]
    ]);
    const user = new Map([
      ['en', { englishOnly: 'user en' }],
      ['zh-Hant', { bundledParent: 'user parent', parentOnly: 'user parent only' }],
      ['zh-Hant-HK', { greeting: 'user exact' }]
    ]);

    expect(resolveMessageCatalog('zh-Hant-HK', bundled, user)).toEqual({
      greeting: 'user exact',
      englishOnly: 'user en',
      bundledParent: 'user parent',
      parentOnly: 'user parent only',
      exactOnly: 'exact'
    });
  });

  it('always retains immutable bundled English below user English', () => {
    expect(resolveMessageCatalog(
      'ko',
      new Map([['en', { cancel: 'Cancel', save: 'Save' }]]),
      new Map([['en', { cancel: 'Never mind' }]])
    )).toEqual({ cancel: 'Never mind', save: 'Save' });
  });
});
