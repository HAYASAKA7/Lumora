import { createRequire } from 'node:module';
import { resolve } from 'node:path';
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
});
