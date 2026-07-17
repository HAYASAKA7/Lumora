export interface SemanticVersion {
  raw: string;
  core: readonly [number, number, number];
  prerelease: readonly (number | string)[];
}

const SEMANTIC_VERSION_PATTERN =
  /(?:^|[^0-9A-Za-z.])v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?![0-9A-Za-z.+-])/;

function parseCore(value: string): number | null {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function parsePrerelease(value: string | undefined): readonly (number | string)[] | null {
  if (value === undefined) return [];

  const parsed: Array<number | string> = [];
  for (const identifier of value.split('.')) {
    if (/^\d+$/.test(identifier)) {
      if (identifier.length > 1 && identifier.startsWith('0')) return null;
      const number = Number(identifier);
      if (!Number.isSafeInteger(number)) return null;
      parsed.push(number);
    } else {
      parsed.push(identifier);
    }
  }
  return parsed;
}

export function extractSemanticVersion(output: string): SemanticVersion | null {
  const match = SEMANTIC_VERSION_PATTERN.exec(output);
  if (match === null) return null;

  const major = parseCore(match[1]!);
  const minor = parseCore(match[2]!);
  const patch = parseCore(match[3]!);
  const prerelease = parsePrerelease(match[4]);
  if (major === null || minor === null || patch === null || prerelease === null) {
    return null;
  }

  const raw = `${major}.${minor}.${patch}${
    match[4] === undefined ? '' : `-${match[4]}`
  }`;
  return { raw, core: [major, minor, patch], prerelease };
}

function compareIdentifier(left: number | string, right: number | string): -1 | 0 | 1 {
  if (left === right) return 0;
  if (typeof left === 'number' && typeof right === 'string') return -1;
  if (typeof left === 'string' && typeof right === 'number') return 1;
  return left < right ? -1 : 1;
}

export function compareSemanticVersions(
  left: SemanticVersion,
  right: SemanticVersion
): -1 | 0 | 1 {
  for (let index = 0; index < left.core.length; index += 1) {
    const leftPart = left.core[index]!;
    const rightPart = right.core[index]!;
    if (leftPart !== rightPart) return leftPart < rightPart ? -1 : 1;
  }

  if (left.prerelease.length === 0 && right.prerelease.length === 0) return 0;
  if (left.prerelease.length === 0) return 1;
  if (right.prerelease.length === 0) return -1;

  const length = Math.max(left.prerelease.length, right.prerelease.length);
  for (let index = 0; index < length; index += 1) {
    const leftPart = left.prerelease[index];
    const rightPart = right.prerelease[index];
    if (leftPart === undefined) return -1;
    if (rightPart === undefined) return 1;
    const compared = compareIdentifier(leftPart, rightPart);
    if (compared !== 0) return compared;
  }
  return 0;
}
