import { randomUUID } from 'node:crypto';

import {
  StructuredAgentActionSchema,
  StructuredAgentCommandSchema,
  StructuredAgentLaunchRequestSchema,
  StructuredAgentRuntimeSnapshotSchema,
  StructuredAgentRuntimeSummarySchema,
  type StructuredAgentAction,
  type StructuredAgentCommand,
  type StructuredAgentEvent,
  type StructuredAgentLaunchRequest,
  type StructuredAgentRuntimeSnapshot,
  type StructuredAgentRuntimeSummary
} from '../../../shared/agent/contracts';
import type {
  CreateStructuredAgentAdapter,
  ResolvedStructuredAgentLaunch,
  StructuredAgentAdapter,
  StructuredAgentAdapterContext
} from '../adapters/structured-agent-adapter';
import type { ProviderId } from '../../../shared/contracts';
import {
  StructuredAgentEventSequencer,
  type StructuredAgentEventDraft
} from './event-sequencer';
import {
  StructuredSessionGuard,
  StructuredSessionGuardError
} from './structured-session-guard';

type ResolveLaunch = (
  request: StructuredAgentLaunchRequest
) => Promise<ResolvedStructuredAgentLaunch>;

interface StructuredAgentRuntimeHostOptions {
  resolveLaunch: ResolveLaunch;
  createAdapter: CreateStructuredAgentAdapter;
  sessionGuard?: StructuredSessionGuard;
  clock?: () => Date;
  createConnectionId?: () => string;
  createEventId?: () => string;
  maxTailEvents?: number;
  maxTailBytes?: number;
  clientVersion?: string;
}

export interface StructuredCatalogSessionIdentity {
  id: string;
  provider: ProviderId;
  nativeId: string;
  title: string;
}

interface LiveStructuredRuntime {
  summary: StructuredAgentRuntimeSummary;
  launch: ResolvedStructuredAgentLaunch;
  sequencer: StructuredAgentEventSequencer;
  adapter: StructuredAgentAdapter | null;
  events: StructuredAgentEvent[];
  commands: StructuredAgentCommand[];
  eventBytes: number;
  closePromise: Promise<StructuredAgentRuntimeSummary> | null;
}

export type StructuredAgentRuntimeHostErrorCode =
  | 'STRUCTURED_RUNTIME_ALREADY_ACTIVE'
  | 'STRUCTURED_RUNTIME_START_CANCELLED'
  | 'STRUCTURED_RUNTIME_FAILED'
  | 'STRUCTURED_RUNTIME_NOT_FOUND'
  | 'STRUCTURED_RUNTIME_NOT_READY'
  | 'STRUCTURED_RUNTIME_SHUTTING_DOWN';

const ERROR_MESSAGES: Readonly<Record<
  StructuredAgentRuntimeHostErrorCode,
  string
>> = Object.freeze({
  STRUCTURED_RUNTIME_ALREADY_ACTIVE: 'This provider session is already active in Lumora.',
  STRUCTURED_RUNTIME_START_CANCELLED: 'The structured provider session launch was cancelled.',
  STRUCTURED_RUNTIME_FAILED: 'Lumora could not start the structured provider session.',
  STRUCTURED_RUNTIME_NOT_FOUND: 'The structured provider session was not found.',
  STRUCTURED_RUNTIME_NOT_READY: 'The structured provider session is not ready.',
  STRUCTURED_RUNTIME_SHUTTING_DOWN: 'Lumora is shutting down structured provider sessions.'
});

export class StructuredAgentRuntimeHostError extends Error {
  constructor(readonly code: StructuredAgentRuntimeHostErrorCode) {
    super(ERROR_MESSAGES[code]);
    this.name = 'StructuredAgentRuntimeHostError';
  }
}

export class StructuredAgentRuntimeHost {
  private readonly live = new Map<string, LiveStructuredRuntime>();
  private readonly listeners = new Set<(event: StructuredAgentEvent) => void>();
  private readonly guard: StructuredSessionGuard;
  private readonly clock: () => Date;
  private readonly createConnectionId: () => string;
  private readonly createEventId: () => string;
  private readonly maxTailEvents: number;
  private readonly maxTailBytes: number;
  private lifecycle: 'active' | 'shutting_down' | 'shut_down' = 'active';
  private shutdownPromise: Promise<void> | null = null;

  constructor(private readonly options: StructuredAgentRuntimeHostOptions) {
    this.guard = options.sessionGuard ?? new StructuredSessionGuard();
    this.clock = options.clock ?? (() => new Date());
    this.createConnectionId = options.createConnectionId ?? randomUUID;
    this.createEventId = options.createEventId ?? randomUUID;
    this.maxTailEvents = Math.max(1, Math.min(500, options.maxTailEvents ?? 500));
    this.maxTailBytes = Math.max(
      65_536,
      Math.min(4 * 1024 * 1024, options.maxTailBytes ?? 1024 * 1024)
    );
  }

  subscribe(listener: (event: StructuredAgentEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async launch(
    value: StructuredAgentLaunchRequest,
    signal?: AbortSignal
  ): Promise<StructuredAgentRuntimeSummary> {
    if (this.lifecycle !== 'active') {
      throw new StructuredAgentRuntimeHostError('STRUCTURED_RUNTIME_SHUTTING_DOWN');
    }
    if (signal?.aborted) {
      throw new StructuredAgentRuntimeHostError(
        'STRUCTURED_RUNTIME_START_CANCELLED'
      );
    }
    const request = StructuredAgentLaunchRequestSchema.parse(value);
    const launch = await this.options.resolveLaunch(request);
    if (signal?.aborted) {
      throw new StructuredAgentRuntimeHostError(
        'STRUCTURED_RUNTIME_START_CANCELLED'
      );
    }
    if (launch.request.providerId !== request.providerId) {
      throw new StructuredAgentRuntimeHostError('STRUCTURED_RUNTIME_FAILED');
    }
    const connectionId = this.createConnectionId();
    try {
      this.guard.claim({
        ownerId: connectionId,
        runtimeKind: 'structured',
        providerId: request.providerId,
        nativeSessionId: launch.nativeSessionId
      });
    } catch (error) {
      if (error instanceof StructuredSessionGuardError) {
        throw new StructuredAgentRuntimeHostError(
          'STRUCTURED_RUNTIME_ALREADY_ACTIVE'
        );
      }
      throw error;
    }

    const timestamp = this.clock().toISOString();
    const sequencer = new StructuredAgentEventSequencer({
      connectionId,
      providerId: request.providerId,
      generation: 1,
      nativeSessionId: launch.nativeSessionId,
      clock: this.clock,
      createEventId: this.createEventId
    });
    const runtime: LiveStructuredRuntime = {
      summary: StructuredAgentRuntimeSummarySchema.parse({
        connectionId,
        providerId: request.providerId,
        nativeSessionId: launch.nativeSessionId,
        catalogSessionId: launch.catalogSessionId,
        workspaceId: launch.workspaceId,
        title: launch.title,
        state: 'starting',
        generation: 1,
        createdAt: timestamp,
        updatedAt: timestamp,
        error: null
      }),
      launch,
      sequencer,
      adapter: null,
      events: [],
      commands: [],
      eventBytes: 0,
      closePromise: null
    };
    this.live.set(connectionId, runtime);
    this.emitStatus(runtime, 1, 'starting', null);
    let cancelled = signal?.aborted ?? false;
    let adapterClosePromise: Promise<void> | null = null;
    const closeAdapter = (): Promise<void> => {
      if (runtime.adapter === null) return Promise.resolve();
      adapterClosePromise ??= runtime.adapter.close().catch(() => undefined);
      return adapterClosePromise;
    };
    const cancelLaunch = () => {
      cancelled = true;
      void closeAdapter();
    };
    signal?.addEventListener('abort', cancelLaunch, { once: true });

    try {
      const adapter = await this.createAdapter(runtime, 1);
      runtime.adapter = adapter;
      if (cancelled) {
        await closeAdapter();
        throw new StructuredAgentRuntimeHostError(
          'STRUCTURED_RUNTIME_START_CANCELLED'
        );
      }
      const opened = await adapter.open();
      if (cancelled) {
        await closeAdapter();
        throw new StructuredAgentRuntimeHostError(
          'STRUCTURED_RUNTIME_START_CANCELLED'
        );
      }
      if (runtime.summary.state !== 'starting') {
        await adapter.close().catch(() => undefined);
        throw new StructuredAgentRuntimeHostError('STRUCTURED_RUNTIME_FAILED');
      }
      this.guard.assignNativeSessionId(connectionId, opened.nativeSessionId);
      runtime.sequencer.assignNativeSessionId(opened.nativeSessionId);
      runtime.launch = { ...runtime.launch, nativeSessionId: opened.nativeSessionId };
      runtime.commands = this.normalizeCommands(opened.commands ?? []);
      this.updateSummary(runtime, {
        nativeSessionId: opened.nativeSessionId,
        state: 'ready',
        error: null
      });
      const initialEvents = opened.initialEvents ?? [];
      for (const event of initialEvents.slice(-this.maxTailEvents)) {
        this.acceptAdapterEvent(runtime, 1, event, false);
      }
      this.emitStatus(runtime, 1, 'ready', null);
      try {
        await adapter.activate?.();
      } catch {
        this.acceptAdapterEvent(runtime, 1, {
          turnId: 'lifecycle',
          parentEventId: null,
          kind: 'runtime.error',
          payload: {
            code: 'STRUCTURED_START_PROMPT_FAILED',
            message: 'The provider session opened, but the start prompt was not sent.',
            retryable: true
          }
        });
      }
      return runtime.summary;
    } catch (error) {
      await closeAdapter();
      if (cancelled || signal?.aborted) {
        this.guard.release(connectionId);
        this.live.delete(connectionId);
        throw new StructuredAgentRuntimeHostError(
          'STRUCTURED_RUNTIME_START_CANCELLED'
        );
      }
      this.failRuntime(runtime, 1);
      this.live.delete(connectionId);
      if (error instanceof StructuredSessionGuardError) {
        throw new StructuredAgentRuntimeHostError(
          'STRUCTURED_RUNTIME_ALREADY_ACTIVE'
        );
      }
      if (error instanceof StructuredAgentRuntimeHostError) throw error;
      throw new StructuredAgentRuntimeHostError('STRUCTURED_RUNTIME_FAILED');
    } finally {
      signal?.removeEventListener('abort', cancelLaunch);
    }
  }

  list(): readonly StructuredAgentRuntimeSummary[] {
    return [...this.live.values()].map(({ summary }) =>
      StructuredAgentRuntimeSummarySchema.parse(summary)
    );
  }

  synchronizeCatalogSessions(
    sessions: readonly StructuredCatalogSessionIdentity[]
  ): readonly StructuredAgentRuntimeSummary[] {
    const byIdentity = new Map(
      sessions.map((session) => [
        `${session.provider}\u0000${session.nativeId}`,
        session
      ] as const)
    );
    const updated: StructuredAgentRuntimeSummary[] = [];
    for (const runtime of this.live.values()) {
      if (runtime.summary.nativeSessionId === null) continue;
      const session = byIdentity.get(
        `${runtime.summary.providerId}\u0000${runtime.summary.nativeSessionId}`
      );
      if (
        session === undefined ||
        (runtime.summary.catalogSessionId === session.id &&
          runtime.summary.title === session.title)
      ) continue;
      this.updateSummary(runtime, {
        catalogSessionId: session.id,
        title: session.title
      });
      const event = runtime.sequencer.next(
        runtime.sequencer.currentGeneration(),
        {
          turnId: 'lifecycle',
          parentEventId: null,
          kind: 'runtime.metadata',
          payload: {
            catalogSessionId: session.id,
            title: session.title
          }
        }
      );
      if (event !== null) this.recordEvent(runtime, event);
      updated.push(runtime.summary);
    }
    return updated;
  }

  snapshot(connectionId: string): StructuredAgentRuntimeSnapshot {
    const runtime = this.requireRuntime(connectionId);
    return StructuredAgentRuntimeSnapshotSchema.parse({
      runtime: runtime.summary,
      events: runtime.events,
      commands: runtime.commands,
      boundary: {
        kind: 'connection_start',
        message: 'This event view starts when Lumora connected to the provider.'
      }
    });
  }

  async dispatch(value: StructuredAgentAction): Promise<void> {
    const action = StructuredAgentActionSchema.parse(value);
    const runtime = this.requireRuntime(action.connectionId);
    if (runtime.summary.state !== 'ready' || runtime.adapter === null) {
      throw new StructuredAgentRuntimeHostError('STRUCTURED_RUNTIME_NOT_READY');
    }
    try {
      await runtime.adapter.dispatch(action);
    } catch {
      throw new StructuredAgentRuntimeHostError('STRUCTURED_RUNTIME_FAILED');
    }
  }

  async reconnect(connectionId: string): Promise<StructuredAgentRuntimeSummary> {
    const runtime = this.requireRuntime(connectionId);
    if (
      runtime.summary.state !== 'ready' &&
      runtime.summary.state !== 'failed'
    ) {
      throw new StructuredAgentRuntimeHostError('STRUCTURED_RUNTIME_NOT_READY');
    }
    const oldAdapter = runtime.adapter;
    if (runtime.summary.state === 'failed') {
      try {
        this.guard.claim({
          ownerId: runtime.summary.connectionId,
          runtimeKind: 'structured',
          providerId: runtime.summary.providerId,
          nativeSessionId: runtime.summary.nativeSessionId
        });
      } catch (error) {
        if (error instanceof StructuredSessionGuardError) {
          throw new StructuredAgentRuntimeHostError(
            'STRUCTURED_RUNTIME_ALREADY_ACTIVE'
          );
        }
        throw error;
      }
    }
    const generation = runtime.sequencer.bumpGeneration();
    this.updateSummary(runtime, { state: 'reconnecting', generation, error: null });
    this.emitStatus(runtime, generation, 'reconnecting', null);
    await oldAdapter?.close().catch(() => undefined);

    try {
      const adapter = await this.createAdapter(runtime, generation);
      runtime.adapter = adapter;
      const opened = await adapter.open();
      runtime.commands = this.normalizeCommands(opened.commands ?? []);
      if (runtime.summary.nativeSessionId === null) {
        this.guard.assignNativeSessionId(
          runtime.summary.connectionId,
          opened.nativeSessionId
        );
        runtime.sequencer.assignNativeSessionId(opened.nativeSessionId);
        runtime.launch = {
          ...runtime.launch,
          nativeSessionId: opened.nativeSessionId
        };
        this.updateSummary(runtime, {
          nativeSessionId: opened.nativeSessionId
        });
      } else if (opened.nativeSessionId !== runtime.summary.nativeSessionId) {
        await adapter.close().catch(() => undefined);
        throw new Error('The provider returned a different native session.');
      }
      this.updateSummary(runtime, { state: 'ready', error: null });
      this.emitStatus(runtime, generation, 'ready', null);
      return runtime.summary;
    } catch {
      this.failRuntime(runtime, generation);
      throw new StructuredAgentRuntimeHostError('STRUCTURED_RUNTIME_FAILED');
    }
  }

  close(connectionId: string): Promise<StructuredAgentRuntimeSummary> {
    const runtime = this.requireRuntime(connectionId);
    if (runtime.closePromise !== null) return runtime.closePromise;
    if (runtime.summary.state === 'closed' || runtime.summary.state === 'failed') {
      return Promise.resolve(runtime.summary);
    }
    const closing = this.closeOwned(runtime);
    runtime.closePromise = closing;
    return closing;
  }

  shutdown(): Promise<void> {
    if (this.shutdownPromise !== null) return this.shutdownPromise;
    this.lifecycle = 'shutting_down';
    this.shutdownPromise = Promise.all(
      [...this.live.values()].map((runtime) =>
        this.close(runtime.summary.connectionId).catch(() => runtime.summary)
      )
    ).then(() => {
      this.lifecycle = 'shut_down';
      this.listeners.clear();
    });
    return this.shutdownPromise;
  }

  private async createAdapter(
    runtime: LiveStructuredRuntime,
    generation: number
  ): Promise<StructuredAgentAdapter> {
    const context: StructuredAgentAdapterContext = {
      connectionId: runtime.summary.connectionId,
      providerId: runtime.summary.providerId,
      generation,
      ...(this.options.clientVersion === undefined
        ? {}
        : { clientVersion: this.options.clientVersion }),
      launch: runtime.launch,
      callbacks: {
        emit: (event) => this.acceptAdapterEvent(runtime, generation, event),
        commandsChanged: (commands) => {
          if (generation !== runtime.sequencer.currentGeneration()) return;
          runtime.commands = this.normalizeCommands(commands);
          this.acceptAdapterEvent(runtime, generation, {
            turnId: 'runtime-commands',
            parentEventId: null,
            kind: 'runtime.commands',
            payload: { count: runtime.commands.length }
          });
        },
        exited: (error) => this.acceptAdapterExit(runtime, generation, error)
      }
    };
    return this.options.createAdapter(context);
  }

  private acceptAdapterEvent(
    runtime: LiveStructuredRuntime,
    generation: number,
    draft: StructuredAgentEventDraft,
    publish = true
  ): void {
    if (runtime.summary.state === 'closed' || runtime.summary.state === 'failed') return;
    try {
      const event = runtime.sequencer.next(generation, draft);
      if (event !== null) this.recordEvent(runtime, event, publish);
    } catch {
      // Provider payloads evolve independently from Lumora. A single invalid
      // presentation event must not tear down an otherwise healthy session.
    }
  }

  private normalizeCommands(
    commands: readonly StructuredAgentCommand[]
  ): StructuredAgentCommand[] {
    return commands.slice(0, 256).flatMap((command) => {
      const parsed = StructuredAgentCommandSchema.safeParse(command);
      return parsed.success ? [parsed.data] : [];
    });
  }

  private acceptAdapterExit(
    runtime: LiveStructuredRuntime,
    generation: number,
    error: Error | null
  ): void {
    if (generation !== runtime.sequencer.currentGeneration()) return;
    if (runtime.summary.state === 'closed' || runtime.summary.state === 'failed') return;
    if (runtime.summary.state === 'closing' && error === null) {
      this.finalizeClosed(runtime, generation);
      return;
    }
    this.failRuntime(runtime, generation);
  }

  private emitStatus(
    runtime: LiveStructuredRuntime,
    generation: number,
    state: 'starting' | 'ready' | 'reconnecting' | 'closed' | 'failed',
    message: string | null
  ): void {
    const event = runtime.sequencer.next(generation, {
      turnId: 'lifecycle',
      parentEventId: null,
      kind: 'runtime.status',
      payload: { state, message }
    });
    if (event !== null) this.recordEvent(runtime, event);
  }

  private recordEvent(
    runtime: LiveStructuredRuntime,
    event: StructuredAgentEvent,
    publish = true
  ): void {
    const bytes = Buffer.byteLength(JSON.stringify(event));
    runtime.events.push(event);
    runtime.eventBytes += bytes;
    while (
      runtime.events.length > this.maxTailEvents ||
      runtime.eventBytes > this.maxTailBytes
    ) {
      const removed = runtime.events.shift();
      if (removed === undefined) break;
      runtime.eventBytes -= Buffer.byteLength(JSON.stringify(removed));
    }
    if (publish) {
      for (const listener of this.listeners) listener(event);
    }
  }

  private updateSummary(
    runtime: LiveStructuredRuntime,
    changes: Partial<Pick<
      StructuredAgentRuntimeSummary,
      | 'nativeSessionId'
      | 'catalogSessionId'
      | 'title'
      | 'state'
      | 'generation'
      | 'error'
    >>
  ): void {
    runtime.summary = StructuredAgentRuntimeSummarySchema.parse({
      ...runtime.summary,
      ...changes,
      updatedAt: this.clock().toISOString()
    });
  }

  private failRuntime(runtime: LiveStructuredRuntime, generation: number): void {
    if (generation !== runtime.sequencer.currentGeneration()) return;
    if (runtime.summary.state === 'failed' || runtime.summary.state === 'closed') return;
    this.updateSummary(runtime, {
      state: 'failed',
      error: {
        code: 'STRUCTURED_RUNTIME_FAILED',
        message: 'The structured provider connection stopped unexpectedly.',
        retryable: true
      }
    });
    if (runtime.summary.nativeSessionId !== null) {
      this.emitStatus(
        runtime,
        generation,
        'failed',
        'The structured provider connection stopped unexpectedly.'
      );
    }
    this.guard.release(runtime.summary.connectionId);
  }

  private async closeOwned(
    runtime: LiveStructuredRuntime
  ): Promise<StructuredAgentRuntimeSummary> {
    this.updateSummary(runtime, { state: 'closing' });
    await runtime.adapter?.close().catch(() => undefined);
    this.finalizeClosed(runtime, runtime.sequencer.currentGeneration());
    return runtime.summary;
  }

  private finalizeClosed(
    runtime: LiveStructuredRuntime,
    generation: number
  ): void {
    if (runtime.summary.state === 'closed') return;
    this.updateSummary(runtime, { state: 'closed', error: null });
    this.emitStatus(runtime, generation, 'closed', null);
    this.guard.release(runtime.summary.connectionId);
  }

  private requireRuntime(connectionId: string): LiveStructuredRuntime {
    const runtime = this.live.get(connectionId);
    if (runtime === undefined) {
      throw new StructuredAgentRuntimeHostError('STRUCTURED_RUNTIME_NOT_FOUND');
    }
    return runtime;
  }
}
