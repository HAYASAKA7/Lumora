import type { ChangedFileEntry } from '../../shared/changes';
import type { WorkspaceSnapshotEngine } from './workspace-snapshot-engine';

type ListChangedFiles = WorkspaceSnapshotEngine['changedFiles'];

interface CachedFiles {
  takenAt: number;
  files: Promise<ChangedFileEntry[]>;
}

/** Tree pairs remembered at once; each open panel and each session view uses one. */
const MAX_ENTRIES = 16;

/**
 * The file list per workspace and pair of trees, reused for a short time so a
 * diff opened right after a summary does not list every changed file again.
 */
export class ChangedFilesCache {
  private readonly entries = new Map<string, CachedFiles>();

  constructor(
    private readonly list: ListChangedFiles,
    private readonly clock: () => Date,
    private readonly ttlMs: number
  ) {}

  get(workspaceId: string, workspacePath: string, fromTree: string, toTree: string): Promise<ChangedFileEntry[]> {
    const now = this.clock().getTime();
    const key = `${workspaceId}:${fromTree}:${toTree}`;
    const cached = this.entries.get(key);
    if (cached !== undefined && now - cached.takenAt < this.ttlMs) return cached.files;
    const entry: CachedFiles = { takenAt: now, files: this.list(workspaceId, workspacePath, fromTree, toTree) };
    this.entries.set(key, entry);
    entry.files.catch(() => {
      if (this.entries.get(key) === entry) this.entries.delete(key);
    });
    this.prune(now);
    return entry.files;
  }

  private prune(now: number): void {
    for (const [key, entry] of this.entries) {
      if (now - entry.takenAt >= this.ttlMs) this.entries.delete(key);
    }
    // Map keys come back in insertion order, so the oldest entry goes first.
    for (const key of this.entries.keys()) {
      if (this.entries.size <= MAX_ENTRIES) break;
      this.entries.delete(key);
    }
  }
}
