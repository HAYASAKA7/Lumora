import { PROVIDER_IDS } from '../../../shared/contracts';
import { providerDefinition } from '../../../shared/provider-definitions';

type FormatNumber = (value: number, options?: Intl.NumberFormatOptions) => string;

export function formatBytes(bytes: number, formatNumber: FormatNumber): string {
  if (bytes < 1024 * 1024) return `${formatNumber(Math.round(bytes / 1024))} KB`;
  if (bytes < 1024 * 1024 * 1024) {
    return `${formatNumber(bytes / (1024 * 1024), { minimumFractionDigits: 1, maximumFractionDigits: 1 })} MB`;
  }
  return `${formatNumber(bytes / (1024 * 1024 * 1024), { minimumFractionDigits: 1, maximumFractionDigits: 1 })} GB`;
}

/** Milliseconds below a second, then seconds to one decimal, in the reader's own units. */
export function formatDuration(milliseconds: number, formatNumber: FormatNumber): string {
  if (milliseconds < 1_000) {
    return formatNumber(milliseconds, { style: 'unit', unit: 'millisecond', unitDisplay: 'short' });
  }
  return formatNumber(milliseconds / 1_000, {
    style: 'unit',
    unit: 'second',
    unitDisplay: 'short',
    minimumFractionDigits: 1,
    maximumFractionDigits: 1
  });
}

/** A provider's display name, or the identifier as recorded when Lumora does not know it. */
export function providerName(provider: string): string {
  return (PROVIDER_IDS as readonly string[]).includes(provider)
    ? providerDefinition(provider as (typeof PROVIDER_IDS)[number]).displayName
    : provider;
}
