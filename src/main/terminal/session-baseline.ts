/**
 * The native session IDs that existed before a new session started, sorted and
 * without repeats. Throws for a list too large or holding an invalid identity.
 */
export function normalizeSessionBaseline(values: readonly string[]): string[] {
  if (values.length > 25_000) {
    throw new Error('The session baseline is too large.');
  }
  const normalized = values.map((value) => value.trim());
  if (normalized.some((value) => value.length === 0 || value.length > 256)) {
    throw new Error('The session baseline contains an invalid identity.');
  }
  return [...new Set(normalized)].sort();
}
