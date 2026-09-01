import type { StructuredAgentDiffFile } from '../../../shared/agent/contracts';

const maximumPatchLength = 262_144;
const maximumFiles = 64;

function cleanGitPath(value: string): string | null {
  const trimmed = value.trim().replace(/^"|"$/g, '');
  if (trimmed === '/dev/null') return null;
  return trimmed.replace(/^[ab]\//, '') || null;
}

function countChanges(patch: string): { additions: number; deletions: number } {
  let additions = 0;
  let deletions = 0;
  for (const line of patch.split('\n')) {
    if (line.startsWith('+') && !line.startsWith('+++')) additions += 1;
    else if (line.startsWith('-') && !line.startsWith('---')) deletions += 1;
  }
  return { additions, deletions };
}

function parseSection(section: string): StructuredAgentDiffFile | null {
  const oldHeader = section.match(/^---\s+(.+)$/m)?.[1];
  const newHeader = section.match(/^\+\+\+\s+(.+)$/m)?.[1];
  const gitHeader = section.match(/^diff --git\s+a\/(.+?)\s+b\/(.+)$/m);
  const oldPath = oldHeader === undefined
    ? gitHeader?.[1] ?? null
    : cleanGitPath(oldHeader.split('\t')[0]!);
  const newPath = newHeader === undefined
    ? gitHeader?.[2] ?? null
    : cleanGitPath(newHeader.split('\t')[0]!);
  const pathLabel = newPath ?? oldPath;
  if (pathLabel === null || pathLabel === undefined) return null;
  const patch = section.trim().slice(0, maximumPatchLength);
  if (patch.length === 0) return null;
  const counts = countChanges(patch);
  return {
    pathLabel,
    oldPathLabel: oldPath !== null && oldPath !== pathLabel ? oldPath : null,
    additions: counts.additions,
    deletions: counts.deletions,
    patch
  };
}

export function parseGitUnifiedDiff(diff: string): StructuredAgentDiffFile[] {
  const normalized = diff.replace(/\r\n/g, '\n').trim();
  if (normalized === '') return [];
  const starts = [...normalized.matchAll(/^diff --git /gm)].map(({ index }) => index!);
  if (starts.length === 0) {
    const counts = countChanges(normalized);
    return [{
      pathLabel: 'Workspace changes',
      oldPathLabel: null,
      additions: counts.additions,
      deletions: counts.deletions,
      patch: normalized.slice(0, maximumPatchLength)
    }];
  }
  return starts.slice(0, maximumFiles).flatMap((start, index) => {
    const end = starts[index + 1] ?? normalized.length;
    const parsed = parseSection(normalized.slice(start, end));
    return parsed === null ? [] : [parsed];
  });
}

export function createFullTextUnifiedDiff(
  pathLabel: string,
  oldText: string | null,
  newText: string
): StructuredAgentDiffFile {
  const oldLines = oldText === null ? [] : oldText.replace(/\r\n/g, '\n').split('\n');
  const newLines = newText.replace(/\r\n/g, '\n').split('\n');
  const patch = [
    `--- ${oldText === null ? '/dev/null' : `a/${pathLabel}`}`,
    `+++ b/${pathLabel}`,
    `@@ -1,${oldLines.length} +1,${newLines.length} @@`,
    ...oldLines.map((line) => `-${line}`),
    ...newLines.map((line) => `+${line}`)
  ].join('\n').slice(0, maximumPatchLength);
  const counts = countChanges(patch);
  return {
    pathLabel: pathLabel.slice(0, 4_096),
    oldPathLabel: null,
    additions: counts.additions,
    deletions: counts.deletions,
    patch
  };
}
