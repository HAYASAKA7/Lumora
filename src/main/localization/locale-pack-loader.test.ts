import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { NAMESPACES, loadLocalePacks } from './locale-pack-loader';

const roots: string[] = [];

function root(): string {
  const value = mkdtempSync(join(tmpdir(), 'lumora-pack-loader-'));
  roots.push(value);
  return value;
}

function json(path: string, value: unknown): void {
  writeFileSync(path, `${JSON.stringify(value)}\n`, 'utf8');
}

function pack(
  localeRoot: string,
  locale: string,
  options: {
    partial?: boolean;
    schemaVersion?: number;
    catalogVersion?: number;
    common?: Record<string, unknown>;
  } = {}
): string {
  const folder = join(localeRoot, locale);
  mkdirSync(folder, { recursive: true });
  json(join(folder, 'manifest.json'), {
    schemaVersion: options.schemaVersion ?? 1,
    catalogVersion: options.catalogVersion ?? 1,
    locale,
    displayName: locale === 'en' ? 'English' : locale,
    direction: 'ltr'
  });
  const namespaces = options.partial ? ['common'] : NAMESPACES;
  for (const namespace of namespaces) {
    json(join(folder, `${namespace}.json`), namespace === 'common'
      ? options.common ?? { actions: { cancel: 'Cancel' } }
      : { sample: `${namespace} sample` });
  }
  return folder;
}

afterEach(() => {
  for (const value of roots.splice(0)) rmSync(value, { recursive: true, force: true });
});

describe('locale pack loader', () => {
  it('loads ordered user roots with the Mods root taking precedence', () => {
    const bundledRoot = root();
    const legacyRoot = root();
    const modsRoot = root();
    pack(bundledRoot, 'en', {
      common: { actions: { cancel: 'Cancel', confirm: 'Confirm' } }
    });
    pack(legacyRoot, 'en', {
      partial: true,
      common: { actions: { cancel: 'Legacy' } }
    });
    pack(modsRoot, 'en', {
      partial: true,
      common: { actions: { confirm: 'Mods confirm' } }
    });

    const result = loadLocalePacks({
      bundledRoot,
      userRoots: [legacyRoot, modsRoot]
    });

    expect(result.user.get('en')?.messages['common.actions.cancel']).toBe('Legacy');
    expect(result.user.get('en')?.messages['common.actions.confirm']).toBe(
      'Mods confirm'
    );
    expect(result.loadedUserPacks).toBe(1);
  });

  it('loads complete bundles and safe partial user overrides', () => {
    const bundledRoot = root();
    const userRoot = root();
    pack(bundledRoot, 'en');
    pack(bundledRoot, 'ja');
    pack(userRoot, 'ja', {
      partial: true,
      common: { actions: { cancel: 'やめる' } }
    });

    const result = loadLocalePacks({ bundledRoot, userRoot });

    expect(result.bundled.get('en')?.messages['common.actions.cancel']).toBe('Cancel');
    expect(result.user.get('ja')?.messages).toEqual({
      'common.actions.cancel': 'やめる'
    });
    expect(result.summaries).toEqual([
      expect.objectContaining({ locale: 'en', sources: ['bundled'] }),
      expect.objectContaining({ locale: 'ja', sources: ['bundled', 'user'] })
    ]);
    expect(result.loadedUserPacks).toBe(1);
    expect(result.rejectedUserPacks).toBe(0);
  });

  it('rejects invalid user packs while retaining every valid pack', () => {
    const bundledRoot = root();
    const userRoot = root();
    pack(bundledRoot, 'en');
    pack(userRoot, 'ja', { partial: true });
    const invalid = pack(userRoot, 'ko', { partial: true });
    writeFileSync(join(invalid, 'common.json'), '{broken', 'utf8');
    const unsupported = pack(userRoot, 'zh-Hans', {
      partial: true,
      schemaVersion: 2
    });
    json(join(unsupported, 'common.json'), { actions: { cancel: '取消' } });

    const result = loadLocalePacks({ bundledRoot, userRoot });

    expect(result.user.has('ja')).toBe(true);
    expect(result.user.has('ko')).toBe(false);
    expect(result.user.has('zh-Hans')).toBe(false);
    expect(result.loadedUserPacks).toBe(1);
    expect(result.rejectedUserPacks).toBe(2);
    expect(result.warnings.map((warning) => warning.code)).toEqual(
      expect.arrayContaining(['invalid-user-pack', 'unsupported-schema'])
    );
  });

  it('ignores unknown override keys and warns about catalog-version drift', () => {
    const bundledRoot = root();
    const userRoot = root();
    pack(bundledRoot, 'en');
    pack(userRoot, 'en', {
      partial: true,
      catalogVersion: 2,
      common: {
        actions: { cancel: 'Never mind' },
        injected: 'Unknown'
      }
    });

    const result = loadLocalePacks({ bundledRoot, userRoot });

    expect(result.user.get('en')?.messages).toEqual({
      'common.actions.cancel': 'Never mind'
    });
    expect(result.warnings.map((warning) => warning.code)).toEqual(
      expect.arrayContaining(['catalog-version-mismatch', 'unknown-message-key'])
    );
  });

  it('rejects files that escape the locale root through a symbolic link', () => {
    const bundledRoot = root();
    const userRoot = root();
    const outside = root();
    pack(bundledRoot, 'en');
    const folder = pack(userRoot, 'ja', { partial: true });
    const outsideFile = join(outside, 'common.json');
    json(outsideFile, { actions: { cancel: 'Outside' } });
    rmSync(join(folder, 'common.json'));
    try {
      symlinkSync(outsideFile, join(folder, 'common.json'), 'file');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EPERM') return;
      throw error;
    }

    const result = loadLocalePacks({ bundledRoot, userRoot });

    expect(result.user.has('ja')).toBe(false);
    expect(result.rejectedUserPacks).toBe(1);
  });

  it('rejects a symbolic-link user locale root', () => {
    const bundledRoot = root();
    const outside = root();
    const linkParent = root();
    const userRoot = join(linkParent, 'locales');
    pack(bundledRoot, 'en');
    pack(outside, 'ja', { partial: true });
    try {
      symlinkSync(outside, userRoot, 'junction');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EPERM') return;
      throw error;
    }

    expect(() => loadLocalePacks({ bundledRoot, userRoot })).toThrow(
      'Locale root must be a regular directory.'
    );
  });

  it('throws when immutable bundled English is absent or invalid', () => {
    const bundledRoot = root();
    const userRoot = root();
    expect(() => loadLocalePacks({ bundledRoot, userRoot })).toThrow(
      'Bundled English locale is required.'
    );
    const english = pack(bundledRoot, 'en');
    rmSync(join(english, 'errors.json'));
    expect(() => loadLocalePacks({ bundledRoot, userRoot })).toThrow(
      'Bundled locale en is invalid.'
    );
  });
});
