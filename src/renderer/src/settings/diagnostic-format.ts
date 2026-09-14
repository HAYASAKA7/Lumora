type FormatNumber = (value: number, options?: Intl.NumberFormatOptions) => string;

export function formatBytes(bytes: number, formatNumber: FormatNumber): string {
  if (bytes < 1024 * 1024) return `${formatNumber(Math.round(bytes / 1024))} KB`;
  if (bytes < 1024 * 1024 * 1024) {
    return `${formatNumber(bytes / (1024 * 1024), { minimumFractionDigits: 1, maximumFractionDigits: 1 })} MB`;
  }
  return `${formatNumber(bytes / (1024 * 1024 * 1024), { minimumFractionDigits: 1, maximumFractionDigits: 1 })} GB`;
}
