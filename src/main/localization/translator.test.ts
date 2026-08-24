import { describe, expect, it } from 'vitest';

import { Translator } from './translator';

describe('Translator', () => {
  const translator = new Translator('en-US', {
    greeting: 'Hello, {name}',
    files: '{count, plural, one {# file} other {# files}}',
    mode: '{mode, select, fast {Fast} other {Standard}}'
  });

  it('formats ICU arguments, plurals, and selects', () => {
    expect(translator.t('greeting', { name: 'Lumora' })).toBe('Hello, Lumora');
    expect(translator.t('files', { count: 1 })).toBe('1 file');
    expect(translator.t('files', { count: 3 })).toBe('3 files');
    expect(translator.t('mode', { mode: 'fast' })).toBe('Fast');
  });

  it('returns the semantic key for a missing or invalidly formatted message', () => {
    expect(translator.t('missing.key')).toBe('missing.key');
    expect(translator.t('greeting')).toBe('greeting');
  });

  it('uses the formatting locale for numbers, dates, times, and relative time', () => {
    const japanese = new Translator('ja-JP', {});
    expect(japanese.formatNumber(12_345)).toBe(
      new Intl.NumberFormat('ja-JP').format(12_345)
    );
    const date = new Date('2026-08-24T03:04:05.000Z');
    expect(japanese.formatDate(date, { timeZone: 'UTC' })).toBe(
      new Intl.DateTimeFormat('ja-JP', { dateStyle: 'medium', timeZone: 'UTC' }).format(date)
    );
    expect(japanese.formatTime(date, { timeZone: 'UTC' })).toBe(
      new Intl.DateTimeFormat('ja-JP', { timeStyle: 'short', timeZone: 'UTC' }).format(date)
    );
    expect(japanese.formatRelativeTime(-2, 'day')).toBe(
      new Intl.RelativeTimeFormat('ja-JP', { numeric: 'auto' }).format(-2, 'day')
    );
  });
});
