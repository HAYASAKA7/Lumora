import type { LanguagePreference } from '../../shared/contracts';

const CHINESE_ALIASES = new Map([
  ['zh-CN', 'zh-Hans'],
  ['zh-SG', 'zh-Hans'],
  ['zh-TW', 'zh-Hant'],
  ['zh-HK', 'zh-Hant'],
  ['zh-MO', 'zh-Hant']
]);

function canonicalizeRawLocaleTag(value: string): string | null {
  try {
    return Intl.getCanonicalLocales(value)[0] ?? null;
  } catch {
    return null;
  }
}

export function canonicalizeLocaleTag(value: string): string | null {
  const canonical = canonicalizeRawLocaleTag(value);
  if (canonical === null) return null;
  return CHINESE_ALIASES.get(canonical) ?? canonical;
}

export function localeFallbackChain(value: string): string[] {
  const canonical = canonicalizeLocaleTag(value);
  if (canonical === null) return [];
  const locale = new Intl.Locale(canonical);
  const candidates: string[] = [locale.toString()];
  if (locale.region !== undefined) {
    candidates.push(new Intl.Locale(
      locale.language,
      locale.script === undefined ? {} : { script: locale.script }
    ).toString());
  }
  if (locale.script !== undefined) candidates.push(locale.language);
  return [...new Set(candidates)];
}

function supportedLocale(
  requested: string,
  available: ReadonlySet<string>
): string | null {
  for (const candidate of localeFallbackChain(requested)) {
    if (available.has(candidate)) return candidate;
  }
  return null;
}

export function resolveLocaleSelection(
  preference: LanguagePreference,
  preferredSystemLanguages: readonly string[],
  availableLocales: readonly string[]
): { locale: string; formattingLocale: string } {
  const available = new Set(
    availableLocales
      .map(canonicalizeLocaleTag)
      .filter((locale): locale is string => locale !== null)
  );
  const requests = preference === 'system'
    ? preferredSystemLanguages
    : [preference];
  for (const request of requests) {
    const formattingLocale = canonicalizeRawLocaleTag(request);
    if (formattingLocale === null) continue;
    const locale = supportedLocale(request, available);
    if (locale !== null) return { locale, formattingLocale };
  }
  const fallbackFormattingLocale = preference === 'system'
    ? preferredSystemLanguages
        .map(canonicalizeRawLocaleTag)
        .find((locale): locale is string => locale !== null) ?? 'en'
    : canonicalizeRawLocaleTag(preference) ?? 'en';
  return {
    locale: available.has('en') ? 'en' : [...available][0] ?? 'en',
    formattingLocale: fallbackFormattingLocale
  };
}
