import type { ChangedFile } from '../../shared/changes';

export interface NameStatusEntry {
  status: ChangedFile['status'];
  path: string;
  oldPath: string | null;
}

export interface LineCounts {
  additions: number | null;
  deletions: number | null;
  binary: boolean;
}

const UNKNOWN_COUNTS: LineCounts = { additions: null, deletions: null, binary: false };

const STATUS: Readonly<Record<string, ChangedFile['status']>> = {
  A: 'added',
  M: 'modified',
  D: 'deleted',
  R: 'renamed',
  C: 'added',
  T: 'type-changed'
};

function fields(output: Buffer): string[] {
  const parts = output.toString('utf8').split('\0');
  if (parts.at(-1) === '') parts.pop();
  return parts;
}

/** Git reports paths relative to the workspace; anything else is dropped rather than trusted. */
export function isContainedPath(path: string): boolean {
  if (path.length === 0 || /^[\\/]/.test(path) || /^[A-Za-z]:/.test(path)) {
    return false;
  }
  return !path.split(/[\\/]/).some((segment) => segment === '..');
}

function parseCount(value: string): number | null {
  return /^\d+$/.test(value) ? Number(value) : null;
}

/** Reads `git diff-tree -z --name-status` output. */
export function parseNameStatus(output: Buffer): NameStatusEntry[] {
  const parts = fields(output);
  const entries: NameStatusEntry[] = [];
  for (let index = 0; index < parts.length;) {
    const code = parts[index++] ?? '';
    const status = STATUS[code.charAt(0)];
    if (code.startsWith('R') || code.startsWith('C')) {
      const oldPath = parts[index++] ?? '';
      const path = parts[index++] ?? '';
      if (status !== undefined && isContainedPath(path) && isContainedPath(oldPath)) {
        entries.push({ status, path, oldPath: code.startsWith('R') ? oldPath : null });
      }
      continue;
    }
    const path = parts[index++] ?? '';
    if (status !== undefined && isContainedPath(path)) entries.push({ status, path, oldPath: null });
  }
  return entries;
}

/** Reads `git diff-tree -z --numstat` output, keyed by the (new) path. */
export function parseNumstat(output: Buffer): Map<string, LineCounts> {
  const parts = fields(output);
  const counts = new Map<string, LineCounts>();
  for (let index = 0; index < parts.length;) {
    const [added = '', deleted = '', inlinePath = ''] = (parts[index++] ?? '').split('\t');
    let path = inlinePath;
    if (inlinePath === '') {
      index++; // the old path of a rename or copy
      path = parts[index++] ?? '';
    }
    if (!isContainedPath(path)) continue;
    const binary = added === '-' && deleted === '-';
    counts.set(path, {
      additions: binary ? null : parseCount(added),
      deletions: binary ? null : parseCount(deleted),
      binary
    });
  }
  return counts;
}

export function mergeChangedFiles(
  entries: readonly NameStatusEntry[],
  counts: ReadonlyMap<string, LineCounts>
): ChangedFile[] {
  return entries
    .map((entry) => ({
      path: entry.path,
      oldPath: entry.oldPath,
      status: entry.status,
      ...(counts.get(entry.path) ?? UNKNOWN_COUNTS)
    }))
    .sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0));
}
