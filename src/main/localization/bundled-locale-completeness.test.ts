import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const validatorPath = resolve(process.cwd(), 'scripts/localization/validate-locales.cjs');

type ValidationResult = {
  valid: boolean;
  errors: Array<{ code: string; locale: string | null; path: string | null }>;
};

type ValidatorModule = {
  validateLocaleRoot(root: string): ValidationResult;
};

const bundledLocales = ['en', 'zh-Hans', 'zh-Hant', 'ja', 'ko'];

describe('bundled locale resources', () => {
  it('ships every supported locale with exact English key and ICU placeholder parity', () => {
    const validator = require(validatorPath) as ValidatorModule;
    const localeRoot = resolve(process.cwd(), 'resources/locales');

    expect(validator.validateLocaleRoot(localeRoot)).toEqual({ valid: true, errors: [] });

    for (const locale of bundledLocales) {
      expect(resolve(localeRoot, locale)).toSatisfy((folder: string) => {
        try {
          return require('node:fs').statSync(folder).isDirectory();
        } catch {
          return false;
        }
      });
    }
  });

  it('uses native product terminology instead of literal machine translations', () => {
    const localeRoot = resolve(process.cwd(), 'resources/locales');
    const readNamespace = (locale: string, namespace: string) => JSON.parse(
      readFileSync(resolve(localeRoot, locale, `${namespace}.json`), 'utf8')
    ) as Record<string, any>;

    expect(readNamespace('zh-Hans', 'settings').tabs.general).toBe('通用');
    expect(readNamespace('zh-Hans', 'settings').general.title).toBe('通用');
    expect(readNamespace('zh-Hans', 'providers').actions['open-guide']).toBe('打开安装指南');
    expect(readNamespace('zh-Hant', 'providers').actions['open-guide']).toBe('開啟安裝指南');
    expect(readNamespace('ja', 'providers').actions['open-guide']).toBe('インストールガイドを開く');
    expect(readNamespace('ko', 'providers').actions['open-guide']).toBe('설치 가이드 열기');

    const rejectedFragments: Record<string, string[]> = {
      'zh-Hans': ['只有发射', '开放安装指南', '这让人感到清爽', '洗衣机', '进口会话', '人工智能'],
      'zh-Hant': ['只有發射', '開放安裝指南', '這讓人感到清爽', '洗衣機', '進口工作階段', '人工智慧'],
      ja: ['洗濯機', 'セッションを輸入', 'プロバイダーを輸入', '人工知能'],
      ko: ['스피프', '신선하게', '세션들을 수입', '근접 보조기', '인공지능']
    };

    for (const [locale, fragments] of Object.entries(rejectedFragments)) {
      const catalog = bundledLocales
        .includes(locale)
        ? ['common', 'shell', 'catalog', 'terminal', 'settings', 'providers', 'remote', 'transfer', 'errors']
            .map((namespace) => readFileSync(resolve(localeRoot, locale, `${namespace}.json`), 'utf8'))
            .join('\n')
        : '';
      for (const fragment of fragments) {
        expect(catalog, `${locale} must not contain ${fragment}`).not.toContain(fragment);
      }
    }
  });
});
