import type { IpcAuthorizer } from './ipc-access';
import {
  CustomTerminalProfileInputSchema,
  GeneralSettingsSchema,
  IPC_CHANNELS,
  KeyboardSettingsSchema,
  LaunchPrepareRequestSchema,
  LaunchPreviewSchema,
  LaunchSettingsLayerInputSchema,
  LaunchSettingsLayerListSchema,
  ProviderLaunchConfigInputSchema,
  ProviderLaunchConfigListSchema,
  RuntimeAttachmentSchema,
  RuntimeCommandResultSchema,
  RuntimeEventSchema,
  RuntimeIdRequestSchema,
  RuntimeListSchema,
  RuntimeResizeRequestSchema,
  RuntimeStartRequestSchema,
  RuntimeSummarySchema,
  RuntimeWriteRequestSchema,
  ExternalOpenResultSchema,
  TerminalLinkOpenRequestSchema,
  TerminalProfileIdSchema,
  TerminalProfileListSchema,
  WorkspaceTrustDecisionListSchema,
  WorkspaceTrustDecisionSchema,
  WorkspaceTrustGrantRequestSchema,
  WorkspaceTrustRevokeRequestSchema,
  type LumoraWindowContext,
  type RuntimeEvent
} from '../../shared/contracts';
import { isTrustedRendererUrl } from '../security-policy';
import type { TerminalRuntime } from '../terminal/terminal-runtime';

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

export type TerminalIpcRuntime = Pick<
  TerminalRuntime,
  | 'getProfiles'
  | 'saveProfile'
  | 'deleteProfile'
  | 'getProviderLaunchConfigs'
  | 'saveProviderLaunchConfig'
  | 'getLaunchSettingsLayers'
  | 'saveLaunchSettingsLayer'
  | 'getGeneralSettings'
  | 'saveGeneralSettings'
  | 'getKeyboardSettings'
  | 'saveKeyboardSettings'
  | 'prepareLaunch'
  | 'getWorkspaceTrustDecisions'
  | 'trustWorkspaceForLaunch'
  | 'revokeWorkspaceTrust'
  | 'startRuntime'
  | 'listRuntimes'
  | 'attachRuntime'
  | 'writeRuntime'
  | 'resizeRuntime'
  | 'terminateRuntime'
>;

interface RegisterTerminalIpcDependencies {
  ipc: IpcRegistrar;
  authorize: IpcAuthorizer;
  resolveRuntime(context: LumoraWindowContext): TerminalIpcRuntime;
  subscribeRuntimeEvents(listener: (event: RuntimeEvent) => void): () => void;
  sendRuntimeEvent(event: RuntimeEvent): void;
  openExternal(url: string): Promise<unknown>;
  developmentOrigin?: string;
}

class IpcAccessError extends Error {
  readonly code = 'IPC_UNTRUSTED_SENDER';

  constructor() {
    super('The IPC request did not originate from the Lumora renderer.');
    this.name = 'IpcAccessError';
  }
}

class TerminalIpcError extends Error {
  readonly code = 'TERMINAL_OPERATION_FAILED';

  constructor() {
    super('Lumora could not complete the terminal operation.');
    this.name = 'TerminalIpcError';
  }
}

async function privileged<T>(operation: () => Promise<T> | T): Promise<T> {
  try {
    return await operation();
  } catch {
    throw new TerminalIpcError();
  }
}

function assertTrusted(
  event: IpcInvokeEventLike,
  authorize: IpcAuthorizer,
  developmentOrigin?: string
): LumoraWindowContext {
  const context = authorize(event);
  if (
    event.senderFrame === null ||
    !isTrustedRendererUrl(event.senderFrame.url, developmentOrigin)
  ) {
    throw new IpcAccessError();
  }
  return context;
}

export function registerTerminalIpc({
  ipc,
  authorize,
  resolveRuntime,
  subscribeRuntimeEvents,
  sendRuntimeEvent,
  openExternal,
  developmentOrigin
}: RegisterTerminalIpcDependencies): () => void {
  ipc.handle(IPC_CHANNELS.terminalProfilesGet, async (event) => {
    const runtime = resolveRuntime(
      assertTrusted(event, authorize, developmentOrigin)
    );
    return privileged(() =>
      TerminalProfileListSchema.parse(runtime.getProfiles())
    );
  });
  ipc.handle(IPC_CHANNELS.terminalProfileSave, async (event, input) => {
    const runtime = resolveRuntime(
      assertTrusted(event, authorize, developmentOrigin)
    );
    const request = CustomTerminalProfileInputSchema.parse(input);
    return privileged(async () =>
      TerminalProfileListSchema.parse(await runtime.saveProfile(request))
    );
  });
  ipc.handle(IPC_CHANNELS.terminalProfileDelete, async (event, profileId) => {
    const runtime = resolveRuntime(
      assertTrusted(event, authorize, developmentOrigin)
    );
    const request = TerminalProfileIdSchema.parse(profileId);
    return privileged(() =>
      TerminalProfileListSchema.parse(runtime.deleteProfile(request))
    );
  });
  ipc.handle(IPC_CHANNELS.providerLaunchConfigsGet, async (event) => {
    const runtime = resolveRuntime(
      assertTrusted(event, authorize, developmentOrigin)
    );
    return privileged(() =>
      ProviderLaunchConfigListSchema.parse(runtime.getProviderLaunchConfigs())
    );
  });
  ipc.handle(IPC_CHANNELS.providerLaunchConfigSave, async (event, input) => {
    const runtime = resolveRuntime(
      assertTrusted(event, authorize, developmentOrigin)
    );
    const request = ProviderLaunchConfigInputSchema.parse(input);
    return privileged(() =>
      ProviderLaunchConfigListSchema.parse(
        runtime.saveProviderLaunchConfig(request)
      )
    );
  });
  ipc.handle(IPC_CHANNELS.launchSettingsLayersGet, async (event) => {
    const runtime = resolveRuntime(
      assertTrusted(event, authorize, developmentOrigin)
    );
    return privileged(() =>
      LaunchSettingsLayerListSchema.parse(runtime.getLaunchSettingsLayers())
    );
  });
  ipc.handle(IPC_CHANNELS.launchSettingsLayerSave, async (event, input) => {
    const runtime = resolveRuntime(
      assertTrusted(event, authorize, developmentOrigin)
    );
    const request = LaunchSettingsLayerInputSchema.parse(input);
    return privileged(() =>
      LaunchSettingsLayerListSchema.parse(
        runtime.saveLaunchSettingsLayer(request)
      )
    );
  });
  ipc.handle(IPC_CHANNELS.generalSettingsGet, async (event) => {
    const runtime = resolveRuntime(
      assertTrusted(event, authorize, developmentOrigin)
    );
    return privileged(() =>
      GeneralSettingsSchema.parse(runtime.getGeneralSettings())
    );
  });
  ipc.handle(IPC_CHANNELS.generalSettingsSave, async (event, input) => {
    const runtime = resolveRuntime(
      assertTrusted(event, authorize, developmentOrigin)
    );
    const request = GeneralSettingsSchema.parse(input);
    return privileged(() =>
      GeneralSettingsSchema.parse(runtime.saveGeneralSettings(request))
    );
  });
  ipc.handle(IPC_CHANNELS.keyboardSettingsGet, async (event) => {
    const runtime = resolveRuntime(
      assertTrusted(event, authorize, developmentOrigin)
    );
    return privileged(() =>
      KeyboardSettingsSchema.parse(runtime.getKeyboardSettings())
    );
  });
  ipc.handle(IPC_CHANNELS.keyboardSettingsSave, async (event, input) => {
    const runtime = resolveRuntime(
      assertTrusted(event, authorize, developmentOrigin)
    );
    const request = KeyboardSettingsSchema.parse(input);
    return privileged(() =>
      KeyboardSettingsSchema.parse(runtime.saveKeyboardSettings(request))
    );
  });
  ipc.handle(IPC_CHANNELS.launchPrepare, async (event, input) => {
    const runtime = resolveRuntime(
      assertTrusted(event, authorize, developmentOrigin)
    );
    const request = LaunchPrepareRequestSchema.parse(input);
    return privileged(async () =>
      LaunchPreviewSchema.parse(await runtime.prepareLaunch(request))
    );
  });
  ipc.handle(IPC_CHANNELS.workspaceTrustGet, async (event) => {
    const runtime = resolveRuntime(
      assertTrusted(event, authorize, developmentOrigin)
    );
    return privileged(() =>
      WorkspaceTrustDecisionListSchema.parse(
        runtime.getWorkspaceTrustDecisions()
      )
    );
  });
  ipc.handle(IPC_CHANNELS.workspaceTrustGrant, async (event, input) => {
    const runtime = resolveRuntime(
      assertTrusted(event, authorize, developmentOrigin)
    );
    const request = WorkspaceTrustGrantRequestSchema.parse(input);
    return privileged(() =>
      WorkspaceTrustDecisionSchema.parse(
        runtime.trustWorkspaceForLaunch(request.launchToken)
      )
    );
  });
  ipc.handle(IPC_CHANNELS.workspaceTrustRevoke, async (event, input) => {
    const runtime = resolveRuntime(
      assertTrusted(event, authorize, developmentOrigin)
    );
    const request = WorkspaceTrustRevokeRequestSchema.parse(input);
    return privileged(() =>
      WorkspaceTrustDecisionListSchema.parse(
        runtime.revokeWorkspaceTrust(request.workspaceId)
      )
    );
  });
  ipc.handle(IPC_CHANNELS.runtimeStart, async (event, input) => {
    const runtime = resolveRuntime(
      assertTrusted(event, authorize, developmentOrigin)
    );
    const request = RuntimeStartRequestSchema.parse(input);
    return privileged(async () =>
      RuntimeSummarySchema.parse(await runtime.startRuntime(request.launchToken))
    );
  });
  ipc.handle(IPC_CHANNELS.runtimeList, async (event) => {
    const runtime = resolveRuntime(
      assertTrusted(event, authorize, developmentOrigin)
    );
    return privileged(() => RuntimeListSchema.parse(runtime.listRuntimes()));
  });
  ipc.handle(IPC_CHANNELS.runtimeAttach, async (event, input) => {
    const runtime = resolveRuntime(
      assertTrusted(event, authorize, developmentOrigin)
    );
    const request = RuntimeIdRequestSchema.parse(input);
    return privileged(() =>
      RuntimeAttachmentSchema.parse(runtime.attachRuntime(request.runtimeId))
    );
  });
  ipc.handle(IPC_CHANNELS.runtimeWrite, async (event, input) => {
    const runtime = resolveRuntime(
      assertTrusted(event, authorize, developmentOrigin)
    );
    const request = RuntimeWriteRequestSchema.parse(input);
    return privileged(() => {
      runtime.writeRuntime(request);
      return RuntimeCommandResultSchema.parse({ accepted: true });
    });
  });
  ipc.handle(IPC_CHANNELS.runtimeResize, async (event, input) => {
    const runtime = resolveRuntime(
      assertTrusted(event, authorize, developmentOrigin)
    );
    const request = RuntimeResizeRequestSchema.parse(input);
    return privileged(() => {
      runtime.resizeRuntime(request);
      return RuntimeCommandResultSchema.parse({ accepted: true });
    });
  });
  ipc.handle(IPC_CHANNELS.runtimeTerminate, async (event, input) => {
    const runtime = resolveRuntime(
      assertTrusted(event, authorize, developmentOrigin)
    );
    const request = RuntimeIdRequestSchema.parse(input);
    return privileged(async () =>
      RuntimeSummarySchema.parse(await runtime.terminateRuntime(request.runtimeId))
    );
  });
  ipc.handle(IPC_CHANNELS.terminalLinkOpen, async (event, input) => {
    assertTrusted(event, authorize, developmentOrigin);
    const request = TerminalLinkOpenRequestSchema.parse(input);
    return privileged(async () => {
      await openExternal(request.url);
      return ExternalOpenResultSchema.parse({ opened: true });
    });
  });

  return subscribeRuntimeEvents((value) => {
    sendRuntimeEvent(RuntimeEventSchema.parse(value));
  });
}
