const COMPACT_TOKEN_UNITS = [
  { divisor: 1_000_000_000_000, suffix: 'T' },
  { divisor: 1_000_000_000, suffix: 'B' },
  { divisor: 1_000_000, suffix: 'M' },
  { divisor: 1_000, suffix: 'K' }
] as const;

export function formatLifetimeTokens(total: number): string {
  for (const unit of COMPACT_TOKEN_UNITS) {
    if (total < unit.divisor) {
      continue;
    }

    const scaled = total / unit.divisor;
    const rounded = Math.round((scaled + Number.EPSILON) * 10) / 10;
    const value = scaled >= 100 || Number.isInteger(scaled)
      ? scaled.toFixed(0)
      : rounded.toFixed(1).replace(/\.0$/, '');
    return `${value}${unit.suffix} tokens`;
  }

  return `${total} tokens`;
}
