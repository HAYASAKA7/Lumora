import { StableApplicationVersionSchema } from '../../shared/contracts';

function components(value: string): readonly [bigint, bigint, bigint] | null {
  const parsed = StableApplicationVersionSchema.safeParse(value);
  if (!parsed.success) return null;
  const values = parsed.data.split('.').map((part) => BigInt(part));
  return [values[0]!, values[1]!, values[2]!];
}

export function normalizeStableApplicationVersion(value: string): string | null {
  const parsed = components(value);
  return parsed === null ? null : parsed.map(String).join('.');
}

export function compareStableApplicationVersions(
  left: string,
  right: string
): -1 | 0 | 1 | null {
  const leftParts = components(left);
  const rightParts = components(right);
  if (leftParts === null || rightParts === null) return null;
  for (let index = 0; index < 3; index += 1) {
    if (leftParts[index]! < rightParts[index]!) return -1;
    if (leftParts[index]! > rightParts[index]!) return 1;
  }
  return 0;
}
