import { randomUUID } from 'node:crypto';

import {
  RuntimeAttachmentSchema,
  RuntimeEventSchema,
  RuntimeResizeRequestSchema,
  RuntimeSummarySchema,
  RuntimeWriteRequestSchema,
  type RuntimeAttachment,
  type RuntimeEvent,
  type RuntimeResizeRequest,
  type RuntimeSummary,
  type RuntimeWriteRequest,
  type SystemInfo
} from '../../shared/contracts';
import { resolvePtyInvocation } from '../platform/pty-invocation';
import type {
  RuntimeReconciliationResult
} from '../storage/terminal-repository';
import type { LaunchSpec } from './launch-service';
import type { ReconciliationRequest } from './new-session-reconciler';
import { TerminalOutputBuffer } from './output-buffer';
import {
  StructuredSessionGuard,
  StructuredSessionGuardError
} from '../agent/runtime/structured-session-guard';

const MAX_EVENT_CHARS = 65_536;
const MAX_SNAPSHOT_CHARS = 1_048_576;
const FIRST_INTERRUPT_GRACE_MS = 2_000;
const SECOND_INTERRUPT_GRACE_MS = 7_000;
const FORCE_KILL_EXIT_GRACE_MS = 6_000;

export interface Disposable {
  dispose(): void;
}

export interface PtyProcess {
  readonly pid: number | null;
  write(data: string): void;
  resize(cols: number, rows: number): void;
  kill(): void;
  onData(listener: (data: string) => void): Disposable;
  onExit(listener: (event: unknown) => void): Disposable;
}

export interface PtySpawnOptions {
  executablePath: string;
  args: string[];
  cwd: string;
  env: Record<string, string | undefined>;
  cols: number;
  rows: number;
}

interface RuntimeRepository {
  saveRuntime(
    runtime: RuntimeSummary,
    baselineNativeSessionIds?: readonly string[]
  ): void;
  listRuntimes(): RuntimeSummary[];
  synchronizeRuntimeSessions(): RuntimeSummary[];
  applyRuntimeReconciliation(
    runtimeId: string,
    result: RuntimeReconciliationResult
  ): RuntimeSummary | null;
}

interface RuntimeHostDependencies {
  repository: RuntimeRepository;
  consumeLaunch(token: string): Promise<LaunchSpec>;
  spawn(options: PtySpawnOptions): PtyProcess | Promise<PtyProcess>;
  resolveInvocation?(spec: LaunchSpec): Pick<
    PtySpawnOptions,
    'executablePath' | 'args' | 'env'
  >;
  startReconciliation(request: ReconciliationRequest): void;
  platform: SystemInfo['platform'];
  clock?: () => Date;
  createRuntimeId?: () => string;
  wait?: (milliseconds: number) => Promise<void>;
  scheduleOutputFlush?: (callback: () => void) => void;
  sessionGuard?: StructuredSessionGuard;
}

interface LiveRuntime {
  runtime: RuntimeSummary;
  process: PtyProcess;
  output: TerminalOutputBuffer;
  outputSequence: number;
  outputFlushScheduled: boolean;
  subscriptions: Disposable[];
  exit: Promise<RuntimeSummary>;
  resolveExit(runtime: RuntimeSummary): void;
  termination: Promise<RuntimeSummary> | null;
}

interface RuntimeExitOutcome {
  state: 'completed' | 'failed' | 'runtime_lost';
  exitCode: number | null;
}

export type TerminalRuntimeErrorCode =
  | 'PTY_SPAWN_FAILED'
  | 'RUNTIME_NOT_LIVE'
  | 'RUNTIME_NOT_FOUND'
  | 'RUNTIME_ALREADY_ACTIVE'
  | 'RUNTIME_SHUTTING_DOWN';

const RUNTIME_ERROR_MESSAGES: Record<TerminalRuntimeErrorCode, string> = {
  PTY_SPAWN_FAILED: 'The provider terminal could not be started.',
  RUNTIME_NOT_LIVE: 'The terminal runtime is no longer live.',
  RUNTIME_NOT_FOUND: 'The terminal runtime was not found.',
  RUNTIME_ALREADY_ACTIVE: 'This provider session is already active in Lumora.',
  RUNTIME_SHUTTING_DOWN: 'The terminal runtime is shutting down.'
};

export class TerminalRuntimeError extends Error {
  constructor(readonly code: TerminalRuntimeErrorCode) {
    super(RUNTIME_ERROR_MESSAGES[code]);
    this.name = 'TerminalRuntimeError';
  }
}

export class PtyProcessExitedError extends Error {
  constructor() {
    super('The native terminal process has already exited.');
    this.name = 'PtyProcessExitedError';
  }
}

function defaultWait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export class RuntimeHost {
  private readonly live = new Map<string, LiveRuntime>();
  private readonly pendingStarts = new Set<Promise<RuntimeSummary>>();
  private readonly pendingSessionStarts = new Map<
    string,
    Promise<RuntimeSummary>
  >();
  private readonly runtimeIdBySessionId = new Map<string, string>();
  private readonly listeners = new Set<(event: RuntimeEvent) => void>();
  private readonly clock: () => Date;
  private readonly createRuntimeId: () => string;
  private readonly wait: (milliseconds: number) => Promise<void>;
  private readonly scheduleOutputFlush: (callback: () => void) => void;
  private readonly resolveInvocation: NonNullable<
    RuntimeHostDependencies['resolveInvocation']
  >;
  private readonly sessionGuard: StructuredSessionGuard;
  private lifecycleState: 'active' | 'shutting_down' | 'shut_down' = 'active';
  private shutdownPromise: Promise<void> | null = null;

  constructor(private readonly dependencies: RuntimeHostDependencies) {
    this.clock = dependencies.clock ?? (() => new Date());
    this.createRuntimeId = dependencies.createRuntimeId ?? randomUUID;
    this.wait = dependencies.wait ?? defaultWait;
    this.scheduleOutputFlush =
      dependencies.scheduleOutputFlush ?? queueMicrotask;
    this.resolveInvocation = dependencies.resolveInvocation ?? ((spec) =>
      resolvePtyInvocation({
        platform: this.dependencies.platform,
        executablePath: spec.executablePath,
        args: spec.args,
        command: spec.command,
        env: spec.environment,
        terminalProfile: spec.terminalProfile
      }));
    this.sessionGuard = dependencies.sessionGuard ?? new StructuredSessionGuard();
  }

  subscribe(listener: (event: RuntimeEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  start(token: string): Promise<RuntimeSummary> {
    if (this.lifecycleState !== 'active') {
      return Promise.reject(new TerminalRuntimeError('RUNTIME_SHUTTING_DOWN'));
    }
    const pending = this.startOwned(token);
    this.pendingStarts.add(pending);
    const removePending = () => this.pendingStarts.delete(pending);
    void pending.then(removePending, removePending);
    return pending;
  }

  startPrepared(spec: LaunchSpec): Promise<RuntimeSummary> {
    if (this.lifecycleState !== 'active') {
      return Promise.reject(new TerminalRuntimeError('RUNTIME_SHUTTING_DOWN'));
    }
    const pending = this.startOwnedSpec(spec);
    this.pendingStarts.add(pending);
    const removePending = () => this.pendingStarts.delete(pending);
    void pending.then(removePending, removePending);
    return pending;
  }

  private async startOwned(token: string): Promise<RuntimeSummary> {
    const spec = await this.dependencies.consumeLaunch(token);
    return this.startOwnedSpec(spec);
  }

  private async startOwnedSpec(spec: LaunchSpec): Promise<RuntimeSummary> {
    if (spec.strategy === 'resume' && spec.sessionId !== null) {
      const pending = this.pendingSessionStarts.get(spec.sessionId);
      if (pending !== undefined) return pending;

      const existing = this.liveRuntimeForSession(spec.sessionId);
      if (existing !== null) return existing;

      const starting = this.startSpec(spec);
      this.pendingSessionStarts.set(spec.sessionId, starting);
      try {
        return await starting;
      } finally {
        if (this.pendingSessionStarts.get(spec.sessionId) === starting) {
          this.pendingSessionStarts.delete(spec.sessionId);
        }
      }
    }
    return this.startSpec(spec);
  }

  private async startSpec(spec: LaunchSpec): Promise<RuntimeSummary> {
    const runtimeId = this.createRuntimeId();
    try {
      this.sessionGuard.claim({
        ownerId: runtimeId,
        runtimeKind: 'pty',
        providerId: spec.provider,
        nativeSessionId: spec.nativeSessionId
      });
    } catch (error) {
      if (error instanceof StructuredSessionGuardError) {
        throw new TerminalRuntimeError('RUNTIME_ALREADY_ACTIVE');
      }
      throw error;
    }
    const launching = RuntimeSummarySchema.parse({
      id: runtimeId,
      displayName: spec.displayName,
      strategy: spec.strategy,
      sessionId: spec.sessionId,
      nativeSessionId: spec.nativeSessionId,
      reconciliationState:
        spec.strategy === 'resume'
          ? 'not_required'
          : spec.reconciliationBaselineNativeIds === null
            ? 'unresolved'
            : 'pending',
      provider: spec.provider,
      workspaceId: spec.workspaceId,
      terminalProfileId: spec.terminalProfile.id,
      launchHash: spec.launchHash,
      state: 'launching',
      pid: null,
      createdAt: this.clock().toISOString(),
      startedAt: null,
      endedAt: null,
      exitCode: null,
      errorCode: null
    });
    this.persistAndEmit(
      launching,
      spec.strategy !== 'resume' && spec.reconciliationBaselineNativeIds !== null
        ? spec.reconciliationBaselineNativeIds
        : undefined
    );

    let process: PtyProcess;
    try {
      const invocation = this.resolveInvocation(spec);
      process = await this.dependencies.spawn({
        ...invocation,
        cwd: spec.workingDirectory,
        cols: spec.cols,
        rows: spec.rows
      });
    } catch {
      const failedBase =
        launching.reconciliationState === 'pending'
          ? (this.dependencies.repository.applyRuntimeReconciliation(
              runtimeId,
              { state: 'unresolved' }
            ) ?? { ...launching, reconciliationState: 'unresolved' as const })
          : launching;
      const failed = RuntimeSummarySchema.parse({
        ...failedBase,
        state: 'launch_failed',
        endedAt: this.clock().toISOString(),
        errorCode: 'PTY_SPAWN_FAILED'
      });
      this.persistAndEmit(failed);
      this.sessionGuard.release(runtimeId);
      throw new TerminalRuntimeError('PTY_SPAWN_FAILED');
    }

    const running = RuntimeSummarySchema.parse({
      ...launching,
      state: 'running',
      pid: process.pid,
      startedAt: this.clock().toISOString()
    });
    let resolveExit: (runtime: RuntimeSummary) => void = () => undefined;
    const exit = new Promise<RuntimeSummary>((resolve) => {
      resolveExit = resolve;
    });
    const live: LiveRuntime = {
      runtime: running,
      process,
      output: new TerminalOutputBuffer(
        MAX_SNAPSHOT_CHARS,
        MAX_EVENT_CHARS
      ),
      outputSequence: 0,
      outputFlushScheduled: false,
      subscriptions: [],
      exit,
      resolveExit,
      termination: null
    };
    this.live.set(runtimeId, live);
    live.subscriptions.push(
      process.onData((data) => this.handleOutput(runtimeId, data)),
      process.onExit((event) => this.handleExit(runtimeId, event))
    );
    this.persistAndEmit(running);
    if (
      running.reconciliationState === 'pending' &&
      spec.reconciliationBaselineNativeIds !== null
    ) {
      try {
        this.dependencies.startReconciliation({
          runtimeId,
          provider: spec.provider,
          workspaceId: spec.workspaceId,
          baselineNativeIds: spec.reconciliationBaselineNativeIds
        });
      } catch {
        this.applyReconciliation(runtimeId, { state: 'unresolved' });
      }
    }
    return running;
  }

  applyReconciliation(
    runtimeId: string,
    result: RuntimeReconciliationResult
  ): RuntimeSummary | null {
    const liveBefore = this.live.get(runtimeId);
    let claimedNativeIdentity = false;
    if (liveBefore !== undefined && result.state === 'linked') {
      try {
        this.sessionGuard.assignNativeSessionId(
          runtimeId,
          result.nativeSessionId
        );
        claimedNativeIdentity = liveBefore.runtime.nativeSessionId === null;
      } catch (error) {
        if (error instanceof StructuredSessionGuardError) {
          const unresolved = this.dependencies.repository.applyRuntimeReconciliation(
            runtimeId,
            { state: 'unresolved' }
          );
          if (unresolved !== null) {
            liveBefore.runtime = unresolved;
            this.emit({ type: 'state', runtimeId, runtime: unresolved });
          }
          void this.terminate(runtimeId).catch(() => undefined);
          return unresolved;
        }
        throw error;
      }
    }

    let updated: RuntimeSummary | null;
    try {
      updated = this.dependencies.repository.applyRuntimeReconciliation(
        runtimeId,
        result
      );
    } catch (error) {
      if (claimedNativeIdentity && liveBefore !== undefined) {
        this.restoreProvisionalClaim(runtimeId, liveBefore.runtime);
      }
      throw error;
    }
    if (updated === null && claimedNativeIdentity && liveBefore !== undefined) {
      this.restoreProvisionalClaim(runtimeId, liveBefore.runtime);
    }
    if (updated === null) return null;
    const live = this.live.get(runtimeId);
    if (live !== undefined) live.runtime = updated;
    this.updateLiveSessionIndex(updated);
    this.emit({ type: 'state', runtimeId, runtime: updated });
    return updated;
  }

  private restoreProvisionalClaim(
    runtimeId: string,
    runtime: RuntimeSummary
  ): void {
    this.sessionGuard.release(runtimeId);
    this.sessionGuard.claim({
      ownerId: runtimeId,
      runtimeKind: 'pty',
      providerId: runtime.provider,
      nativeSessionId: runtime.nativeSessionId
    });
  }

  synchronizeCatalogSessions(): RuntimeSummary[] {
    const updated = this.dependencies.repository.synchronizeRuntimeSessions();
    for (const runtime of updated) {
      const live = this.live.get(runtime.id);
      if (live !== undefined) {
        live.runtime = runtime;
      }
      this.updateLiveSessionIndex(runtime);
      this.emit({ type: 'state', runtimeId: runtime.id, runtime });
    }
    return updated;
  }

  list(): RuntimeSummary[] {
    return this.dependencies.repository.listRuntimes();
  }

  attach(runtimeId: string): RuntimeAttachment {
    const live = this.live.get(runtimeId);
    if (live !== undefined) {
      this.flushOutput(runtimeId, live);
      return RuntimeAttachmentSchema.parse({
        runtime: live.runtime,
        snapshot: live.output.snapshot(),
        outputSequence: live.outputSequence
      });
    }
    const runtime = this.list().find((candidate) => candidate.id === runtimeId);
    if (runtime === undefined) {
      throw new TerminalRuntimeError('RUNTIME_NOT_FOUND');
    }
    return RuntimeAttachmentSchema.parse({
      runtime,
      snapshot: '',
      outputSequence: 0
    });
  }

  write(value: RuntimeWriteRequest): void {
    const request = RuntimeWriteRequestSchema.parse(value);
    const live = this.commandTarget(request.runtimeId);
    if (live === null) return;
    this.invokePtyCommand(() => {
      live.process.write(request.data);
    });
  }

  resize(value: RuntimeResizeRequest): void {
    const request = RuntimeResizeRequestSchema.parse(value);
    const live = this.commandTarget(request.runtimeId);
    if (live === null) return;
    this.invokePtyCommand(() => {
      live.process.resize(
        request.cols,
        request.rows
      );
    });
  }

  async terminate(runtimeId: string): Promise<RuntimeSummary> {
    const live = this.commandTarget(runtimeId);
    if (live === null) return this.attach(runtimeId).runtime;
    if (live.termination !== null) return live.termination;

    const termination = this.terminateLive(runtimeId, live);
    live.termination = termination;
    void termination.catch(() => {
      if (this.live.get(runtimeId) === live) {
        live.termination = null;
      }
    });
    return termination;
  }

  private async terminateLive(
    runtimeId: string,
    live: LiveRuntime
  ): Promise<RuntimeSummary> {
    this.interrupt(live);
    const firstExit = await this.waitForExit(live, FIRST_INTERRUPT_GRACE_MS);
    if (firstExit !== null) return firstExit;

    if (this.live.get(runtimeId) === live) {
      this.interrupt(live);
    }
    const secondExit = await this.waitForExit(live, SECOND_INTERRUPT_GRACE_MS);
    if (secondExit !== null) return secondExit;

    if (this.live.get(runtimeId) === live) {
      live.process.kill();
    }
    const killedExit = await this.waitForExit(live, FORCE_KILL_EXIT_GRACE_MS);
    if (killedExit !== null) return killedExit;

    if (this.live.get(runtimeId) === live) {
      this.finalize(runtimeId, {
        state: 'runtime_lost',
        exitCode: null
      });
    }
    return this.attach(runtimeId).runtime;
  }

  private interrupt(live: LiveRuntime): void {
    this.invokePtyCommand(() => {
      live.process.write('\u0003');
    });
  }

  private async waitForExit(
    live: LiveRuntime,
    milliseconds: number
  ): Promise<RuntimeSummary | null> {
    return Promise.race([
      live.exit,
      this.wait(milliseconds).then(() => null)
    ]);
  }

  shutdown(): Promise<void> {
    if (this.shutdownPromise !== null) return this.shutdownPromise;
    this.lifecycleState = 'shutting_down';
    this.shutdownPromise = this.shutdownOwned();
    return this.shutdownPromise;
  }

  private async shutdownOwned(): Promise<void> {
    await Promise.allSettled([...this.pendingStarts]);
    await Promise.all(
      [...this.live.keys()].map(async (runtimeId) => {
        try {
          await this.terminate(runtimeId);
        } catch {
          // Shutdown is best effort and must continue draining other PTYs.
        }
      })
    );
    this.lifecycleState = 'shut_down';
  }

  private commandTarget(runtimeId: string): LiveRuntime | null {
    const live = this.live.get(runtimeId);
    if (live !== undefined) return live;
    const runtime = this.list().find(
      (candidate) => candidate.id === runtimeId
    );
    if (runtime === undefined) {
      throw new TerminalRuntimeError('RUNTIME_NOT_FOUND');
    }
    if (runtime.state === 'launching' || runtime.state === 'running') {
      throw new TerminalRuntimeError('RUNTIME_NOT_LIVE');
    }
    return null;
  }

  private invokePtyCommand(operation: () => void): void {
    try {
      operation();
    } catch (error) {
      // node-pty can reject commands after the native process exits but
      // before its JavaScript onExit event finalizes the runtime.
      // The exit event remains authoritative for the final state and code.
      if (error instanceof PtyProcessExitedError) return;
      throw error;
    }
  }

  private handleOutput(runtimeId: string, data: string): void {
    const live = this.live.get(runtimeId);
    if (live === undefined || data.length === 0) {
      return;
    }
    live.output.append(data);
    if (live.outputFlushScheduled) return;
    live.outputFlushScheduled = true;
    this.scheduleOutputFlush(() => {
      if (this.live.get(runtimeId) === live) {
        this.flushOutput(runtimeId, live);
      }
    });
  }

  private flushOutput(runtimeId: string, live: LiveRuntime): void {
    live.outputFlushScheduled = false;
    for (const data of live.output.drainEvents()) {
      live.outputSequence += 1;
      this.emit({
        type: 'output',
        runtimeId,
        sequence: live.outputSequence,
        data
      });
    }
  }

  private handleExit(runtimeId: string, event: unknown): void {
    const live = this.live.get(runtimeId);
    if (live !== undefined) this.flushOutput(runtimeId, live);
    const reportedExitCode =
      typeof event === 'object' &&
      event !== null &&
      'exitCode' in event
        ? event.exitCode
        : null;
    const exitCode =
      typeof reportedExitCode === 'number' &&
      Number.isSafeInteger(reportedExitCode)
        ? reportedExitCode
        : null;
    this.finalize(runtimeId, {
      state: exitCode === null || exitCode === 0 ? 'completed' : 'failed',
      exitCode
    });
  }

  private finalize(
    runtimeId: string,
    outcome: RuntimeExitOutcome
  ): void {
    const live = this.live.get(runtimeId);
    if (live === undefined) {
      return;
    }
    for (const subscription of live.subscriptions) {
      subscription.dispose();
    }
    this.live.delete(runtimeId);
    this.sessionGuard.release(runtimeId);
    const runtime = RuntimeSummarySchema.parse({
      ...live.runtime,
      state: outcome.state,
      endedAt: this.clock().toISOString(),
      exitCode: outcome.exitCode,
      errorCode:
        outcome.state === 'completed'
          ? null
          : outcome.state === 'runtime_lost'
            ? 'PTY_RUNTIME_LOST'
            : 'PTY_RUNTIME_FAILED'
    });
    this.persistAndEmit(runtime);
    live.resolveExit(runtime);
  }

  private persistAndEmit(
    runtime: RuntimeSummary,
    baselineNativeSessionIds?: readonly string[]
  ): void {
    if (baselineNativeSessionIds === undefined) {
      this.dependencies.repository.saveRuntime(runtime);
    } else {
      this.dependencies.repository.saveRuntime(runtime, baselineNativeSessionIds);
    }
    this.updateLiveSessionIndex(runtime);
    this.emit({ type: 'state', runtimeId: runtime.id, runtime });
  }

  private liveRuntimeForSession(sessionId: string): RuntimeSummary | null {
    const runtimeId = this.runtimeIdBySessionId.get(sessionId);
    if (runtimeId === undefined) return null;
    const runtime = this.live.get(runtimeId)?.runtime;
    if (
      runtime === undefined ||
      runtime.sessionId !== sessionId ||
      (runtime.state !== 'launching' && runtime.state !== 'running')
    ) {
      this.runtimeIdBySessionId.delete(sessionId);
      return null;
    }
    return runtime;
  }

  private updateLiveSessionIndex(runtime: RuntimeSummary): void {
    for (const [sessionId, runtimeId] of this.runtimeIdBySessionId) {
      if (
        runtimeId === runtime.id &&
        (
          runtime.sessionId !== sessionId ||
          (runtime.state !== 'launching' && runtime.state !== 'running')
        )
      ) {
        this.runtimeIdBySessionId.delete(sessionId);
      }
    }
    if (
      runtime.sessionId !== null &&
      (runtime.state === 'launching' || runtime.state === 'running') &&
      !this.runtimeIdBySessionId.has(runtime.sessionId)
    ) {
      this.runtimeIdBySessionId.set(runtime.sessionId, runtime.id);
    }
  }

  private emit(value: RuntimeEvent): void {
    const event = RuntimeEventSchema.parse(value);
    for (const listener of this.listeners) {
      listener(event);
    }
  }
}
