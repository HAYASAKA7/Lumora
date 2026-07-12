import type { ProviderId } from '../../shared/contracts';
import type {
  RuntimeReconciliationResult,
  SessionIdentity
} from '../storage/terminal-repository';

export interface ReconciliationRequest {
  runtimeId: string;
  provider: ProviderId;
  workspaceId: string;
  baselineNativeIds: readonly string[];
}

type Wait = (delay: number, signal: AbortSignal) => Promise<void>;

interface NewSessionReconcilerDependencies {
  refreshCatalog(): Promise<unknown>;
  listCurrentSessionIdentities(
    provider: ProviderId,
    workspaceId: string
  ): SessionIdentity[];
  applyResult(runtimeId: string, result: RuntimeReconciliationResult): void;
  wait?: Wait;
  delays?: readonly number[];
}

function cancellableWait(delay: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(finish, delay);
    function finish(): void {
      clearTimeout(timer);
      signal.removeEventListener('abort', finish);
      resolve();
    }
    signal.addEventListener('abort', finish, { once: true });
  });
}

export class NewSessionReconciler {
  private readonly wait: Wait;
  private readonly delays: readonly number[];
  private readonly tasks = new Map<
    string,
    { controller: AbortController; promise: Promise<void> }
  >();
  private stopped = false;

  constructor(private readonly dependencies: NewSessionReconcilerDependencies) {
    this.wait = dependencies.wait ?? cancellableWait;
    this.delays = dependencies.delays ?? [1_000, 3_000, 10_000, 30_000];
  }

  start(request: ReconciliationRequest): Promise<void> {
    const existing = this.tasks.get(request.runtimeId);
    if (existing !== undefined) return existing.promise;
    if (this.stopped) return Promise.resolve();

    const controller = new AbortController();
    const promise = this.reconcile(request, controller.signal).finally(() => {
      if (this.tasks.get(request.runtimeId)?.promise === promise) {
        this.tasks.delete(request.runtimeId);
      }
    });
    this.tasks.set(request.runtimeId, { controller, promise });
    return promise;
  }

  async shutdown(): Promise<void> {
    this.stopped = true;
    const active = [...this.tasks.entries()];
    for (const [runtimeId, task] of active) {
      task.controller.abort();
      this.apply(runtimeId, { state: 'unresolved' });
    }
    await Promise.all(active.map(([, task]) => task.promise));
  }

  private async reconcile(
    request: ReconciliationRequest,
    signal: AbortSignal
  ): Promise<void> {
    const baseline = new Set(request.baselineNativeIds);
    for (const delay of this.delays) {
      await this.wait(delay, signal);
      if (signal.aborted) return;

      try {
        await this.dependencies.refreshCatalog();
      } catch {
        continue;
      }
      if (signal.aborted) return;

      let candidates: SessionIdentity[];
      try {
        candidates = this.dependencies
          .listCurrentSessionIdentities(request.provider, request.workspaceId)
          .filter((session) => !baseline.has(session.nativeId));
      } catch {
        continue;
      }
      if (candidates.length === 0) continue;
      if (candidates.length > 1) {
        this.apply(request.runtimeId, { state: 'ambiguous' });
        return;
      }
      const candidate = candidates[0]!;
      this.apply(request.runtimeId, {
        state: 'linked',
        sessionId: candidate.id,
        nativeSessionId: candidate.nativeId
      });
      return;
    }
    if (!signal.aborted) {
      this.apply(request.runtimeId, { state: 'unresolved' });
    }
  }

  private apply(runtimeId: string, result: RuntimeReconciliationResult): void {
    try {
      this.dependencies.applyResult(runtimeId, result);
    } catch {
      // Reconciliation is best effort and must never interrupt the PTY.
    }
  }
}
