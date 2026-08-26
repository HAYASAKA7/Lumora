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
  | 'structured_failed';

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
  launchStructured(
    request: StructuredAgentLaunchRequest
  ): Promise<StructuredAgentRuntimeSummary>;
  scanCapabilities(): Promise<readonly StructuredProviderCapabilityReport[]>;
  listPreferences(): readonly StructuredProviderPreference[];
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
  constructor(private readonly dependencies: AgentLaunchRouterDependencies) {}

  async start(token: string): Promise<AgentRuntimeStartResult> {
    const spec = await this.dependencies.consumePreparedLaunch(token);
    const request = structuredRequest(spec);
    if (request === null) {
      return {
        mode: 'pty',
        routeReason: 'unsupported_launch',
        runtime: await this.dependencies.startPty(spec)
      };
    }
    const [reports, preferences] = await Promise.all([
      this.dependencies.scanCapabilities(),
      Promise.resolve(this.dependencies.listPreferences())
    ]);
    const report = reports.find(
      (candidate) => candidate.providerId === request.providerId
    );
    const preference = preferences.find(
      (candidate) => candidate.providerId === request.providerId
    );
    if (report === undefined) {
      return {
        mode: 'pty',
        routeReason: 'unavailable',
        runtime: await this.dependencies.startPty(spec)
      };
    }
    if (
      report.state === 'verified' &&
      ((request.strategy === 'new' && !report.capabilities.newSession) ||
        (request.strategy === 'resume' && !report.capabilities.resumeSession))
    ) {
      return {
        mode: 'pty',
        routeReason: 'unsupported_launch',
        runtime: await this.dependencies.startPty(spec)
      };
    }
    const route = selectProviderInteractionRoute({
      preferenceEnabled: preference?.useUnifiedWhenAvailable ?? true,
      report
    });
    if (route.mode === 'pty') {
      return {
        mode: 'pty',
        routeReason: route.reason,
        runtime: await this.dependencies.startPty(spec)
      };
    }
    try {
      return {
        mode: 'structured',
        routeReason: 'verified',
        runtime: await this.dependencies.launchStructured(request)
      };
    } catch (error) {
      if (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        error.code === 'STRUCTURED_RUNTIME_ALREADY_ACTIVE'
      ) throw error;
      return {
        mode: 'pty',
        routeReason: 'structured_failed',
        runtime: await this.dependencies.startPty(spec)
      };
    }
  }
}
