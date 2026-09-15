import type { Snapshot } from './snapshot-targets';
import type { WorkspaceSnapshotEngine } from './workspace-snapshot-engine';

interface CachedSnapshot {
  takenAt: number;
  snapshot: Promise<Snapshot>;
}

/** The latest snapshot per workspace, reused for a short time so several views share one git run. */
export class SnapshotCache {
  private readonly entries = new Map<string, CachedSnapshot>();

  constructor(
    private readonly engine: Pick<WorkspaceSnapshotEngine, 'snapshot'>,
    private readonly clock: () => Date,
    private readonly ttlMs: number
  ) {}

  get(workspaceId: string, workspacePath: string, fresh: boolean): Promise<Snapshot> {
    const now = this.clock().getTime();
    const cached = this.entries.get(workspaceId);
    if (!fresh && cached !== undefined && now - cached.takenAt < this.ttlMs) {
      return cached.snapshot;
    }
    const entry: CachedSnapshot = { takenAt: now, snapshot: this.engine.snapshot(workspaceId, workspacePath) };
    this.entries.set(workspaceId, entry);
    entry.snapshot.catch(() => {
      if (this.entries.get(workspaceId) === entry) this.entries.delete(workspaceId);
    });
    return entry.snapshot;
  }

  /** Stores a snapshot taken elsewhere, such as a session's baseline. */
  set(workspaceId: string, snapshot: Snapshot): void {
    this.entries.set(workspaceId, { takenAt: this.clock().getTime(), snapshot: Promise.resolve(snapshot) });
  }

  delete(workspaceId: string): void {
    this.entries.delete(workspaceId);
  }
}
