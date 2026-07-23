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

const MAX_EVENT_CHARS = 65_536;
const MAX_SNAPSHOT_CHARS = 1_048_576;

export interface Disposable {
  dispose(): void;
}

export interface PtyProcess {
  readonly pid: number;
  write(data: string): void;
  resize(cols: number, rows: number): void;
  kill(): void;
  onData(listener: (data: string) => void): Disposable;
  onExit(listener: (event: { exitCode: number }) => void): Disposable;
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
  spawn(options: PtySpawnOptions): PtyProcess;
  startReconciliation(request: ReconciliationRequest): void;
  platform: SystemInfo['platform'];
  clock?: () => Date;
  createRuntimeId?: () => string;
  wait?: (milliseconds: number) => Promise<void>;
}

interface LiveRuntime {
  runtime: RuntimeSummary;
  process: PtyProcess;
  snapshot: string;
  outputSequence: number;
  subscriptions: Disposable[];
}

export type TerminalRuntimeErrorCode =
  | 'PTY_SPAWN_FAILED'
  | 'RUNTIME_NOT_LIVE'
  | 'RUNTIME_NOT_FOUND';

const RUNTIME_ERROR_MESSAGES: Record<TerminalRuntimeErrorCode, string> = {
  PTY_SPAWN_FAILED: 'The provider terminal could not be started.',
  RUNTIME_NOT_LIVE: 'The terminal runtime is no longer live.',
  RUNTIME_NOT_FOUND: 'The terminal runtime was not found.'
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
  private readonly listeners = new Set<(event: RuntimeEvent) => void>();
  private readonly clock: () => Date;
  private readonly createRuntimeId: () => string;
  private readonly wait: (milliseconds: number) => Promise<void>;

  constructor(private readonly dependencies: RuntimeHostDependencies) {
    this.clock = dependencies.clock ?? (() => new Date());
    this.createRuntimeId = dependencies.createRuntimeId ?? randomUUID;
    this.wait = dependencies.wait ?? defaultWait;
  }

  subscribe(listener: (event: RuntimeEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async start(token: string): Promise<RuntimeSummary> {
    const spec = await this.dependencies.consumeLaunch(token);
    const runtimeId = this.createRuntimeId();
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
      spec.strategy === 'new' && spec.reconciliationBaselineNativeIds !== null
        ? spec.reconciliationBaselineNativeIds
        : undefined
    );

    let process: PtyProcess;
    try {
      const invocation = resolvePtyInvocation({
        platform: this.dependencies.platform,
        executablePath: spec.executablePath,
        args: spec.args,
        command: spec.command,
        env: spec.environment,
        terminalProfile: spec.terminalProfile
      });
      process = this.dependencies.spawn({
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
      throw new TerminalRuntimeError('PTY_SPAWN_FAILED');
    }

    const running = RuntimeSummarySchema.parse({
      ...launching,
      state: 'running',
      pid: process.pid,
      startedAt: this.clock().toISOString()
    });
    const live: LiveRuntime = {
      runtime: running,
      process,
      snapshot: '',
      outputSequence: 0,
      subscriptions: []
    };
    this.live.set(runtimeId, live);
    live.subscriptions.push(
      process.onData((data) => this.handleOutput(runtimeId, data)),
      process.onExit(({ exitCode }) => this.handleExit(runtimeId, exitCode))
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
    const updated = this.dependencies.repository.applyRuntimeReconciliation(
      runtimeId,
      result
    );
    if (updated === null) return null;
    const live = this.live.get(runtimeId);
    if (live !== undefined) live.runtime = updated;
    this.emit({ type: 'state', runtimeId, runtime: updated });
    return updated;
  }

  synchronizeCatalogSessions(): RuntimeSummary[] {
    const updated = this.dependencies.repository.synchronizeRuntimeSessions();
    for (const runtime of updated) {
      const live = this.live.get(runtime.id);
      if (live !== undefined) {
        live.runtime = runtime;
      }
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
      return RuntimeAttachmentSchema.parse({
        runtime: live.runtime,
        snapshot: live.snapshot,
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
    this.invokePtyCommand(() => {
      live.process.write('\u0003');
    });
    await this.wait(1_500);
    if (this.live.get(runtimeId) === live) {
      live.process.kill();
      await this.wait(500);
    }
    if (this.live.get(runtimeId) === live) {
      this.finalize(runtimeId, null);
    }
    return this.attach(runtimeId).runtime;
  }

  async shutdown(): Promise<void> {
    await Promise.all(
      [...this.live.keys()].map(async (runtimeId) => {
        try {
          await this.terminate(runtimeId);
        } catch {
          // Shutdown is best effort and must continue draining other PTYs.
        }
      })
    );
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
    live.snapshot = (live.snapshot + data).slice(-MAX_SNAPSHOT_CHARS);
    for (let offset = 0; offset < data.length; offset += MAX_EVENT_CHARS) {
      live.outputSequence += 1;
      this.emit({
        type: 'output',
        runtimeId,
        sequence: live.outputSequence,
        data: data.slice(offset, offset + MAX_EVENT_CHARS)
      });
    }
  }

  private handleExit(runtimeId: string, exitCode: number): void {
    this.finalize(runtimeId, exitCode);
  }

  private finalize(runtimeId: string, exitCode: number | null): void {
    const live = this.live.get(runtimeId);
    if (live === undefined) {
      return;
    }
    for (const subscription of live.subscriptions) {
      subscription.dispose();
    }
    this.live.delete(runtimeId);
    const runtime = RuntimeSummarySchema.parse({
      ...live.runtime,
      state: exitCode === 0 ? 'completed' : 'failed',
      endedAt: this.clock().toISOString(),
      exitCode,
      errorCode: exitCode === 0 ? null : 'PTY_RUNTIME_FAILED'
    });
    this.persistAndEmit(runtime);
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
    this.emit({ type: 'state', runtimeId: runtime.id, runtime });
  }

  private emit(value: RuntimeEvent): void {
    const event = RuntimeEventSchema.parse(value);
    for (const listener of this.listeners) {
      listener(event);
    }
  }
}
