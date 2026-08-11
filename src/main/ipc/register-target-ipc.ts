import {
  IPC_CHANNELS,
  LumoraWindowContextSchema,
  RemoteConnectionProfileInputSchema,
  RemoteAutoConnectPreferenceRequestSchema,
  RemoteCredentialStatusSchema,
  RemoteHostKeyObservationSchema,
  RemoteHostTrustRequestSchema,
  RemoteHelperInstallDetailsSchema,
  RemoteLifecycleListSchema,
  RemoteDiscoverySnapshotSchema,
  RemoteSessionCatalogSchema,
  RemoteProviderPreferencesSchema,
  RemoteTargetConnectRequestSchema,
  RemoteTargetConnectionDetailsSchema,
  RemoteTargetIdRequestSchema,
  RemoteTargetListSchema,
  RemoteTargetRemovalResultSchema,
  RemoteTargetSummarySchema,
  RemoteTargetUpdateRequestSchema,
  RemoteTargetWindowOpenResultSchema,
  type LumoraWindowContext,
  type RemoteExecutionTargetId
} from '../../shared/contracts';
import {
  RemoteTargetErrorCodeSchema,
  type RemoteTargetErrorCode
} from '../../shared/remote-target-errors';
import {
  RemoteTargetServiceError,
  type RemoteTargetService
} from '../remote/remote-target-service';
import type { IpcAuthorizer, TargetAwareIpcEvent } from './ipc-access';

interface IpcRegistrar {
  handle(
    channel: string,
    handler: (
      event: TargetAwareIpcEvent,
      ...args: readonly unknown[]
    ) => Promise<unknown> | unknown
  ): void;
}

interface RegisterTargetIpcDependencies {
  ipc: IpcRegistrar;
  authorize: IpcAuthorizer;
  service: Pick<RemoteTargetService,
    'list' | 'get' | 'create' | 'update' | 'remove' | 'observeHostKey' |
    'trustHostKey' | 'connect' | 'disconnect' | 'getHelperInstallDetails' |
    'getCredentialStatus' | 'setAutoConnect' | 'forgetCredential' |
    'installHelper' | 'getProviderPreferences' | 'saveProviderPreferences' |
    'scanDiscovery' | 'scanSessions' | 'listLifecycleSnapshots' |
    'getLifecycleSnapshot'>;
  beforeProfileMutation(id: RemoteExecutionTargetId): Promise<void> | void;
  openTargetWindow(id: RemoteExecutionTargetId): Promise<void>;
}

export class RemoteTargetIpcError extends Error {
  constructor(
    readonly code: RemoteTargetErrorCode = 'REMOTE_TARGET_OPERATION_FAILED'
  ) {
    super(`${code}: Lumora could not complete the remote-target operation.`);
    this.name = 'RemoteTargetIpcError';
  }
}

function requireLocal(context: LumoraWindowContext): void {
  if (context.mode !== 'local') throw new RemoteTargetIpcError();
}

function requireRemote(
  context: LumoraWindowContext
): RemoteExecutionTargetId {
  if (context.mode !== 'remote') throw new RemoteTargetIpcError();
  return context.executionTargetId;
}

function requireTargetScope(
  context: LumoraWindowContext,
  executionTargetId: RemoteExecutionTargetId
): void {
  if (
    context.mode === 'remote' &&
    context.executionTargetId !== executionTargetId
  ) {
    throw new RemoteTargetIpcError();
  }
}

async function protectedOperation<T>(operation: () => T | Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof RemoteTargetIpcError) throw error;
    if (error instanceof RemoteTargetServiceError) {
      const parsed = RemoteTargetErrorCodeSchema.safeParse(error.code);
      if (parsed.success) throw new RemoteTargetIpcError(parsed.data);
    }
    throw new RemoteTargetIpcError();
  }
}

export function registerTargetIpc({
  ipc,
  authorize,
  service,
  beforeProfileMutation,
  openTargetWindow
}: RegisterTargetIpcDependencies): void {
  ipc.handle(IPC_CHANNELS.targetWindowContextGet, async (event) =>
    LumoraWindowContextSchema.parse(authorize(event))
  );

  ipc.handle(IPC_CHANNELS.remoteTargetList, async (event) => {
    const context = authorize(event);
    return protectedOperation(() => RemoteTargetListSchema.parse(
      context.mode === 'local'
        ? service.list()
        : [service.get(context.executionTargetId)]
    ));
  });

  ipc.handle(IPC_CHANNELS.remoteTargetCreate, async (event, input) => {
    const context = authorize(event);
    requireLocal(context);
    return protectedOperation(() => RemoteTargetSummarySchema.parse(
      service.create(RemoteConnectionProfileInputSchema.parse(input))
    ));
  });

  ipc.handle(IPC_CHANNELS.remoteTargetUpdate, async (event, input) => {
    const context = authorize(event);
    requireLocal(context);
    return protectedOperation(async () => {
      const request = RemoteTargetUpdateRequestSchema.parse(input);
      await beforeProfileMutation(request.executionTargetId);
      return RemoteTargetSummarySchema.parse(
        await service.update(request.executionTargetId, request.profile)
      );
    });
  });

  ipc.handle(IPC_CHANNELS.remoteTargetRemove, async (event, input) => {
    const context = authorize(event);
    requireLocal(context);
    return protectedOperation(async () => {
      const request = RemoteTargetIdRequestSchema.parse(input);
      await beforeProfileMutation(request.executionTargetId);
      await service.remove(request.executionTargetId);
      return RemoteTargetRemovalResultSchema.parse({ removed: true });
    });
  });

  ipc.handle(IPC_CHANNELS.remoteTargetObserveHost, async (event, input) => {
    const context = authorize(event);
    requireLocal(context);
    return protectedOperation(async () => {
      const request = RemoteTargetIdRequestSchema.parse(input);
      return RemoteHostKeyObservationSchema.parse(
        await service.observeHostKey(request.executionTargetId)
      );
    });
  });

  ipc.handle(IPC_CHANNELS.remoteTargetTrustHost, async (event, input) => {
    const context = authorize(event);
    requireLocal(context);
    return protectedOperation(() => {
      const request = RemoteHostTrustRequestSchema.parse(input);
      return RemoteTargetSummarySchema.parse(service.trustHostKey(
        request.executionTargetId,
        request.fingerprint
      ));
    });
  });

  ipc.handle(IPC_CHANNELS.remoteTargetConnect, async (event, input) => {
    const context = authorize(event);
    return protectedOperation(async () => {
      const request = RemoteTargetConnectRequestSchema.parse(input);
      requireTargetScope(context, request.executionTargetId);
      return RemoteTargetConnectionDetailsSchema.parse(await service.connect(
        request.executionTargetId,
        request
      ));
    });
  });

  ipc.handle(IPC_CHANNELS.remoteLifecycleList, async (event) => {
    const context = authorize(event);
    return protectedOperation(() => RemoteLifecycleListSchema.parse(
      context.mode === 'local'
        ? service.listLifecycleSnapshots()
        : [service.getLifecycleSnapshot(context.executionTargetId)]
    ));
  });

  ipc.handle(IPC_CHANNELS.remoteCredentialStatus, async (event, input) => {
    const context = authorize(event);
    return protectedOperation(async () => {
      const request = RemoteTargetIdRequestSchema.parse(input);
      requireTargetScope(context, request.executionTargetId);
      return RemoteCredentialStatusSchema.parse(
        await service.getCredentialStatus(request.executionTargetId)
      );
    });
  });

  ipc.handle(IPC_CHANNELS.remoteCredentialForget, async (event, input) => {
    const context = authorize(event);
    return protectedOperation(async () => {
      const request = RemoteTargetIdRequestSchema.parse(input);
      requireTargetScope(context, request.executionTargetId);
      return RemoteCredentialStatusSchema.parse(
        await service.forgetCredential(request.executionTargetId)
      );
    });
  });

  ipc.handle(
    IPC_CHANNELS.remoteAutoConnectPreferenceSave,
    async (event, input) => {
      const context = authorize(event);
      return protectedOperation(async () => {
        const request = RemoteAutoConnectPreferenceRequestSchema.parse(input);
        requireTargetScope(context, request.executionTargetId);
        return RemoteCredentialStatusSchema.parse(
          await service.setAutoConnect(
            request.executionTargetId,
            request.autoConnect
          )
        );
      });
    }
  );

  ipc.handle(IPC_CHANNELS.remoteTargetDisconnect, async (event, input) => {
    const context = authorize(event);
    return protectedOperation(async () => {
      const request = RemoteTargetIdRequestSchema.parse(input);
      requireTargetScope(context, request.executionTargetId);
      return RemoteTargetSummarySchema.parse(
        await service.disconnect(request.executionTargetId)
      );
    });
  });

  ipc.handle(IPC_CHANNELS.remoteTargetHelperDetails, async (event) => {
    const context = authorize(event);
    return protectedOperation(() => RemoteHelperInstallDetailsSchema.parse(
      service.getHelperInstallDetails(requireRemote(context))
    ));
  });

  ipc.handle(IPC_CHANNELS.remoteTargetHelperInstall, async (event) => {
    const context = authorize(event);
    return protectedOperation(async () => RemoteTargetConnectionDetailsSchema.parse(
      await service.installHelper(requireRemote(context))
    ));
  });

  ipc.handle(IPC_CHANNELS.remoteProviderPreferencesGet, async (event) => {
    const context = authorize(event);
    return protectedOperation(() => RemoteProviderPreferencesSchema.parse(
      service.getProviderPreferences(requireRemote(context))
    ));
  });

  ipc.handle(
    IPC_CHANNELS.remoteProviderPreferencesSave,
    async (event, input) => {
      const context = authorize(event);
      return protectedOperation(() => RemoteProviderPreferencesSchema.parse(
        service.saveProviderPreferences(
          requireRemote(context),
          RemoteProviderPreferencesSchema.parse(input)
        )
      ));
    }
  );

  ipc.handle(IPC_CHANNELS.remoteDiscoveryScan, async (event) => {
    const context = authorize(event);
    return protectedOperation(async () => RemoteDiscoverySnapshotSchema.parse(
      await service.scanDiscovery(requireRemote(context))
    ));
  });

  ipc.handle(IPC_CHANNELS.remoteSessionScan, async (event) => {
    const context = authorize(event);
    return protectedOperation(async () => RemoteSessionCatalogSchema.parse(
      await service.scanSessions(requireRemote(context))
    ));
  });

  ipc.handle(IPC_CHANNELS.remoteTargetWindowOpen, async (event, input) => {
    const context = authorize(event);
    requireLocal(context);
    return protectedOperation(async () => {
      const request = RemoteTargetIdRequestSchema.parse(input);
      await openTargetWindow(request.executionTargetId);
      return RemoteTargetWindowOpenResultSchema.parse({
        opened: true,
        executionTargetId: request.executionTargetId
      });
    });
  });
}
