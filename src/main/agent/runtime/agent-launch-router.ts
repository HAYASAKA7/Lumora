import type {
  RuntimeSummary,
  StructuredAgentLaunchRequest,
  StructuredAgentRuntimeSummary
} from '../../../shared/contracts';
import {
  STRUCTURED_AGENT_PROVIDER_IDS,
  type StructuredAgentProviderId
} from '../../../shared/agent/contracts';
import {
  selectProviderInteractionRoute,
  type ProviderInteractionRoute,
  type StructuredProviderCapabilityReport,
  type StructuredProviderPreference
} from '../../../shared/agent/provider-capabilities';
import type { LaunchSpec } from '../../terminal/launch-service';

export type AgentLaunchRouteReason =
  | ProviderInteractionRoute['reason']
  | 'unsupported_launch'
  | 'structured_failed'
  | 'explicit_pty';

export type AgentRuntimeStartResult =
  | {
      mode: 'pty';
      routeReason: AgentLaunchRouteReason;
      runtime: RuntimeSummary;
    }
  | {
      mode: 'structured';
      routeReason: 'verified';
      runtime: StructuredAgentRuntimeSummary;
    };

interface AgentLaunchRouterDependencies {
  consumePreparedLaunch(token: string): Promise<LaunchSpec>;
  startPty(spec: LaunchSpec): Promise<RuntimeSummary>;
  terminatePty(runtimeId: string): Promise<unknown>;
  launchStructured(
    request: StructuredAgentLaunchRequest,
    signal: AbortSignal
  ): Promise<StructuredAgentRuntimeSummary>;
  scanCapabilities(): Promise<readonly StructuredProviderCapabilityReport[]>;
  listPreferences(): readonly StructuredProviderPreference[];
}

interface PendingAgentLaunch {
  controller: AbortController;
  completion: Promise<void>;
}

export class AgentLaunchCancelledError extends Error {
  readonly code = 'AGENT_LAUNCH_CANCELLED';

  constructor() {
    super('The agent launch was cancelled.');
    this.name = 'AgentLaunchCancelledError';
  }
}

export class AgentUnifiedRouteUnavailableError extends Error {
  readonly code = 'AGENT_UNIFIED_ROUTE_UNAVAILABLE';

  constructor() {
    super('Unified UI is unavailable for this prepared launch.');
    this.name = 'AgentUnifiedRouteUnavailableError';
  }
}

function isCancellation(error: unknown): boolean {
  return error instanceof AgentLaunchCancelledError || (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'STRUCTURED_RUNTIME_START_CANCELLED'
  );
}

function throwIfCancelled(signal: AbortSignal): void {
  if (signal.aborted) throw new AgentLaunchCancelledError();
}

function isStructuredProvider(
  providerId: LaunchSpec['provider']
): providerId is StructuredAgentProviderId {
  return STRUCTURED_AGENT_PROVIDER_IDS.some(
    (candidate) => candidate === providerId
  );
}

function structuredRequest(
  spec: LaunchSpec
): StructuredAgentLaunchRequest | null {
  if (
    !isStructuredProvider(spec.provider) ||
    (spec.handoff !== null && spec.handoff !== undefined) ||
    spec.strategy === 'fork'
  ) {
    return null;
  }
  if (spec.strategy === 'new') {
    return {
      strategy: 'new',
      providerId: spec.provider,
      workspaceId: spec.workspaceId,
      startPrompt: spec.startPrompt
    };
  }
  if (spec.sessionId === null) return null;
  return {
    strategy: 'resume',
    providerId: spec.provider,
    sessionId: spec.sessionId,
    startPrompt: spec.startPrompt
  };
}

export class AgentLaunchRouter {
  private readonly pending = new Map<string, PendingAgentLaunch>();
  private readonly cancelledBeforeStart = new Set<string>();

  constructor(private readonly dependencies: AgentLaunchRouterDependencies) {}

  start(operationId: string, token: string): Promise<AgentRuntimeStartResult> {
    if (this.pending.has(operationId)) {
      return Promise.reject(new Error('This agent launch is already active.'));
    }
    if (this.cancelledBeforeStart.delete(operationId)) {
      return Promise.reject(new AgentLaunchCancelledError());
    }
    const controller = new AbortController();
    const result = this.startOwned(token, controller.signal);
    const pending: PendingAgentLaunch = {
      controller,
      completion: result.then(() => undefined, () => undefined)
    };
    this.pending.set(operationId, pending);
    void pending.completion.finally(() => {
      if (this.pending.get(operationId) === pending) {
        this.pending.delete(operationId);
      }
    });
    return result;
  }

  async cancel(operationId: string): Promise<void> {
    const pending = this.pending.get(operationId);
    if (pending === undefined) {
      this.cancelledBeforeStart.add(operationId);
      while (this.cancelledBeforeStart.size > 256) {
        const oldest = this.cancelledBeforeStart.values().next().value;
        if (oldest === undefined) break;
        this.cancelledBeforeStart.delete(oldest);
      }
      return;
    }
    pending.controller.abort();
    await pending.completion;
  }

  private async startOwned(
    token: string,
    signal: AbortSignal
  ): Promise<AgentRuntimeStartResult> {
    throwIfCancelled(signal);
    const spec = await this.dependencies.consumePreparedLaunch(token);
    throwIfCancelled(signal);
    if (spec.interactionRoute === 'pty') {
      return this.startPty(spec, 'explicit_pty', signal);
    }
    const request = structuredRequest(spec);
    if (request === null) {
      if (spec.interactionRoute === 'unified') {
        throw new AgentUnifiedRouteUnavailableError();
      }
      return this.startPty(spec, 'unsupported_launch', signal);
    }
    if (spec.interactionRoute === 'unified') {
      const reports = await this.dependencies.scanCapabilities();
      throwIfCancelled(signal);
      const report = reports.find(
        (candidate) => candidate.providerId === request.providerId
      );
      if (
        report === undefined ||
        report.state !== 'verified' ||
        (request.strategy === 'new' && !report.capabilities.newSession) ||
        (request.strategy === 'resume' && !report.capabilities.resumeSession)
      ) {
        throw new AgentUnifiedRouteUnavailableError();
      }
      try {
        return {
          mode: 'structured',
          routeReason: 'verified',
          runtime: await this.dependencies.launchStructured(request, signal)
        };
      } catch (error) {
        if (signal.aborted || isCancellation(error)) {
          throw new AgentLaunchCancelledError();
        }
        throw error;
      }
    }
    const [reports, preferences] = await Promise.all([
      this.dependencies.scanCapabilities(),
      Promise.resolve(this.dependencies.listPreferences())
    ]);
    throwIfCancelled(signal);
    const report = reports.find(
      (candidate) => candidate.providerId === request.providerId
    );
    const preference = preferences.find(
      (candidate) => candidate.providerId === request.providerId
    );
    if (report === undefined) {
      return this.startPty(spec, 'unavailable', signal);
    }
    if (
      report.state === 'verified' &&
      ((request.strategy === 'new' && !report.capabilities.newSession) ||
        (request.strategy === 'resume' && !report.capabilities.resumeSession))
    ) {
      return this.startPty(spec, 'unsupported_launch', signal);
    }
    const route = selectProviderInteractionRoute({
      preferenceEnabled: preference?.useUnifiedWhenAvailable ?? true,
      report
    });
    if (route.mode === 'pty') {
      return this.startPty(spec, route.reason, signal);
    }
    try {
      return {
        mode: 'structured',
        routeReason: 'verified',
        runtime: await this.dependencies.launchStructured(request, signal)
      };
    } catch (error) {
      if (signal.aborted || isCancellation(error)) {
        throw new AgentLaunchCancelledError();
      }
      if (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        error.code === 'STRUCTURED_RUNTIME_ALREADY_ACTIVE'
      ) throw error;
      return this.startPty(spec, 'structured_failed', signal);
    }
  }

  private async startPty(
    spec: LaunchSpec,
    routeReason: AgentLaunchRouteReason,
    signal: AbortSignal
  ): Promise<AgentRuntimeStartResult> {
    throwIfCancelled(signal);
    const runtime = await this.dependencies.startPty(spec);
    if (signal.aborted) {
      await this.dependencies.terminatePty(runtime.id).catch(() => undefined);
      throw new AgentLaunchCancelledError();
    }
    return { mode: 'pty', routeReason, runtime };
  }
}
