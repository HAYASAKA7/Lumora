import { createRequire } from 'node:module';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const validatorPath = resolve(
  process.cwd(),
  'scripts/localization/validate-locales.cjs'
);

type ValidationResult = {
  valid: boolean;
  errors: Array<{ code: string; locale: string | null; path: string | null }>;
};

type ValidatorModule = {
  NAMESPACES: readonly string[];
  validateLocaleRoot(root: string): ValidationResult;
};

const roots: string[] = [];

function createRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'lumora-locales-'));
  roots.push(root);
  return root;
}

function writeJson(path: string, value: unknown): void {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function writePack(
  validator: ValidatorModule,
  root: string,
  locale: string,
  overrides: Partial<Record<string, Record<string, unknown>>> = {}
): void {
  const folder = join(root, locale);
  mkdirSync(folder, { recursive: true });
  writeJson(join(folder, 'manifest.json'), {
    schemaVersion: 1,
    catalogVersion: 1,
    locale,
    displayName: locale,
    direction: 'ltr'
  });
  for (const namespace of validator.NAMESPACES) {
    writeJson(join(folder, `${namespace}.json`), overrides[namespace] ?? {
      sample: `${namespace} sample`
    });
  }
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe('locale resource validator', () => {
  it('accepts complete packs with matching English keys and ICU placeholders', () => {
    const validator = require(validatorPath) as ValidatorModule;
    const root = createRoot();
    writePack(validator, root, 'en', {
      common: { greeting: 'Hello {name}', count: '{count, plural, one {# item} other {# items}}' }
    });
    writePack(validator, root, 'ja', {
      common: { greeting: 'こんにちは、{name}', count: '{count, plural, other {# 件}}' }
    });

    expect(validator.validateLocaleRoot(root)).toEqual({ valid: true, errors: [] });
  });

  it('rejects missing namespaces, unsafe keys, invalid ICU, and placeholder drift', () => {
    const validator = require(validatorPath) as ValidatorModule;
    const root = createRoot();
    writePack(validator, root, 'en', {
      common: { greeting: 'Hello {name}', count: '{count, plural, one {# item} other {# items}}' }
    });
    writePack(validator, root, 'ko', {
      common: {
        greeting: '안녕하세요, {user}',
        count: '{count, plural, other {#개}',
        constructor: 'unsafe'
      }
    });
    rmSync(join(root, 'ko', 'errors.json'));

    const result = validator.validateLocaleRoot(root);
    expect(result.valid).toBe(false);
    expect(result.errors.map((error) => error.code)).toEqual(
      expect.arrayContaining([
        'missing-namespace',
        'unsafe-key',
        'invalid-icu',
        'placeholder-mismatch'
      ])
    );
  });

  it('enforces manifest, file-size, nesting, and message-count bounds', () => {
    const validator = require(validatorPath) as ValidatorModule;
    const root = createRoot();
    writePack(validator, root, 'en');
    writeJson(join(root, 'en', 'manifest.json'), {
      schemaVersion: 2,
      catalogVersion: 1,
      locale: 'en',
      displayName: 'English',
      direction: 'ltr'
    });
    writeJson(join(root, 'en', 'common.json'), {
      nested: { too: { far: { down: { for: { a: { locale: { message: 'x' } } } } } } },
      huge: 'x'.repeat(16_385)
    });

    const result = validator.validateLocaleRoot(root);
    expect(result.valid).toBe(false);
    expect(result.errors.map((error) => error.code)).toEqual(
      expect.arrayContaining(['unsupported-schema', 'nesting-limit', 'message-size-limit'])
    );
  });
});
