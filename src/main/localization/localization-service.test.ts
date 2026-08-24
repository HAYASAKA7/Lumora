import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { NAMESPACES } from './locale-pack-loader';
import { LocalizationService } from './localization-service';

const roots: string[] = [];

function root(): string {
  const value = mkdtempSync(join(tmpdir(), 'lumora-localization-service-'));
  roots.push(value);
  return value;
}

function json(path: string, value: unknown): void {
  writeFileSync(path, `${JSON.stringify(value)}\n`, 'utf8');
}

function pack(
  localeRoot: string,
  locale: string,
  greeting: string,
  partial = false
): void {
  const folder = join(localeRoot, locale);
  mkdirSync(folder, { recursive: true });
  json(join(folder, 'manifest.json'), {
    schemaVersion: 1,
    catalogVersion: 1,
    locale,
    displayName: locale,
    direction: locale === 'ar' ? 'rtl' : 'ltr'
  });
  for (const namespace of partial ? ['common'] : NAMESPACES) {
    json(join(folder, `${namespace}.json`), namespace === 'common'
      ? { greeting }
      : { sample: namespace });
  }
}

afterEach(() => {
  for (const value of roots.splice(0)) rmSync(value, { recursive: true, force: true });
});

describe('LocalizationService', () => {
  it('resolves ordered system languages and exposes the formatting locale', () => {
    const bundledRoot = root();
    const userRoot = root();
    pack(bundledRoot, 'en', 'Hello');
    pack(bundledRoot, 'zh-Hant', '你好');

    const service = new LocalizationService({
      preference: 'system',
      preferredSystemLanguages: ['fr-FR', 'zh-HK', 'en-US'],
      bundledRoot,
      userRoot
    });

    expect(service.getSnapshot()).toMatchObject({
      revision: 1,
      preference: 'system',
      locale: 'zh-Hant',
      formattingLocale: 'zh-HK',
      direction: 'ltr'
    });
    expect(service.getTranslator().t('common.greeting')).toBe('你好');
  });

  it('switches explicit language, publishes one immutable snapshot, and ignores no-ops', () => {
    const bundledRoot = root();
    const userRoot = root();
    pack(bundledRoot, 'en', 'Hello');
    pack(bundledRoot, 'ja', 'こんにちは');
    const service = new LocalizationService({
      preference: 'system',
      preferredSystemLanguages: ['en-US'],
      bundledRoot,
      userRoot
    });
    const events: number[] = [];
    const unsubscribe = service.subscribe((snapshot) => events.push(snapshot.revision));

    expect(service.setPreference('ja-JP')).toMatchObject({
      revision: 2,
      preference: 'ja-JP',
      locale: 'ja',
      formattingLocale: 'ja-JP'
    });
    expect(service.setPreference('ja-JP').revision).toBe(2);
    expect(service.reload().snapshot.revision).toBe(2);
    expect(events).toEqual([2]);
    expect(Object.isFrozen(service.getSnapshot())).toBe(true);
    expect(Object.isFrozen(service.getSnapshot().messages)).toBe(true);
    unsubscribe();
    service.setPreference('en');
    expect(events).toEqual([2]);
  });

  it('loads safe user overrides and keeps the prior snapshot after a failed reload', () => {
    const bundledRoot = root();
    const userRoot = root();
    pack(bundledRoot, 'en', 'Hello');
    pack(userRoot, 'en', 'Howdy', true);
    const service = new LocalizationService({
      preference: 'en',
      preferredSystemLanguages: ['en-US'],
      bundledRoot,
      userRoot
    });
    expect(service.getTranslator().t('common.greeting')).toBe('Howdy');
    const prior = service.getSnapshot();
    rmSync(join(bundledRoot, 'en', 'errors.json'));

    expect(() => service.reload()).toThrow('Bundled locale en is invalid.');
    expect(service.getSnapshot()).toBe(prior);
    expect(service.getTranslator().t('common.greeting')).toBe('Howdy');
  });

  it('supports direction metadata for future RTL locale packs', () => {
    const bundledRoot = root();
    const userRoot = root();
    pack(bundledRoot, 'en', 'Hello');
    pack(bundledRoot, 'ar', 'مرحبا');
    const service = new LocalizationService({
      preference: 'ar',
      preferredSystemLanguages: ['en'],
      bundledRoot,
      userRoot
    });
    expect(service.getSnapshot().direction).toBe('rtl');
  });
});
