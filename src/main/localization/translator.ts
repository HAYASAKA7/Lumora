import { IntlMessageFormat } from 'intl-messageformat';

export type TranslationValues = Record<
  string,
  string | number | bigint | boolean | Date | null | undefined
>;

export class Translator {
  private readonly compiled = new Map<string, IntlMessageFormat>();

  constructor(
    private readonly locale: string,
    private readonly messages: Readonly<Record<string, string>>
  ) {}

  t(key: string, values?: TranslationValues): string {
    const message = this.messages[key];
    if (message === undefined) return key;
    try {
      let formatter = this.compiled.get(message);
      if (formatter === undefined) {
        formatter = new IntlMessageFormat(message, this.locale);
        this.compiled.set(message, formatter);
      }
      const formatted = formatter.format(values);
      return Array.isArray(formatted) ? formatted.join('') : String(formatted);
    } catch {
      return key;
    }
  }

  formatNumber(
    value: number | bigint,
    options?: Intl.NumberFormatOptions
  ): string {
    return new Intl.NumberFormat(this.locale, options).format(value);
  }

  formatDate(
    value: Date | number,
    options?: Intl.DateTimeFormatOptions
  ): string {
    return new Intl.DateTimeFormat(this.locale, {
      dateStyle: 'medium',
      ...options
    }).format(value);
  }

  formatTime(
    value: Date | number,
    options?: Intl.DateTimeFormatOptions
  ): string {
    return new Intl.DateTimeFormat(this.locale, {
      timeStyle: 'short',
      ...options
    }).format(value);
  }

  formatRelativeTime(
    value: number,
    unit: Intl.RelativeTimeFormatUnit,
    options: Intl.RelativeTimeFormatOptions = { numeric: 'auto' }
  ): string {
    return new Intl.RelativeTimeFormat(this.locale, options).format(value, unit);
  }
}
