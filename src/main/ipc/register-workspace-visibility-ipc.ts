import {
  WorkspaceVisibilityPolicyListSchema,
  WorkspaceVisibilityRestoreRequestSchema,
  WorkspaceVisibilitySetRequestSchema,
  IPC_CHANNELS,
  type LumoraWindowContext,
  type WorkspaceVisibilityPolicy,
  type WorkspaceVisibilityRestoreRequest,
  type WorkspaceVisibilitySetRequest
} from '../../shared/contracts';
import { isTrustedRendererUrl } from '../security-policy';
import type { IpcAuthorizer } from './ipc-access';

interface IpcInvokeEventLike {
  senderFrame: { url: string } | null;
}

interface IpcRegistrar {
  handle(
    channel: string,
    handler: (
      event: IpcInvokeEventLike,
      ...args: readonly unknown[]
    ) => Promise<unknown> | unknown
  ): void;
}

export interface WorkspaceVisibilityServiceLike {
  getPolicies(): WorkspaceVisibilityPolicy[];
  setPolicy(input: WorkspaceVisibilitySetRequest): WorkspaceVisibilityPolicy[];
  restorePolicies(
    input: WorkspaceVisibilityRestoreRequest
  ): WorkspaceVisibilityPolicy[];
  restoreAll(): WorkspaceVisibilityPolicy[];
}

interface RegisterWorkspaceVisibilityIpcDependencies {
  ipc: IpcRegistrar;
  authorize: IpcAuthorizer;
  resolveService(context: LumoraWindowContext): WorkspaceVisibilityServiceLike;
  developmentOrigin?: string;
}

class WorkspaceVisibilityIpcError extends Error {
  readonly code = 'WORKSPACE_VISIBILITY_FAILED';

  constructor() {
    super('Lumora could not update workspace visibility.');
    this.name = 'WorkspaceVisibilityIpcError';
  }
}

function authorizeRequest(
  event: IpcInvokeEventLike,
  authorize: IpcAuthorizer,
  developmentOrigin?: string
): LumoraWindowContext {
  const context = authorize(event);
  if (
    event.senderFrame === null ||
    !isTrustedRendererUrl(event.senderFrame.url, developmentOrigin)
  ) {
    const error = new Error(
      'The IPC request did not originate from the Lumora renderer.'
    ) as Error & { code: string };
    error.code = 'IPC_UNTRUSTED_SENDER';
    throw error;
  }
  return context;
}

function validateResult(operation: () => unknown): WorkspaceVisibilityPolicy[] {
  try {
    return WorkspaceVisibilityPolicyListSchema.parse(operation());
  } catch {
    throw new WorkspaceVisibilityIpcError();
  }
}

export function registerWorkspaceVisibilityIpc({
  ipc,
  authorize,
  resolveService,
  developmentOrigin
}: RegisterWorkspaceVisibilityIpcDependencies): void {
  const resolve = (event: IpcInvokeEventLike) => resolveService(
    authorizeRequest(event, authorize, developmentOrigin)
  );

  ipc.handle(IPC_CHANNELS.workspaceVisibilityGet, async (event) => {
    const service = resolve(event);
    return validateResult(() => service.getPolicies());
  });
  ipc.handle(IPC_CHANNELS.workspaceVisibilitySet, async (event, input) => {
    const request = WorkspaceVisibilitySetRequestSchema.parse(input);
    const service = resolve(event);
    return validateResult(() => service.setPolicy(request));
  });
  ipc.handle(IPC_CHANNELS.workspaceVisibilityRestore, async (event, input) => {
    const request = WorkspaceVisibilityRestoreRequestSchema.parse(input);
    const service = resolve(event);
    return validateResult(() => service.restorePolicies(request));
  });
  ipc.handle(IPC_CHANNELS.workspaceVisibilityRestoreAll, async (event) => {
    const service = resolve(event);
    return validateResult(() => service.restoreAll());
  });
}
