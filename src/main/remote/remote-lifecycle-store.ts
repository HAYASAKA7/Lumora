import {
  RemoteExecutionTargetIdSchema,
  RemoteLifecycleEventSchema,
  RemoteLifecycleSnapshotSchema,
  type RemoteDiscoverySnapshot,
  type RemoteExecutionTargetId,
  type RemoteLifecycleEvent,
  type RemoteLifecycleScanState,
  type RemoteLifecycleSnapshot,
  type RemoteSessionCatalog,
  type RemoteTargetSummary
} from '../../shared/contracts';

interface CreateRemoteLifecycleStoreOptions {
  getSummary(id: RemoteExecutionTargetId): RemoteTargetSummary;
}

interface LifecycleEntry {
  generation: number;
  discovery: RemoteDiscoverySnapshot | null;
  catalog: RemoteSessionCatalog | null;
  discoveryState: RemoteLifecycleScanState;
  catalogState: RemoteLifecycleScanState;
  activeTerminalCount: number;
}

export function createRemoteLifecycleStore({
  getSummary
}: CreateRemoteLifecycleStoreOptions) {
  const entries = new Map<RemoteExecutionTargetId, LifecycleEntry>();
  const listeners = new Set<(event: RemoteLifecycleEvent) => void>();

  const entry = (input: RemoteExecutionTargetId): LifecycleEntry => {
    const id = RemoteExecutionTargetIdSchema.parse(input);
    let current = entries.get(id);
    if (current === undefined) {
      current = {
        generation: 0,
        discovery: null,
        catalog: null,
        discoveryState: 'idle',
        catalogState: 'idle',
        activeTerminalCount: 0
      };
      entries.set(id, current);
    }
    return current;
  };

  const snapshot = (
    input: RemoteExecutionTargetId
  ): RemoteLifecycleSnapshot => {
    const id = RemoteExecutionTargetIdSchema.parse(input);
    const current = entry(id);
    return RemoteLifecycleSnapshotSchema.parse({
      summary: getSummary(id),
      ...current
    });
  };

  const publish = (input: RemoteExecutionTargetId): void => {
    const id = RemoteExecutionTargetIdSchema.parse(input);
    const event = RemoteLifecycleEventSchema.parse({
      executionTargetId: id,
      snapshot: snapshot(id)
    });
    for (const listener of listeners) {
      try {
        listener(event);
      } catch {
        // Lifecycle delivery must isolate consumer failures.
      }
    }
  };

  const updateScan = (
    input: RemoteExecutionTargetId,
    generation: number,
    kind: 'discovery' | 'catalog',
    state: RemoteLifecycleScanState,
    value?: RemoteDiscoverySnapshot | RemoteSessionCatalog
  ): void => {
    const id = RemoteExecutionTargetIdSchema.parse(input);
    const current = entry(id);
    if (current.generation !== generation) return;
    if (kind === 'discovery') {
      current.discoveryState = state;
      if (value !== undefined) {
        current.discovery = value as RemoteDiscoverySnapshot;
      }
    } else {
      current.catalogState = state;
      if (value !== undefined) {
        current.catalog = value as RemoteSessionCatalog;
      }
    }
    publish(id);
  };

  return {
    snapshot,
    list(ids: readonly RemoteExecutionTargetId[]): RemoteLifecycleSnapshot[] {
      return ids.map((id) => snapshot(id));
    },
    subscribe(listener: (event: RemoteLifecycleEvent) => void): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    beginConnection(input: RemoteExecutionTargetId): number {
      const id = RemoteExecutionTargetIdSchema.parse(input);
      const current = entry(id);
      current.generation += 1;
      current.discoveryState = current.discovery === null ? 'idle' : 'ready';
      current.catalogState = current.catalog === null ? 'idle' : 'ready';
      current.activeTerminalCount = 0;
      publish(id);
      return current.generation;
    },
    refreshSummary(input: RemoteExecutionTargetId): void {
      publish(input);
    },
    beginDiscovery(input: RemoteExecutionTargetId, generation: number): void {
      updateScan(input, generation, 'discovery', 'refreshing');
    },
    completeDiscovery(
      input: RemoteExecutionTargetId,
      generation: number,
      value: RemoteDiscoverySnapshot
    ): void {
      updateScan(input, generation, 'discovery', 'ready', value);
    },
    failDiscovery(input: RemoteExecutionTargetId, generation: number): void {
      updateScan(input, generation, 'discovery', 'error');
    },
    beginCatalog(input: RemoteExecutionTargetId, generation: number): void {
      updateScan(input, generation, 'catalog', 'refreshing');
    },
    completeCatalog(
      input: RemoteExecutionTargetId,
      generation: number,
      value: RemoteSessionCatalog
    ): void {
      updateScan(input, generation, 'catalog', 'ready', value);
    },
    failCatalog(input: RemoteExecutionTargetId, generation: number): void {
      updateScan(input, generation, 'catalog', 'error');
    },
    setActiveTerminalCount(
      input: RemoteExecutionTargetId,
      count: number
    ): void {
      const id = RemoteExecutionTargetIdSchema.parse(input);
      const current = entry(id);
      current.activeTerminalCount = Math.max(0, Math.trunc(count));
      publish(id);
    },
    invalidateConnection(input: RemoteExecutionTargetId): void {
      const id = RemoteExecutionTargetIdSchema.parse(input);
      const current = entry(id);
      current.discoveryState = current.discovery === null ? 'idle' : 'ready';
      current.catalogState = current.catalog === null ? 'idle' : 'ready';
      current.activeTerminalCount = 0;
      publish(id);
    }
  };
}

export type RemoteLifecycleStore = ReturnType<typeof createRemoteLifecycleStore>;

