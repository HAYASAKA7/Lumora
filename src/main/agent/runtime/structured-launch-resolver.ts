import {
  StructuredAgentLaunchRequestSchema,
  type StructuredAgentLaunchRequest,
  type StructuredAgentProviderId
} from '../../../shared/contracts';
import { providerDefinition } from '../../../shared/provider-definitions';
import type {
  ResolvedStructuredAgentLaunch
} from '../adapters/structured-agent-adapter';
import type { TerminalRepository } from '../../storage/terminal-repository';

type LaunchRepository = Pick<
  TerminalRepository,
  'getWorkspace' | 'getSession' | 'isWorkspaceTrusted'
>;

interface StructuredLaunchResolverOptions {
  repository: LaunchRepository;
  resolveProviderExecutable(
    providerId: StructuredAgentProviderId
  ): Promise<string | null>;
}

export type StructuredLaunchErrorCode =
  | 'STRUCTURED_PROVIDER_UNAVAILABLE'
  | 'STRUCTURED_SESSION_UNAVAILABLE'
  | 'STRUCTURED_WORKSPACE_NOT_TRUSTED'
  | 'STRUCTURED_WORKSPACE_UNAVAILABLE';

export class StructuredLaunchError extends Error {
  constructor(readonly code: StructuredLaunchErrorCode) {
    super(code);
    this.name = 'StructuredLaunchError';
  }
}

export class StructuredLaunchResolver {
  constructor(private readonly options: StructuredLaunchResolverOptions) {}

  async resolve(value: StructuredAgentLaunchRequest): Promise<ResolvedStructuredAgentLaunch> {
    const request = StructuredAgentLaunchRequestSchema.parse(value);
    const session = request.strategy === 'resume'
      ? this.options.repository.getSession(request.sessionId)
      : null;
    if (
      request.strategy === 'resume' &&
      (
        session === null ||
        session.provider !== request.providerId ||
        session.sourceFreshness !== 'current'
      )
    ) {
      throw new StructuredLaunchError('STRUCTURED_SESSION_UNAVAILABLE');
    }
    const workspaceId = request.strategy === 'new'
      ? request.workspaceId
      : session?.workspaceId;
    if (workspaceId === undefined) {
      throw new StructuredLaunchError('STRUCTURED_SESSION_UNAVAILABLE');
    }
    const workspace = this.options.repository.getWorkspace(workspaceId);
    if (workspace === null || !workspace.available) {
      throw new StructuredLaunchError('STRUCTURED_WORKSPACE_UNAVAILABLE');
    }
    if (!this.options.repository.isWorkspaceTrusted(workspace.id, workspace.canonicalPath)) {
      throw new StructuredLaunchError('STRUCTURED_WORKSPACE_NOT_TRUSTED');
    }
    const executablePath = await this.options.resolveProviderExecutable(
      request.providerId
    );
    if (executablePath === null) {
      throw new StructuredLaunchError('STRUCTURED_PROVIDER_UNAVAILABLE');
    }
    return {
      request,
      workspaceId: workspace.id,
      catalogSessionId: session?.id ?? null,
      nativeSessionId: session?.nativeId ?? null,
      title: session?.title ?? `New ${providerDefinition(request.providerId).displayName} session`,
      workingDirectory: workspace.canonicalPath,
      executablePath
    };
  }
}
