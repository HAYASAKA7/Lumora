import {
  IPC_CHANNELS,
  LOCAL_EXECUTION_TARGET_ID,
  AgentRuntimeStartResultSchema,
  AgentRuntimeCancelRequestSchema,
  AgentRuntimeStartRequestSchema,
  StructuredAgentActionSchema,
  StructuredAgentCapabilityScanRequestSchema,
  StructuredAgentCommandResultSchema,
  StructuredAgentConnectionRequestSchema,
  StructuredAgentEventSchema,
  StructuredAgentLaunchRequestSchema,
  StructuredAgentRuntimeListSchema,
  StructuredAgentRuntimeSnapshotSchema,
  StructuredAgentRuntimeSummarySchema,
  StructuredProviderCapabilityReportSchema,
  StructuredProviderPreferenceInputSchema,
  StructuredProviderPreferenceListSchema,
  type StructuredAgentEvent,
  type StructuredProviderCapabilityReport,
  type StructuredProviderPreference
} from '../../shared/contracts';
import type { StructuredAgentRuntimeHost } from '../agent/runtime/structured-agent-runtime-host';
import {
  IpcAccessError,
  type IpcAuthorizer,
  type TargetAwareIpcEvent
} from './ipc-access';

interface IpcRegistrar {
  handle(
    channel: string,
    handler: (
      event: TargetAwareIpcEvent,
      ...args: readonly unknown[]
    ) => Promise<unknown> | unknown
  ): void;
}

type AgentRuntime = Pick<
  StructuredAgentRuntimeHost,
  'launch' | 'list' | 'snapshot' | 'dispatch' | 'reconnect' | 'close' | 'subscribe'
>;

interface RegisterAgentIpcOptions {
  ipc: IpcRegistrar;
  authorize: IpcAuthorizer;
  runtime: AgentRuntime;
  scanCapabilities(
    fresh: boolean
  ): Promise<readonly StructuredProviderCapabilityReport[]>;
  preferences: {
    list(): readonly StructuredProviderPreference[];
    save(
      input: StructuredProviderPreference
    ): Promise<readonly StructuredProviderPreference[]> | readonly StructuredProviderPreference[];
  };
  startPrepared(operationId: string, launchToken: string): Promise<unknown>;
  cancelPrepared(operationId: string): Promise<void>;
  sendEvent(event: StructuredAgentEvent): void;
}

class StructuredAgentIpcError extends Error {
  readonly code = 'STRUCTURED_AGENT_OPERATION_FAILED';

  constructor() {
    super('Lumora could not complete the structured agent operation.');
    this.name = 'StructuredAgentIpcError';
  }
}

async function protectedOperation<T>(operation: () => Promise<T> | T): Promise<T> {
  try {
    return await operation();
  } catch {
    throw new StructuredAgentIpcError();
  }
}

function authorizeLocal(
  event: TargetAwareIpcEvent,
  authorize: IpcAuthorizer
): void {
  const context = authorize(event);
  if (
    context.mode !== 'local' ||
    context.executionTargetId !== LOCAL_EXECUTION_TARGET_ID
  ) {
    throw new IpcAccessError();
  }
}

export function registerAgentIpc({
  ipc,
  authorize,
  runtime,
  scanCapabilities,
  preferences,
  startPrepared,
  cancelPrepared,
  sendEvent
}: RegisterAgentIpcOptions): () => void {
  ipc.handle(IPC_CHANNELS.agentRuntimeStart, async (event, input) => {
    authorizeLocal(event, authorize);
    return protectedOperation(async () => {
      const request = AgentRuntimeStartRequestSchema.parse(input);
      return AgentRuntimeStartResultSchema.parse(
        await startPrepared(request.operationId, request.launchToken)
      );
    });
  });
  ipc.handle(IPC_CHANNELS.agentRuntimeCancelStart, async (event, input) => {
    authorizeLocal(event, authorize);
    return protectedOperation(async () => {
      const request = AgentRuntimeCancelRequestSchema.parse(input);
      await cancelPrepared(request.operationId);
      return StructuredAgentCommandResultSchema.parse({ accepted: true });
    });
  });
  ipc.handle(IPC_CHANNELS.structuredCapabilityScan, async (event, input) => {
    authorizeLocal(event, authorize);
    return protectedOperation(async () => {
      const request = StructuredAgentCapabilityScanRequestSchema.parse(input);
      return StructuredProviderCapabilityReportSchema.array().length(3).parse(
        await scanCapabilities(request.fresh)
      );
    });
  });
  ipc.handle(IPC_CHANNELS.structuredPreferencesGet, async (event) => {
    authorizeLocal(event, authorize);
    return protectedOperation(() =>
      StructuredProviderPreferenceListSchema.parse(preferences.list())
    );
  });
  ipc.handle(IPC_CHANNELS.structuredPreferenceSave, async (event, input) => {
    authorizeLocal(event, authorize);
    return protectedOperation(async () => {
      const request = StructuredProviderPreferenceInputSchema.parse(input);
      return StructuredProviderPreferenceListSchema.parse(
        await preferences.save(request)
      );
    });
  });
  ipc.handle(IPC_CHANNELS.structuredRuntimeLaunch, async (event, input) => {
    authorizeLocal(event, authorize);
    return protectedOperation(async () => {
      const request = StructuredAgentLaunchRequestSchema.parse(input);
      return StructuredAgentRuntimeSummarySchema.parse(await runtime.launch(request));
    });
  });
  ipc.handle(IPC_CHANNELS.structuredRuntimeList, async (event) => {
    authorizeLocal(event, authorize);
    return protectedOperation(() => StructuredAgentRuntimeListSchema.parse(runtime.list()));
  });
  ipc.handle(IPC_CHANNELS.structuredRuntimeSnapshot, async (event, input) => {
    authorizeLocal(event, authorize);
    return protectedOperation(() => {
      const request = StructuredAgentConnectionRequestSchema.parse(input);
      return StructuredAgentRuntimeSnapshotSchema.parse(
        runtime.snapshot(request.connectionId)
      );
    });
  });
  ipc.handle(IPC_CHANNELS.structuredRuntimeAction, async (event, input) => {
    authorizeLocal(event, authorize);
    return protectedOperation(async () => {
      const action = StructuredAgentActionSchema.parse(input);
      await runtime.dispatch(action);
      return StructuredAgentCommandResultSchema.parse({ accepted: true });
    });
  });
  ipc.handle(IPC_CHANNELS.structuredRuntimeReconnect, async (event, input) => {
    authorizeLocal(event, authorize);
    return protectedOperation(async () => {
      const request = StructuredAgentConnectionRequestSchema.parse(input);
      return StructuredAgentRuntimeSummarySchema.parse(
        await runtime.reconnect(request.connectionId)
      );
    });
  });
  ipc.handle(IPC_CHANNELS.structuredRuntimeClose, async (event, input) => {
    authorizeLocal(event, authorize);
    return protectedOperation(async () => {
      const request = StructuredAgentConnectionRequestSchema.parse(input);
      return StructuredAgentRuntimeSummarySchema.parse(
        await runtime.close(request.connectionId)
      );
    });
  });

  return runtime.subscribe((value) => {
    sendEvent(StructuredAgentEventSchema.parse(value));
  });
}
