import { IntlMessageFormat } from 'intl-messageformat';

import type { LocalizationSnapshot } from '../../../shared/contracts';

export type TranslationValues = Record<
  string,
  string | number | bigint | boolean | Date | null | undefined
>;

export function createLocalizationFormatter(snapshot: LocalizationSnapshot) {
  const compiled = new Map<string, IntlMessageFormat>();
  const locale = snapshot.formattingLocale;
  return {
    t(key: string, values?: TranslationValues): string {
      const message = snapshot.messages[key];
      if (message === undefined) return key;
      try {
        let formatter = compiled.get(message);
        if (formatter === undefined) {
          formatter = new IntlMessageFormat(message, locale);
          compiled.set(message, formatter);
        }
        const formatted = formatter.format(values);
        return Array.isArray(formatted) ? formatted.join('') : String(formatted);
      } catch {
        return key;
      }
    },
    formatNumber(value: number | bigint, options?: Intl.NumberFormatOptions) {
      return new Intl.NumberFormat(locale, options).format(value);
    },
    formatDate(value: Date | number, options?: Intl.DateTimeFormatOptions) {
      return new Intl.DateTimeFormat(locale, {
        dateStyle: 'medium',
        ...options
      }).format(value);
    },
    formatTime(value: Date | number, options?: Intl.DateTimeFormatOptions) {
      return new Intl.DateTimeFormat(locale, {
        timeStyle: 'short',
        ...options
      }).format(value);
    },
    formatRelativeTime(
      value: number,
      unit: Intl.RelativeTimeFormatUnit,
      options: Intl.RelativeTimeFormatOptions = { numeric: 'auto' }
    ) {
      return new Intl.RelativeTimeFormat(locale, options).format(value, unit);
    }
  };
}
