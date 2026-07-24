import {
  IPC_CHANNELS,
  StartupPresentationCompletionSchema,
  SystemInfoSchema,
  type SystemInfo
} from '../../shared/contracts';
import { isTrustedRendererUrl } from '../security-policy';

interface IpcInvokeEventLike {
  senderFrame: { url: string } | null;
  sender: { id: number };
}

interface IpcRegistrar {
  handle(
    channel: string,
    handler: (event: IpcInvokeEventLike) => Promise<unknown> | unknown
  ): void;
}

interface RegisterSystemIpcDependencies {
  ipc: IpcRegistrar;
  platform: string;
  arch: string;
  appVersion: string;
  claimStartupPresentation(senderId: number): Promise<boolean>;
  completeStartupPresentation(senderId: number): void;
  developmentOrigin?: string;
}

class IpcAccessError extends Error {
  readonly code = 'IPC_UNTRUSTED_SENDER';

  constructor() {
    super('The IPC request did not originate from the Lumora renderer.');
    this.name = 'IpcAccessError';
  }
}

export function registerSystemIpc({
  ipc,
  platform,
  arch,
  appVersion,
  claimStartupPresentation,
  completeStartupPresentation,
  developmentOrigin
}: RegisterSystemIpcDependencies): void {
  const assertTrustedRenderer = (event: IpcInvokeEventLike): void => {
    if (
      event.senderFrame === null ||
      !isTrustedRendererUrl(event.senderFrame.url, developmentOrigin)
    ) {
      throw new IpcAccessError();
    }
  };

  ipc.handle(IPC_CHANNELS.systemInfo, async (event): Promise<SystemInfo> => {
    assertTrustedRenderer(event);

    return SystemInfoSchema.parse({ platform, arch, appVersion });
  });
  ipc.handle(IPC_CHANNELS.startupPresentationClaim, async (event) => {
    assertTrustedRenderer(event);
    return claimStartupPresentation(event.sender.id);
  });
  ipc.handle(IPC_CHANNELS.startupPresentationComplete, async (event) => {
    assertTrustedRenderer(event);
    completeStartupPresentation(event.sender.id);
    return StartupPresentationCompletionSchema.parse({
      acknowledged: true
    });
  });
}
